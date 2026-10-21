-- Focused transactional checks for permanent club and personal FUFY access.
-- Uses an existing club and the verified Rogers profile. No auth users or
-- roles are created. All credential/profile changes are rolled back.
begin;
set local statement_timeout='20s';
set local lock_timeout='3s';
set local role service_role;

do $checks$
declare
  v_project uuid; v_team uuid; v_other_actor uuid;
  v_actor constant uuid='23b66fef-65d4-4e0f-a196-6ed727d47a01';
  v_club_hash text=encode(extensions.digest('__FUFY_ACCESS_ROLLBACK__ club-key','sha256'),'hex');
  v_admin_hash text=encode(extensions.digest('__FUFY_ACCESS_ROLLBACK__ admin-key','sha256'),'hex');
  v_invalid_hash text=encode(extensions.digest('__FUFY_ACCESS_ROLLBACK__ invalid-key','sha256'),'hex');
  v_legacy_hash text; v_role text; v_table text;
begin
  select id into strict v_project from public.projects where code='FUFY2026';
  if not exists(select 1 from public.profiles where user_id=v_actor and active and role='superadmin') then
    raise exception 'The verified Rogers account must remain an active superadmin.';
  end if;
  select p.user_id into strict v_other_actor from public.profiles p
    where p.active and p.role='board' order by p.user_id limit 1;
  select i.team_id,i.token_hash into strict v_team,v_legacy_hash
    from public.fufy_club_invites i join public.project_teams t on t.id=i.team_id
    where t.project_id=v_project and t.active order by t.sort_order,t.id limit 1 for update of i;

  foreach v_role in array array['anon','authenticated'] loop
    foreach v_table in array array['fufy_club_invites','fufy_club_admin_access'] loop
      if has_table_privilege(v_role,'public.'||v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or not (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass) then
        raise exception 'Private credential table % is exposed to %.',v_table,v_role;
      end if;
    end loop;
    if has_function_privilege(v_role,'public.fufy_club_admin_key_actor(uuid,text)','EXECUTE') then
      raise exception '% can execute the private key resolver.',v_role;
    end if;
  end loop;
  if (select prosecdef from pg_proc where oid='public.fufy_club_admin_key_actor(uuid,text)'::regprocedure) then
    raise exception 'The resolver must remain SECURITY INVOKER.';
  end if;
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename in ('fufy_club_invites','fufy_club_admin_access')) then
    raise exception 'Credential tables must not be published through Realtime.';
  end if;

  update public.fufy_club_invites set access_key_hash=v_club_hash,expires_at=null where team_id=v_team;
  if not exists(select 1 from public.fufy_club_invites where team_id=v_team
    and expires_at is null and token_hash=v_legacy_hash and access_key_hash=v_club_hash)
    or (select team_id from public.fufy_club_invites where token_hash=v_legacy_hash) is distinct from v_team
    or (select team_id from public.fufy_club_invites where access_key_hash=v_club_hash) is distinct from v_team then
    raise exception 'Permanent access lost the existing legacy link or either lookup.';
  end if;
  begin
    update public.fufy_club_invites set access_key_hash='not-a-hash' where team_id=v_team;
    raise exception 'A malformed club key hash was stored.';
  exception when check_violation then null; end;
  begin
    update public.fufy_club_invites set expires_at=created_at-interval '1 second' where team_id=v_team;
    raise exception 'Nullable expiration lost the check for dated credentials.';
  exception when check_violation then null; end;

  insert into public.fufy_club_admin_access(project_id,actor_user_id,key_hash,active,revoked_at)
    values(v_project,v_actor,v_admin_hash,true,null)
    on conflict(project_id) do update set actor_user_id=excluded.actor_user_id,
      key_hash=excluded.key_hash,active=true,revoked_at=null;
  if public.fufy_club_admin_key_actor(v_project,v_admin_hash) is distinct from v_actor then
    raise exception 'The personal key did not resolve to its real actor.';
  end if;
  begin
    perform public.fufy_club_admin_key_actor(v_project,'not-a-hash');
    raise exception 'The resolver accepted a malformed key hash.';
  exception when sqlstate 'PT401' then null; end;
  begin
    perform public.fufy_club_admin_key_actor(v_project,v_invalid_hash);
    raise exception 'The resolver accepted an unknown key.';
  exception when sqlstate 'PT401' then null; end;
  begin
    perform public.fufy_club_admin_key_actor(gen_random_uuid(),v_admin_hash);
    raise exception 'The personal key crossed its project scope.';
  exception when sqlstate 'PT401' then null; end;
  update public.fufy_club_admin_access set active=false where project_id=v_project;
  begin
    perform public.fufy_club_admin_key_actor(v_project,v_admin_hash);
    raise exception 'An inactive personal key authenticated.';
  exception when sqlstate 'PT401' then null; end;
  update public.fufy_club_admin_access set active=true,revoked_at=clock_timestamp() where project_id=v_project;
  begin
    perform public.fufy_club_admin_key_actor(v_project,v_admin_hash);
    raise exception 'A revoked personal key authenticated.';
  exception when sqlstate 'PT401' then null; end;
  update public.fufy_club_admin_access set revoked_at=null,actor_user_id=v_other_actor where project_id=v_project;
  begin
    perform public.fufy_club_admin_key_actor(v_project,v_admin_hash);
    raise exception 'A board account was accepted as the personal superadmin.';
  exception when sqlstate 'PT401' then null; end;
  update public.fufy_club_admin_access set actor_user_id=v_actor where project_id=v_project;
  begin
    -- The expected resolver exception rolls this subtransaction back, so the
    -- profile is restored before the next assertion or client-role checks.
    update public.profiles set active=false where user_id=v_actor;
    perform public.fufy_club_admin_key_actor(v_project,v_admin_hash);
    raise exception 'A disabled user retained personal-key access.';
  exception when sqlstate 'PT401' then null; end;
  if not exists(select 1 from public.profiles where user_id=v_actor and active and role='superadmin')
    or public.fufy_club_admin_key_actor(v_project,v_admin_hash) is distinct from v_actor then
    raise exception 'The profile subtransaction was not restored.';
  end if;
end $checks$;
reset role;

set local role anon;
do $anon_reads$
begin
  begin perform key_hash from public.fufy_club_admin_access; raise exception 'anon read administrator hashes.';
  exception when insufficient_privilege then null; end;
  begin perform access_key_hash from public.fufy_club_invites; raise exception 'anon read club key hashes.';
  exception when insufficient_privilege then null; end;
end $anon_reads$;
reset role;
set local role authenticated;
do $authenticated_reads$
begin
  begin perform key_hash from public.fufy_club_admin_access; raise exception 'authenticated read administrator hashes.';
  exception when insufficient_privilege then null; end;
  begin perform access_key_hash from public.fufy_club_invites; raise exception 'authenticated read club key hashes.';
  exception when insufficient_privilege then null; end;
end $authenticated_reads$;
reset role;
rollback;

do $cleanup$
begin
  if exists(select 1 from public.fufy_club_invites where access_key_hash=encode(extensions.digest('__FUFY_ACCESS_ROLLBACK__ club-key','sha256'),'hex'))
    or exists(select 1 from public.fufy_club_admin_access where key_hash=encode(extensions.digest('__FUFY_ACCESS_ROLLBACK__ admin-key','sha256'),'hex')) then
    raise exception 'A test credential survived ROLLBACK.';
  end if;
  if not exists(select 1 from public.profiles where user_id='23b66fef-65d4-4e0f-a196-6ed727d47a01' and active and role='superadmin') then
    raise exception 'The verified profile did not survive ROLLBACK unchanged.';
  end if;
end $cleanup$;
select 'PASS: permanent club access, legacy compatibility, scoped personal actor, revocation, private grants and rollback verified' as result;
