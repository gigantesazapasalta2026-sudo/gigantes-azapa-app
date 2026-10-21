-- Preserve existing private links while adding legible club keys.
-- The existing expires_at > created_at CHECK continues to validate dated
-- credentials; SQL CHECK semantics also allow NULL (no scheduled expiry).
alter table public.fufy_club_invites alter column expires_at drop not null;
alter table public.fufy_club_invites add column access_key_hash text unique
  check(access_key_hash ~ '^[a-f0-9]{64}$');
comment on column public.fufy_club_invites.expires_at is
  'NULL means no scheduled expiry. active and revoked_at remain the revocation controls.';

-- A personal credential only authorizes this portal for its project and actor.
-- It neither creates an Auth session nor grants a global Supabase role.
create table public.fufy_club_admin_access (
  project_id uuid primary key references public.projects(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique check(key_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.fufy_club_admin_access enable row level security;
revoke all on public.fufy_club_admin_access from public,anon,authenticated;
grant select,insert,update,delete on public.fufy_club_admin_access to service_role;
create policy fufy_no_direct_client_access on public.fufy_club_admin_access
  as restrictive for all to anon,authenticated using(false) with check(false);

create function public.fufy_club_admin_key_actor(p_project_id uuid,p_key_hash text)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare v_actor uuid;
begin
  if (p_key_hash ~ '^[a-f0-9]{64}$') is not true then
    raise exception 'La clave de Control Center es inválida o fue revocada.' using errcode='PT401';
  end if;
  select a.actor_user_id into v_actor
    from public.fufy_club_admin_access a
    join public.projects p on p.id=a.project_id and p.code='FUFY2026'
    join public.profiles profile on profile.user_id=a.actor_user_id
      and profile.active and profile.role='superadmin'
    where a.project_id=p_project_id and a.key_hash=p_key_hash
      and a.active and a.revoked_at is null;
  if v_actor is null then
    raise exception 'La clave de Control Center es inválida o fue revocada.' using errcode='PT401';
  end if;
  return v_actor;
end $fn$;
revoke all on function public.fufy_club_admin_key_actor(uuid,text) from public,anon,authenticated;
grant execute on function public.fufy_club_admin_key_actor(uuid,text) to service_role;
