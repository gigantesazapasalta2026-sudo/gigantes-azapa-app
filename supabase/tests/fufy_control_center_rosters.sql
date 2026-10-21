-- Focused checks for permanent, championship-wide closure and individual
-- Control Center exceptions. Run after the Control Center migration, before
-- the real championship has started. Requires a migration-capable connection.
-- No user/session/invite or physical Storage file is created. Existing match
-- and roster changes, fixture rows, and audit entries are all rolled back.
begin;
set local statement_timeout='20s';
set local lock_timeout='3s';

create temporary table fufy_closed_test_ids(key text primary key,id uuid not null) on commit drop;
grant select on fufy_closed_test_ids to service_role;

do $setup$
declare event_id uuid; fixture_team uuid; actor_id uuid; match_id uuid; player_id uuid;
begin
  select id into strict event_id from public.projects where code='FUFY2026';
  if exists(select 1 from public.fufy_matches where project_id=event_id and status<>'cancelled'
    and (status in ('in_progress','final') or starts_at<=clock_timestamp())) then
    raise exception 'Run this rollback-only fixture test before the real championship starts.';
  end if;
  select p.user_id into actor_id from public.profiles p where p.active
    and (p.role in ('superadmin','board') or exists(select 1 from public.project_user_access a
      where a.user_id=p.user_id and a.project_id=event_id and a.access_role in ('editor','manager')))
    order by p.user_id limit 1;
  if actor_id is null then raise exception 'An existing authorized organizer is required for the rollback test.'; end if;
  select id into match_id from public.fufy_matches where project_id=event_id and status<>'cancelled'
    order by starts_at,id limit 1;
  if match_id is null then raise exception 'The championship must have a scheduled match.'; end if;

  insert into public.project_teams(project_id,name,country,status,active)
    values(event_id,'__FUFY_CLOSED_ROLLBACK__'||gen_random_uuid()::text,'Chile','roster_pending',true)
    returning id into fixture_team;
  insert into public.fufy_club_submissions(team_id,manager_name)
    values(fixture_team,'Responsable de prueba transaccional');
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date)
    values(fixture_team,'Jugador original de prueba','Otro','CLOSED-TEST-ORIGINAL','1980-01-01')
    returning id into player_id;
  insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
    select fixture_team,'signed_roster','__FUFY_CLOSED_ROLLBACK__/'||gen_random_uuid()::text||'.pdf',
      'test.pdf','application/pdf',16,updated_at from public.fufy_club_submissions where team_id=fixture_team;
  insert into fufy_closed_test_ids values('team',fixture_team),('actor',actor_id),('match',match_id),('player',player_id);
end $setup$;

set local role service_role;
do $checks$
declare
  v_team_id uuid; v_actor_id uuid; v_match_id uuid; late_team uuid; original_player uuid; added_player uuid;
  approval jsonb; approvals jsonb; bad jsonb; payload jsonb; result jsonb;
  expected_version timestamptz; client_role text; count_clubs integer;
begin
  select id into strict v_team_id from pg_temp.fufy_closed_test_ids where key='team';
  select id into strict v_actor_id from pg_temp.fufy_closed_test_ids where key='actor';
  select id into strict v_match_id from pg_temp.fufy_closed_test_ids where key='match';
  select id into strict original_player from pg_temp.fufy_closed_test_ids where key='player';
  foreach client_role in array array['anon','authenticated'] loop
    if has_function_privilege(client_role,'public.fufy_admin_roster_change(uuid,uuid,text,jsonb,timestamptz,jsonb)','EXECUTE')
      or has_function_privilege(client_role,'public.fufy_close_started_rosters(uuid)','EXECUTE')
      or has_function_privilege(client_role,'public.fufy_admin_close_rosters(uuid,uuid)','EXECUTE')
      or has_table_privilege(client_role,'public.fufy_club_roster_changes','SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Client role % unexpectedly has access to the organizational exception path.',client_role;
    end if;
  end loop;

  -- The new fixture team plays neither side of this existing match. Starting
  -- it must nevertheless seal the fixture team's roster, persistently.
  if not private.fufy_edit_allowed(v_team_id) then raise exception 'Fixture roster should initially be editable.'; end if;
  update public.fufy_matches set status='in_progress' where id=v_match_id;
  if private.fufy_edit_allowed(v_team_id) is distinct from false
    or not exists(select 1 from public.fufy_club_submissions s where s.team_id=v_team_id and s.locked_at is not null) then
    raise exception 'The first match failed to close a different club globally.';
  end if;
  -- A newly enabled roster has not yet been observed by the portal. The
  -- BEFORE trigger must still seal it when the started match is cancelled.
  insert into public.project_teams(project_id,name,country,status,active)
    select t.project_id,'__FUFY_CLOSED_ROLLBACK__'||gen_random_uuid()::text,'Chile','roster_pending',true
      from public.project_teams t where t.id=v_team_id returning id into late_team;
  insert into public.fufy_club_submissions(team_id) values(late_team);
  update public.fufy_matches set status='cancelled' where id=v_match_id;
  if private.fufy_edit_allowed(late_team) is distinct from false
    or not exists(select 1 from public.fufy_club_submissions s where s.team_id=late_team and s.locked_at is not null) then
    raise exception 'Cancelling a started match failed to preserve closure for an unobserved roster.';
  end if;
  update public.fufy_matches set status='scheduled' where id=v_match_id;
  update public.fufy_club_submissions s set unlock_until=clock_timestamp()+interval '2 hours' where s.team_id=v_team_id;
  if private.fufy_edit_allowed(v_team_id) is distinct from false then
    raise exception 'Rescheduling or a legacy future unlock reopened the delegate roster.';
  end if;
  begin
    update public.fufy_club_players set notes='Forbidden delegate edit' where id=original_player;
    raise exception 'A closed roster accepted a normal player edit.';
  exception when sqlstate 'PT423' then null; end;
  begin
    update public.fufy_club_players set removed_at=clock_timestamp() where id=original_player;
    raise exception 'A closed roster accepted a normal player removal.';
  exception when sqlstate 'PT423' then null; end;
  begin
    update public.fufy_club_submissions s set manager_name='Forbidden manager edit' where s.team_id=v_team_id;
    raise exception 'A closed roster accepted a delegation edit.';
  exception when sqlstate 'PT423' then null; end;
  begin
    update public.fufy_club_submissions s set status='submitted' where s.team_id=v_team_id;
    raise exception 'A closed roster accepted normal submission.';
  exception when sqlstate 'PT423' then null; end;
  begin
    update public.fufy_club_documents d set removed_at=clock_timestamp() where d.team_id=v_team_id;
    raise exception 'A closed roster accepted a document removal.';
  exception when check_violation then
    if sqlerrm not like '%cerrada%' then raise; end if;
  end;
  begin
    insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      select v_team_id,'other','__FUFY_CLOSED_ROLLBACK__/'||gen_random_uuid()::text||'.pdf','test.pdf','application/pdf',16,s.updated_at
      from public.fufy_club_submissions s where s.team_id=v_team_id;
    raise exception 'A closed roster accepted a document upload.';
  exception when check_violation then
    if sqlerrm not like '%cerrada%' then raise; end if;
  end;

  select jsonb_agg(jsonb_build_object('team_id',t.id,'representative_name','Representante de prueba','approved',true) order by t.id)
    into approvals from public.project_teams t join public.project_teams fixture on fixture.project_id=t.project_id
    where fixture.id=v_team_id and t.active and t.status in ('organizer','confirmed','roster_pending');
  count_clubs=jsonb_array_length(approvals);
  if count_clubs<2 then raise exception 'At least two participants are required for consent-set assertions.'; end if;
  approval=jsonb_build_object('reason','Condición especial comprobada únicamente en esta prueba transaccional',
    'organization_authorizer','Organización de prueba','organization_agreed',true,
    'approval_reference','Acta transaccional de prueba, sin autorización real','club_approvals',approvals);
  payload=jsonb_build_object('full_name','Jugador excepcional de prueba','document_type','Otro',
    'document_number','CLOSED-TEST-EXCEPTION','birth_date','1980-02-02');

  begin
    perform public.fufy_admin_roster_change(v_team_id,gen_random_uuid(),'save',payload,null,approval);
    raise exception 'An unknown actor was allowed to register an exception.';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.fufy_admin_roster_change(v_team_id,v_actor_id,'save',payload,null,null);
    raise exception 'A closed roster accepted an administrative save without authorization.';
  exception when sqlstate 'PT423' then null; end;
  select updated_at into expected_version from public.fufy_club_players where id=original_player;
  begin
    perform public.fufy_admin_roster_change(v_team_id,v_actor_id,'delete',jsonb_build_object('id',original_player),expected_version,null);
    raise exception 'A closed roster accepted an administrative removal without authorization.';
  exception when sqlstate 'PT423' then null; end;

  -- Reject absent organization consent, missing clubs, duplicate clubs,
  -- an unrelated club ID, and a missing representative consent.
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    approval-'organization_agreed',
    jsonb_set(approval,'{club_approvals}',approvals-(count_clubs-1)),
    jsonb_set(approval,'{club_approvals}',jsonb_set(approvals,array[(count_clubs-1)::text],approvals->0)),
    jsonb_set(approval,'{club_approvals,0,team_id}',to_jsonb(gen_random_uuid()::text)),
    jsonb_set(approval,'{club_approvals,0,approved}','false'::jsonb)
  )) loop
    begin
      perform public.fufy_admin_roster_change(v_team_id,v_actor_id,'save',payload,null,bad);
      raise exception 'An incomplete or mismatched authorization was accepted: %',bad;
    exception when sqlstate 'PT400' then null; end;
  end loop;
  if exists(select 1 from public.fufy_club_roster_changes c where c.team_id=v_team_id)
    or (select count(*) from public.fufy_club_players p where p.team_id=v_team_id)<>1 then
    raise exception 'A rejected exception left behind a player or exception record.';
  end if;

  result=public.fufy_admin_roster_change(v_team_id,v_actor_id,'save',payload,null,approval);
  added_player=(result->>'player_id')::uuid;
  if (result->'is_exception'='true'::jsonb) is not true
    or not exists(select 1 from public.fufy_club_roster_changes c where c.id=(result->>'change_id')::uuid
      and c.team_id=v_team_id and c.player_id=added_player and c.actor_user_id=v_actor_id and c.is_exception
      and c.action='added' and c.before_player is null and c.after_player->>'full_name'=payload->>'full_name'
      and jsonb_array_length(c.club_approvals)=count_clubs and c.club_approvals->0->>'team_name' is not null)
    or not exists(select 1 from public.fufy_club_audit a where a.team_id=v_team_id and a.actor_user_id=v_actor_id
      and a.action='admin_player_added' and a.detail->>'change_id'=result->>'change_id')
    or not exists(select 1 from public.fufy_club_submissions s where s.team_id=v_team_id and s.status='submitted' and s.locked_at is not null) then
    raise exception 'The authorized player, normalized authorization, audit, or closed-submitted state was not saved together.';
  end if;
  select updated_at into expected_version from public.fufy_club_players where id=added_player;
  result=public.fufy_admin_roster_change(v_team_id,v_actor_id,'delete',jsonb_build_object('id',added_player),expected_version,approval);
  if not exists(select 1 from public.fufy_club_players where id=added_player and removed_at is not null)
    or not exists(select 1 from public.fufy_club_roster_changes c where c.id=(result->>'change_id')::uuid and c.action='removed' and c.is_exception) then
    raise exception 'An authorized removal failed to preserve its exception record.';
  end if;

  -- Check the *same transaction*, before PostgREST would reset local settings.
  if private.fufy_admin_roster_context(v_team_id) or private.fufy_edit_allowed(v_team_id) then
    raise exception 'The organizational exception leaked its editing context.';
  end if;
  begin
    update public.fufy_club_players set notes='Forbidden edit after administrative exception' where id=original_player;
    raise exception 'A normal write succeeded after the exception RPC in the same transaction.';
  exception when sqlstate 'PT423' then null; end;
end $checks$;
reset role;
rollback;

do $verify_rollback$
begin
  if exists(select 1 from public.project_teams where name like '__FUFY_CLOSED_ROLLBACK__%')
    or exists(select 1 from public.fufy_club_documents where storage_path like '__FUFY_CLOSED_ROLLBACK__/%') then
    raise exception 'Rollback verification failed: a fixture remains.';
  end if;
end $verify_rollback$;
select 'PASS: global closure, consent validation, atomic exceptions, context cleanup, and fixture rollback verified' as result;
