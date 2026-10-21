-- Transactional regression checks for the private Copa FUFY portal.
-- Run with a migration-capable connection after applying the migration.
-- All fixture rows (including the Storage metadata row) are rolled back.
-- No physical Storage object, user account, email, or invitation is created.
begin;
set local statement_timeout='30s';

create temporary table fufy_test_ids(key text primary key,id uuid not null) on commit drop;
grant select,insert,update on fufy_test_ids to service_role;

do $setup$
declare project_id uuid; team_a uuid; team_b uuid; storage_id uuid; t text; role_name text;
begin
  select id into strict project_id from public.projects where code='FUFY2026';
  insert into public.project_teams(project_id,name,country,status,active)
    values(project_id,'__PORTAL_ROLLBACK_TEST_A__','Chile','roster_pending',true) returning id into team_a;
  insert into public.project_teams(project_id,name,country,status,active)
    values(project_id,'__PORTAL_ROLLBACK_TEST_B__','Perú','roster_pending',true) returning id into team_b;
  insert into public.fufy_club_submissions(team_id,manager_name)
    values(team_a,'Mánager original de prueba'),(team_b,'Mánager B de prueba');
  insert into fufy_test_ids values('team_a',team_a),('team_b',team_b);

  foreach t in array array['fufy_club_submissions','fufy_club_invites','fufy_club_players','fufy_club_documents','fufy_club_audit'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then
      raise exception 'RLS is not enabled on %',t;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception '% unexpectedly holds a client grant on %',role_name,t;
      end if;
    end loop;
  end loop;
  if has_sequence_privilege('anon','public.fufy_club_audit_id_seq','USAGE,SELECT,UPDATE')
      or has_sequence_privilege('authenticated','public.fufy_club_audit_id_seq','USAGE,SELECT,UPDATE') then
    raise exception 'Audit sequence unexpectedly exposed to browser roles';
  end if;
  if not exists(select 1 from storage.buckets where id='fufy-clubs-private' and public=false) then
    raise exception 'The portal bucket is missing or public';
  end if;

  -- Synthetic metadata makes the RLS read assertion non-vacuous. It is never
  -- committed, and no object bytes are uploaded or deleted by these tests.
  insert into storage.objects(bucket_id,name,metadata)
    values('fufy-clubs-private',team_a::text||'/rollback-fixture.pdf','{"mimetype":"application/pdf","size":16}'::jsonb)
    returning id into storage_id;
  insert into fufy_test_ids values('storage_object',storage_id);
end $setup$;

set local role anon;
do $anon_access$
declare t text;
begin
  foreach t in array array['fufy_club_submissions','fufy_club_invites','fufy_club_players','fufy_club_documents','fufy_club_audit'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'anon unexpectedly queried %',t;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('update public.%I set team_id=team_id where false',t);
      raise exception 'anon unexpectedly received an update path for %',t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    if exists(select 1 from storage.objects where bucket_id='fufy-clubs-private') then
      raise exception 'anon can read private portal object metadata';
    end if;
  exception when insufficient_privilege then null;
  end;
end $anon_access$;
reset role;

set local role authenticated;
do $authenticated_access$
declare t text;
begin
  foreach t in array array['fufy_club_submissions','fufy_club_invites','fufy_club_players','fufy_club_documents','fufy_club_audit'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'authenticated unexpectedly queried %',t;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('delete from public.%I where false',t);
      raise exception 'authenticated unexpectedly received a delete path for %',t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    if exists(select 1 from storage.objects where bucket_id='fufy-clubs-private') then
      raise exception 'authenticated can read private portal object metadata';
    end if;
  exception when insufficient_privilege then null;
  end;
end $authenticated_access$;
reset role;

set local role service_role;
do $dossier_regressions$
declare
  team_a uuid; team_b uuid; player_a uuid; removed_player uuid; doc_a uuid;
  initial_version timestamptz; observed_version timestamptz; changed integer;
  error_text text; document_kind text;
begin
  select id into strict team_a from pg_temp.fufy_test_ids where key='team_a';
  select id into strict team_b from pg_temp.fufy_test_ids where key='team_b';
  if not exists(select 1 from storage.objects where id=(select id from pg_temp.fufy_test_ids where key='storage_object')) then
    raise exception 'Service role cannot see the private Storage test fixture';
  end if;

  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality)
    values(team_a,'Jugador de prueba uno','Otro','PORTAL-TEST-001','1980-01-01','Chile') returning id into player_a;
  begin
    insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality)
      values(team_a,'Duplicado normalizado','Otro','PORTAL.TEST.001','1980-01-01','Chile');
    raise exception 'A differently formatted duplicate identity was accepted';
  exception when unique_violation then null;
  end;

  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality)
    select team_a,'Jugador de prueba '||n,'Otro','PORTAL-TEST-'||lpad(n::text,3,'0'),'1980-01-01'::date,'Chile'
    from generate_series(2,25) n;
  if (select count(*) from public.fufy_club_players where team_id=team_a and removed_at is null)<>25 then
    raise exception 'The valid 25-player roster could not be stored';
  end if;
  begin
    insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality)
      values(team_a,'Jugador de prueba veintiséis','Otro','PORTAL-TEST-026','1980-01-01','Chile');
    raise exception 'The database accepted player 26';
  exception when check_violation then
    get stacked diagnostics error_text=message_text;
    if error_text not like '%25 jugadores%' then raise; end if;
  end;
  select id into strict removed_player from public.fufy_club_players where team_id=team_a and document_number='PORTAL-TEST-025';
  update public.fufy_club_players set removed_at=clock_timestamp() where id=removed_player;
  insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality)
    values(team_a,'Jugador sustituto de prueba','Otro','PORTAL-TEST-026','1980-01-01','Chile');
  if (select count(*) from public.fufy_club_players where team_id=team_a and removed_at is null)<>25 then
    raise exception 'Soft removal did not free exactly one roster position';
  end if;

  begin
    insert into public.fufy_club_documents(team_id,player_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_b,player_a,'player_declaration',team_b::text||'/cross-team.pdf','fixture.pdf','application/pdf',16,
             (select updated_at from public.fufy_club_submissions where team_id=team_b));
    raise exception 'A document could be associated with another club''s player';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.fufy_club_documents(team_id,player_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_a,gen_random_uuid(),'player_declaration',team_a::text||'/missing-player.pdf','fixture.pdf','application/pdf',16,
             (select updated_at from public.fufy_club_submissions where team_id=team_a));
    raise exception 'An orphan player document was accepted';
  exception when foreign_key_violation then null;
  end;

  -- Each file is bound to the current dossier version. A concurrent edit
  -- during upload must reject the attachment instead of validating old data.
  select updated_at into strict initial_version from public.fufy_club_submissions where team_id=team_a;
  update public.fufy_club_players set notes='Cambio que ocurre durante una carga' where id=player_a;
  begin
    insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_a,'signed_roster',team_a::text||'/stale-upload.pdf','stale-upload.pdf','application/pdf',16,initial_version);
    raise exception 'A file bound to an obsolete dossier version was accepted';
  exception when check_violation then
    get stacked diagnostics error_text=message_text;
    if error_text not like '%cambió durante la carga%' then raise; end if;
  end;
  foreach document_kind in array array['signed_roster','manager_declaration','insurance'] loop
    insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_a,document_kind,team_a::text||'/'||document_kind||'-v1.pdf',document_kind||'-v1.pdf','application/pdf',16,
             (select updated_at from public.fufy_club_submissions where team_id=team_a));
  end loop;
  insert into public.fufy_club_documents(team_id,player_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
    values(team_a,player_a,'player_declaration',team_a::text||'/player-v1.pdf','player-v1.pdf','application/pdf',16,
           (select updated_at from public.fufy_club_submissions where team_id=team_a));
  update public.fufy_club_submissions set status='approved',reviewed_at=clock_timestamp() where team_id=team_a;
  select updated_at into strict initial_version from public.fufy_club_submissions where team_id=team_a;
  update public.fufy_club_players set full_name='Nombre corregido del jugador de prueba' where id=player_a;
  if exists(select 1 from public.fufy_club_documents where team_id=team_a and is_current and removed_at is null) then
    raise exception 'An identity change left old signatures or insurance evidence current';
  end if;
  select updated_at into strict observed_version from public.fufy_club_submissions where team_id=team_a and status='draft' and reviewed_at is null;
  if observed_version<=initial_version then raise exception 'Player change did not advance dossier version'; end if;
  update public.fufy_club_submissions set status='approved' where team_id=team_a and updated_at=initial_version;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'A stale approval CAS unexpectedly succeeded'; end if;

  foreach document_kind in array array['signed_roster','manager_declaration'] loop
    insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_a,document_kind,team_a::text||'/'||document_kind||'-v2.pdf',document_kind||'-v2.pdf','application/pdf',16,
             (select updated_at from public.fufy_club_submissions where team_id=team_a));
  end loop;
  update public.fufy_club_submissions set status='approved',reviewed_at=clock_timestamp() where team_id=team_a;
  update public.fufy_club_submissions set manager_name='Mánager corregido de prueba' where team_id=team_a;
  if exists(select 1 from public.fufy_club_documents where team_id=team_a and kind in ('signed_roster','manager_declaration') and is_current) then
    raise exception 'Manager change failed to invalidate the signed roster and declaration';
  end if;
  if not exists(select 1 from public.fufy_club_submissions where team_id=team_a and status='draft') then
    raise exception 'Manager/document trigger chain did not reset approval';
  end if;

  update public.fufy_club_players set review_status='reviewed' where id=player_a;
  update public.fufy_club_submissions set status='approved',reviewed_at=clock_timestamp() where team_id=team_a;
  update public.fufy_club_players set review_status='observed',review_note='Debe corregir su respaldo' where id=player_a;
  if not exists(select 1 from public.fufy_club_submissions where team_id=team_a and status='observed' and reviewed_at is null) then
    raise exception 'A player observation did not invalidate dossier approval';
  end if;
  update public.fufy_club_submissions set status='approved',reviewed_at=clock_timestamp() where team_id=team_a;
  update public.fufy_club_players set review_status='pending' where id=player_a;
  if not exists(select 1 from public.fufy_club_submissions where team_id=team_a and status='observed' and reviewed_at is null) then
    raise exception 'Returning a player to pending did not invalidate dossier approval';
  end if;

  insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
    values(team_a,'other',team_a::text||'/lock-fixture.pdf','lock-fixture.pdf','application/pdf',16,
           (select updated_at from public.fufy_club_submissions where team_id=team_a)) returning id into doc_a;
  update public.fufy_club_submissions set locked_at=clock_timestamp(),unlock_until=null where team_id=team_a;
  begin
    update public.fufy_club_players set notes='Una edición posterior al cierre' where id=player_a;
    raise exception 'A closed roster accepted a player edit';
  exception when check_violation then null;
  end;
  begin
    update public.fufy_club_submissions set delegate_name='Un delegado posterior al cierre' where team_id=team_a;
    raise exception 'A closed roster accepted a delegation edit';
  exception when check_violation then null;
  end;
  begin
    update public.fufy_club_submissions set status='submitted' where team_id=team_a;
    raise exception 'A closed roster accepted a new club submission';
  exception when check_violation then null;
  end;
  begin
    insert into public.fufy_club_documents(team_id,kind,storage_path,file_name,mime_type,size_bytes,source_updated_at)
      values(team_a,'other',team_a::text||'/after-lock.pdf','after-lock.pdf','application/pdf',16,
             (select updated_at from public.fufy_club_submissions where team_id=team_a));
    raise exception 'A closed roster accepted a new attachment';
  exception when check_violation then null;
  end;
  begin
    update public.fufy_club_documents set removed_at=clock_timestamp() where id=doc_a;
    raise exception 'A closed roster accepted an attachment removal';
  exception when check_violation then null;
  end;
  -- Organizational review remains possible after closure. Generated identity
  -- columns must not make a review-only update look like a club data edit.
  update public.fufy_club_players set review_status='reviewed',review_note='Revisión posterior al cierre' where id=player_a;
  if not exists(select 1 from public.fufy_club_players where id=player_a and review_status='reviewed') then
    raise exception 'Organizational review was blocked by roster closure';
  end if;
  update public.fufy_club_submissions set unlock_until=now()+interval '2 hours',unlock_reason='Corrección de prueba autorizada' where team_id=team_a;
  update public.fufy_club_players set notes='Edición durante corrección autorizada' where id=player_a;
  if not exists(select 1 from public.fufy_club_players where id=player_a and notes='Edición durante corrección autorizada') then
    raise exception 'A valid correction window did not allow the edit';
  end if;
  update public.fufy_club_submissions set unlock_until=now()-interval '1 minute' where team_id=team_a;
  begin
    update public.fufy_club_players set notes='Edición luego de vencer la excepción' where id=player_a;
    raise exception 'An expired correction window still allowed the edit';
  exception when check_violation then null;
  end;
end $dossier_regressions$;
reset role;

rollback;
select 'PASS: all private-portal SQL assertions completed; all test rows rolled back' as result;
