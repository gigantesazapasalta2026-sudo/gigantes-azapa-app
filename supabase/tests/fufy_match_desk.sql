-- Transactional integration checks for Copa FUFY's digital match desk.
-- Run after fufy_match_desk is applied and before live competition starts.
-- Test teams, players, credentials, shifts, events and fixture edits roll back.
-- No HTTP identity is impersonated; the actor is an existing authorized user.
begin;
set local statement_timeout='40s';
set local lock_timeout='3s';
create temporary table fufy_desk_test_ids(key text primary key,id uuid not null) on commit drop;
grant select on fufy_desk_test_ids to service_role,anon,authenticated;

do $setup$
declare v_project uuid; v_actor uuid; v_a uuid; v_b uuid; v_c uuid; v_id uuid; v_match1 uuid; v_match2 uuid;
begin
  select id into strict v_project from public.projects where code='FUFY2026';
  if exists(select 1 from public.fufy_matches where project_id=v_project and
    (desk_enabled or (status<>'cancelled' and (status in ('in_progress','final') or starts_at<=clock_timestamp())))) then
    raise exception 'Run desk fixture tests before any real digital act or championship start.';
  end if;
  select p.user_id into v_actor from public.profiles p where p.active and
    (p.role in ('superadmin','board') or exists(select 1 from public.project_user_access a
      where a.user_id=p.user_id and a.project_id=v_project and a.access_role in ('editor','manager')))
    order by p.user_id limit 1;
  if v_actor is null then raise exception 'An existing authorized organizer is required.'; end if;
  select id into v_match1 from public.fufy_matches where project_id=v_project and status='scheduled' order by match_no limit 1;
  select id into v_match2 from public.fufy_matches where project_id=v_project and status='scheduled' and id<>v_match1 order by match_no limit 1;
  if v_match2 is null then raise exception 'Two scheduled matches are required.'; end if;
  insert into public.project_teams(project_id,name,country,status,active)
    values(v_project,'__FUFY_DESK_ROLLBACK__ A '||gen_random_uuid()::text,'Chile','roster_pending',true) returning id into v_a;
  insert into public.project_teams(project_id,name,country,status,active)
    values(v_project,'__FUFY_DESK_ROLLBACK__ B '||gen_random_uuid()::text,'Chile','roster_pending',true) returning id into v_b;
  insert into public.project_teams(project_id,name,country,status,active)
    values(v_project,'__FUFY_DESK_ROLLBACK__ C '||gen_random_uuid()::text,'Chile','roster_pending',true) returning id into v_c;
  insert into public.fufy_club_submissions(team_id) values(v_a),(v_b),(v_c);
  insert into fufy_desk_test_ids values('project',v_project),('actor',v_actor),('team_a',v_a),('team_b',v_b),('team_c',v_c),('match1',v_match1),('match2',v_match2);
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,jersey_number,review_status)
    values(v_a,'__FUFY_DESK_ROLLBACK__ Jugador A','Otro','DESK-TEST-A','1980-01-01',7,'reviewed') returning id into v_id;
  insert into fufy_desk_test_ids values('player_a',v_id);
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,jersey_number,review_status)
    values(v_b,'__FUFY_DESK_ROLLBACK__ Jugador B','Otro','DESK-TEST-B','1980-01-01',8,'pending') returning id into v_id;
  insert into fufy_desk_test_ids values('player_b',v_id);
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,review_status)
    values(v_c,'__FUFY_DESK_ROLLBACK__ Jugador C','Otro','DESK-TEST-C','1980-01-01','observed') returning id into v_id;
  insert into fufy_desk_test_ids values('player_c',v_id);
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,removed_at)
    values(v_a,'__FUFY_DESK_ROLLBACK__ Retirado','Otro','DESK-TEST-REMOVED','1980-01-01',clock_timestamp()) returning id into v_id;
  insert into fufy_desk_test_ids values('removed_player',v_id);
  update public.fufy_matches set home_team_id=v_a,away_team_id=v_b,home_score=null,away_score=null,
    home_tries=null,away_tries=null,home_yellow=0,away_yellow=0,home_red=0,away_red=0 where id=v_match1;
  update public.fufy_matches set home_team_id=v_b,away_team_id=v_c,home_score=null,away_score=null,
    home_tries=null,away_tries=null,home_yellow=0,away_yellow=0,home_red=0,away_red=0 where id=v_match2;
end $setup$;

-- This helper only fetches a fresh version. Stale-version and idempotency
-- assertions call the real RPC directly with deliberately retained values.
create function pg_temp.fufy_test_desk_command(p_token text,p_match uuid,p_command text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker as $helper$
declare v_updated timestamptz;
begin
  select updated_at into strict v_updated from public.fufy_matches where id=p_match;
  return public.fufy_desk_command(p_token,gen_random_uuid(),p_match,v_updated,p_command,p_payload);
end $helper$;
grant execute on function pg_temp.fufy_test_desk_command(text,uuid,text,jsonb) to service_role;

set local role service_role;
do $desk_checks$
declare
  v_project uuid; v_actor uuid; v_a uuid; v_b uuid; v_c uuid; v_pa uuid; v_pb uuid; v_pc uuid; v_removed uuid;
  v_m1 uuid; v_m2 uuid; v_request uuid; v_start_request uuid; v_event_try uuid; v_event_conversion uuid;
  v_token text=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_other_token text=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_expired_token text=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_ip text=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_password text='__FUFY_DESK_ROLLBACK__'||gen_random_uuid()::text;
  v_new_password text='__FUFY_DESK_ROLLBACK__'||gen_random_uuid()::text;
  v_payload jsonb; v_result jsonb; v_session jsonb; v_match public.fufy_matches;
  v_before timestamptz; v_after timestamptz; v_version bigint; v_table text; v_role text; v_rpc text; v_i integer;
begin
  select id into strict v_project from pg_temp.fufy_desk_test_ids where key='project';
  select id into strict v_actor from pg_temp.fufy_desk_test_ids where key='actor';
  select id into strict v_a from pg_temp.fufy_desk_test_ids where key='team_a';
  select id into strict v_b from pg_temp.fufy_desk_test_ids where key='team_b';
  select id into strict v_c from pg_temp.fufy_desk_test_ids where key='team_c';
  select id into strict v_pa from pg_temp.fufy_desk_test_ids where key='player_a';
  select id into strict v_pb from pg_temp.fufy_desk_test_ids where key='player_b';
  select id into strict v_pc from pg_temp.fufy_desk_test_ids where key='player_c';
  select id into strict v_removed from pg_temp.fufy_desk_test_ids where key='removed_player';
  select id into strict v_m1 from pg_temp.fufy_desk_test_ids where key='match1';
  select id into strict v_m2 from pg_temp.fufy_desk_test_ids where key='match2';
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_table in array array['fufy_desk_access','fufy_desk_sessions','fufy_desk_login_limits','fufy_desk_commands','fufy_desk_audit'] loop
      if has_table_privilege(v_role,'public.'||v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or not (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass) then
        raise exception 'Private desk table % is not protected from %.',v_table,v_role;
      end if;
    end loop;
    foreach v_rpc in array array['fufy_desk_session(text)','fufy_desk_login(uuid,text,text,text,text)',
      'fufy_desk_logout(text)','fufy_desk_rotate_access(uuid,uuid,text)','fufy_desk_command(text,uuid,uuid,timestamptz,text,jsonb)'] loop
      if has_function_privilege(v_role,'public.'||v_rpc,'EXECUTE') then raise exception '% can execute %.',v_role,v_rpc; end if;
    end loop;
    if has_table_privilege(v_role,'public.fufy_match_events','INSERT,UPDATE,DELETE') then raise exception 'Client can write sports events.'; end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='fufy_match_events'
    and column_name not in ('id','project_id','match_id','team_id','player_id','player_name','jersey_number','kind','points','period','match_minute','created_at','voided_at')) then
    raise exception 'A non-sports field was added to the public event table.';
  end if;
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
    and (tablename like 'fufy_desk_%' or tablename like 'fufy_club_%'))
    or (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('fufy_matches','fufy_match_events'))<>2 then
    raise exception 'Realtime publication exposes private tables or lacks the sports tables.';
  end if;
  begin
    perform public.fufy_desk_rotate_access(v_project,gen_random_uuid(),v_password);
    raise exception 'An unknown actor rotated the desk credential.';
  exception when sqlstate 'PT403' then null; end;
  perform public.fufy_desk_rotate_access(v_project,v_actor,v_password);
  if not exists(select 1 from public.fufy_desk_access where project_id=v_project and password_hash<>v_password
    and extensions.crypt(v_password,password_hash)=password_hash and expires_at>=clock_timestamp()+interval '23 hours') then
    raise exception 'Password hashing or credential lifetime is incorrect.';
  end if;
  for v_i in 1..20 loop
    v_result=public.fufy_desk_login(v_project,'incorrecta','__FUFY_DESK_ROLLBACK__ Turno A',v_token,v_ip);
    if (v_result->>'status')::integer is distinct from 401 then raise exception 'Wrong-password attempt % did not return 401.',v_i; end if;
  end loop;
  v_result=public.fufy_desk_login(v_project,v_password,'__FUFY_DESK_ROLLBACK__ Turno A',v_token,v_ip);
  if (v_result->>'status')::integer is distinct from 429 or (select attempt_count from public.fufy_desk_login_limits where project_id=v_project and ip_hash=v_ip) is distinct from 21 then
    raise exception 'Invalid logins did not persist their count or the twenty-attempt limit failed.';
  end if;
  update public.fufy_desk_login_limits set window_started_at=clock_timestamp()-interval '16 minutes' where project_id=v_project and ip_hash=v_ip;
  v_result=public.fufy_desk_login(v_project,v_password,'__FUFY_DESK_ROLLBACK__ Turno A',v_token,v_ip);
  if (v_result->>'ok')::boolean is not true then raise exception 'Login after the expired rate window failed: %',v_result; end if;
  v_session=public.fufy_desk_session(v_token);
  if v_session ?| array['token_hash','password_hash','credential_version'] or v_session->>'operator_name' is distinct from '__FUFY_DESK_ROLLBACK__ Turno A'
    or (v_session->>'expires_at')::timestamptz-(v_session->>'started_at')::timestamptz>interval '12 hours' then
    raise exception 'The session response exposes credentials or has the wrong actor/lifetime.';
  end if;
  perform public.fufy_desk_login(v_project,v_password,'__FUFY_DESK_ROLLBACK__ Turno B',v_other_token,v_ip);
  perform public.fufy_desk_login(v_project,v_password,'__FUFY_DESK_ROLLBACK__ Vencido',v_expired_token,v_ip);
  update public.fufy_desk_sessions set started_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 minute' where token_hash=v_expired_token;
  begin
    perform pg_temp.fufy_test_desk_command(v_expired_token,v_m1,'start');
    raise exception 'An expired session wrote a match.';
  exception when sqlstate 'PT401' then null; end;

  update public.fufy_matches set home_score=5,away_score=0 where id=v_m1;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'start');
    raise exception 'Digital start overwrote a manual score.';
  exception when sqlstate 'PT409' then null; end;
  update public.fufy_matches set home_score=null,away_score=null where id=v_m1;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'resume');
    raise exception 'An invalid phase transition was accepted.';
  exception when sqlstate 'PT409' then null; end;
  select updated_at into v_before from public.fufy_matches where id=v_m1;
  v_start_request=gen_random_uuid();
  perform public.fufy_desk_command(v_token,v_start_request,v_m1,v_before,'start','{}');
  select updated_at into v_after from public.fufy_matches where id=v_m1;
  v_result=public.fufy_desk_command(v_token,v_start_request,v_m1,v_before,'start','{}');
  if (v_result->>'replayed')::boolean is not true or v_after<>(select updated_at from public.fufy_matches where id=v_m1)
    or (select count(*) from public.fufy_desk_audit where match_id=v_m1 and action='start')<>1
    or private.fufy_edit_allowed(v_c) is distinct from false then
    raise exception 'Start was duplicated, advanced the version on replay, or failed to close every roster.';
  end if;
  begin
    perform public.fufy_desk_command(v_token,v_start_request,v_m1,v_before,'suspend','{"reason":"Otra acción"}');
    raise exception 'A request ID was reused for different content.';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.fufy_desk_command(v_other_token,v_start_request,v_m1,v_before,'start','{}');
    raise exception 'A request ID was reused by a different shift.';
  exception when sqlstate 'PT409' then null; end;
  v_payload=jsonb_build_object('event',jsonb_build_object('team_id',v_a,'player_id',v_pa,'kind','try','points',999,'player_name','Nombre falso','period',1,'match_minute',3),'operator_name','Operador falso');
  begin
    perform public.fufy_desk_command(v_token,gen_random_uuid(),v_m1,v_before,'add_event',v_payload);
    raise exception 'A stale act version was accepted.';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_set(v_payload,'{event,team_id}',to_jsonb(v_c::text)));
    raise exception 'An event for another team was accepted.';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_set(v_payload,'{event,player_id}',to_jsonb(v_pc::text)));
    raise exception 'A player from another roster was accepted.';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_set(v_payload,'{event,player_id}',to_jsonb(v_removed::text)));
    raise exception 'A removed player was accepted.';
  exception when sqlstate 'PT400' then null; end;
  -- Current review states are pending/observed/reviewed; no nonexistent
  -- rejected state is manufactured. Pending stays visible in the desk UI.
  v_request=gen_random_uuid();
  select updated_at into v_before from public.fufy_matches where id=v_m1;
  v_result=public.fufy_desk_command(v_token,v_request,v_m1,v_before,'add_event',v_payload);
  v_event_try=(v_result->>'event_id')::uuid;
  v_result=public.fufy_desk_command(v_token,v_request,v_m1,v_before,'add_event',v_payload);
  if (v_result->>'replayed')::boolean is not true or (v_result->>'event_id')::uuid<>v_event_try
    or not exists(select 1 from public.fufy_match_events where id=v_event_try and points=5 and player_name='__FUFY_DESK_ROLLBACK__ Jugador A' and jersey_number=7)
    or not exists(select 1 from public.fufy_matches where id=v_m1 and home_score=5 and home_tries=1)
    or not exists(select 1 from public.fufy_desk_audit where event_id=v_event_try and operator_name='__FUFY_DESK_ROLLBACK__ Turno A') then
    raise exception 'Event replay duplicated points, or client-supplied score/identity replaced server values.';
  end if;
  v_result=pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_a,'player_id',v_pa,'kind','conversion')));
  v_event_conversion=(v_result->>'event_id')::uuid;
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_b,'player_id',v_pb,'kind','penalty')));
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_a,'player_id',v_pa,'kind','drop_goal')));
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_b,'kind','penalty_try')));
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_a,'player_id',v_pa,'kind','yellow_card')));
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_b,'player_id',v_pb,'kind','red_card')));
  if not exists(select 1 from public.fufy_matches where id=v_m1 and home_score=10 and away_score=10
    and home_tries=1 and away_tries=1 and home_yellow=1 and away_red=1)
    or not exists(select 1 from public.fufy_match_events where match_id=v_m1 and kind='penalty_try' and player_id is null and player_name is null and points=7) then
    raise exception 'Points, tries, cards or unassigned penalty-try attribution are incorrect.';
  end if;
  perform pg_temp.fufy_test_desk_command(v_token,v_m2,'start');
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m2,'void_event',jsonb_build_object('event_id',v_event_try,'reason','Evento de otro partido'));
    raise exception 'An event belonging to another match was voided.';
  exception when sqlstate 'PT400' then null; end;
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'void_event',jsonb_build_object('event_id',v_event_conversion,'reason','Conversión registrada por error'));
  if not exists(select 1 from public.fufy_match_events where id=v_event_conversion and voided_at is not null)
    or not exists(select 1 from public.fufy_matches where id=v_m1 and home_score=8 and away_score=10) then
    raise exception 'Voiding failed to preserve history and recompute points.';
  end if;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'suspend','{"reason":"No"}');
    raise exception 'Suspension accepted an insufficient reason.';
  exception when sqlstate 'PT400' then null; end;
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'suspend','{"reason":"Pausa de prueba"}');
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'add_event',jsonb_build_object('event',jsonb_build_object('team_id',v_b,'player_id',v_pb,'kind','yellow_card')));
  if not exists(select 1 from public.fufy_matches where id=v_m1 and desk_phase='suspended' and away_yellow=1 and home_score=8) then
    raise exception 'A pending event during suspension changed the phase or lost its card.';
  end if;
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'resume');
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'finish');
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'void_event',jsonb_build_object('event_id',v_event_try,'reason','Corrección sin reapertura'));
    raise exception 'A finalized act was edited without reopening.';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'reopen','{"reason":"Corto"}');
    raise exception 'Reopening accepted an insufficient reason.';
  exception when sqlstate 'PT400' then null; end;
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'reopen','{"reason":"Corrección confirmada por la mesa"}');
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'void_event',jsonb_build_object('event_id',v_event_try,'reason','Try registrado por error'));
  perform pg_temp.fufy_test_desk_command(v_token,v_m1,'finish');
  if not exists(select 1 from public.fufy_matches where id=v_m1 and status='final' and desk_phase='finished' and home_score=3 and away_score=10 and home_tries=0 and away_tries=1) then
    raise exception 'Reopened correction failed to produce the final score.';
  end if;
  if coalesce(current_setting('app.fufy_desk_match',true),'')<>'' then raise exception 'The desk command context leaked.'; end if;
  begin
    update public.fufy_matches set home_score=999 where id=v_m1;
    raise exception 'The legacy editor overwrote a digital score.';
  exception when sqlstate 'PT423' then null; end;
  begin
    update public.fufy_matches set home_team_id=v_c where id=v_m1;
    raise exception 'The legacy editor changed the teams of a digital act.';
  exception when sqlstate 'PT423' then null; end;
  begin
    delete from public.fufy_match_events where id=v_event_try;
    raise exception 'A sports event was deleted instead of preserved.';
  exception when sqlstate 'PT423' then null; end;
  update public.fufy_matches set starts_at=starts_at+interval '1 minute' where id=v_m1;
  if private.fufy_edit_allowed(v_c) is distinct from false then raise exception 'A fixture edit reopened the club roster.'; end if;

  perform public.fufy_desk_logout(v_token);
  begin
    perform pg_temp.fufy_test_desk_command(v_token,v_m1,'reopen','{"reason":"Turno que ya terminó"}');
    raise exception 'A logged-out shift executed a command.';
  exception when sqlstate 'PT401' then null; end;
  perform public.fufy_desk_session(v_other_token);
  select credential_version into v_version from public.fufy_desk_access where project_id=v_project;
  perform public.fufy_desk_rotate_access(v_project,v_actor,v_new_password);
  if (select credential_version from public.fufy_desk_access where project_id=v_project)<>v_version+1 then raise exception 'Rotation failed to increment the credential version.'; end if;
  begin
    perform public.fufy_desk_session(v_other_token);
    raise exception 'Rotation failed to revoke a previous shift.';
  exception when sqlstate 'PT401' then null; end;
  v_result=public.fufy_desk_login(v_project,v_password,'__FUFY_DESK_ROLLBACK__ Clave vieja',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),v_ip);
  if (v_result->>'status')::integer is distinct from 401 then raise exception 'The previous password survived rotation.'; end if;
end $desk_checks$;
reset role;

-- Verify actual client-role reads, not just catalog grants.
update public.projects set public_visible=false where id=(select id from fufy_desk_test_ids where key='project');
set local role anon;
do $private_visibility$
declare v_table text;
begin
  foreach v_table in array array['fufy_desk_access','fufy_desk_sessions','fufy_desk_login_limits','fufy_desk_commands','fufy_desk_audit'] loop
    begin
      execute format('select 1 from public.%I limit 1',v_table);
      raise exception 'anon queried private table %.',v_table;
    exception when insufficient_privilege then null; end;
  end loop;
  if exists(select 1 from public.fufy_match_events where match_id=(select id from pg_temp.fufy_desk_test_ids where key='match1')) then
    raise exception 'Events from a non-public project are visible to anon.';
  end if;
end $private_visibility$;
reset role;
update public.projects set public_visible=true where id=(select id from fufy_desk_test_ids where key='project');
set local role anon;
do $public_visibility$
begin
  if not exists(select 1 from public.fufy_match_events where match_id=(select id from pg_temp.fufy_desk_test_ids where key='match1')) then
    raise exception 'Public sports events are not readable by anon.';
  end if;
end $public_visibility$;
reset role;
set local role authenticated;
do $staff_private_visibility$
declare v_table text;
begin
  foreach v_table in array array['fufy_desk_access','fufy_desk_sessions','fufy_desk_login_limits','fufy_desk_commands','fufy_desk_audit'] loop
    begin
      execute format('select 1 from public.%I limit 1',v_table);
      raise exception 'authenticated queried private table %.',v_table;
    exception when insufficient_privilege then null; end;
  end loop;
end $staff_private_visibility$;
reset role;
rollback;

do $verify_rollback$
begin
  if exists(select 1 from public.project_teams where name like '__FUFY_DESK_ROLLBACK__%')
    or exists(select 1 from public.fufy_club_players where full_name like '__FUFY_DESK_ROLLBACK__%')
    or exists(select 1 from public.fufy_match_events where player_name like '__FUFY_DESK_ROLLBACK__%')
    or exists(select 1 from public.fufy_desk_sessions where operator_name like '__FUFY_DESK_ROLLBACK__%')
    or exists(select 1 from public.fufy_desk_audit where operator_name like '__FUFY_DESK_ROLLBACK__%') then
    raise exception 'Desk rollback verification failed: a fixture remains.';
  end if;
end $verify_rollback$;
select 'PASS: private desk auth, rate limiting, shifts, CAS/idempotency, match transitions, scoring, public isolation and rollback verified' as result;
