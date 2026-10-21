-- Private tournament dossiers. Browser clients never receive table grants.
grant usage on schema private to service_role;
-- Access is exclusively through fufy-club-portal, which verifies a scoped
-- invitation or an active organizational JWT before using its service key.
create table public.fufy_club_submissions (
  team_id uuid primary key references public.project_teams(id),
  delegate_name text not null default '',
  delegate_email text not null default '',
  delegate_phone text not null default '',
  manager_name text not null default '',
  manager_phone text not null default '',
  captain_name text not null default '',
  first_aid_name text not null default '',
  first_aid_phone text not null default '',
  club_notes text not null default '',
  accepted_bases boolean not null default false,
  confirmed_accuracy boolean not null default false,
  privacy_consent boolean not null default false,
  status text not null default 'draft' check(status in ('draft','submitted','observed','approved')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text not null default '',
  locked_at timestamptz,
  unlock_until timestamptz,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fufy_club_invites (
  team_id uuid primary key references public.fufy_club_submissions(team_id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_by uuid,
  revoked_at timestamptz,
  check(expires_at > created_at)
);

create table public.fufy_club_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.fufy_club_submissions(team_id),
  full_name text not null check(length(full_name) between 3 and 160),
  document_type text not null check(document_type in ('RUT','DNI','Pasaporte','Otro')),
  document_number text not null check(length(document_number) between 3 and 40),
  document_key text generated always as (upper(regexp_replace(document_number, '[^a-zA-Z0-9]', '', 'g'))) stored,
  birth_date date not null check(birth_date between date '1900-01-01' and date '2026-10-24'),
  nationality text not null default '',
  jersey_number smallint check(jersey_number between 0 and 999),
  emergency_contact text not null default '',
  emergency_phone text not null default '',
  federation_status text not null default 'pending' check(federation_status in ('pending','declared','not_applicable')),
  coverage_type text not null default 'pending' check(coverage_type in ('pending','insurance','prevision','other')),
  insurance_provider text not null default '',
  insurance_valid_until date,
  signature_declared boolean not null default false,
  notes text not null default '',
  review_status text not null default 'pending' check(review_status in ('pending','observed','reviewed')),
  review_note text not null default '',
  reviewed_by uuid,
  reviewed_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,team_id)
);
create unique index fufy_player_identity_per_team on public.fufy_club_players(team_id,document_type,document_key) where removed_at is null;
create index fufy_players_team on public.fufy_club_players(team_id);

create table public.fufy_club_documents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.fufy_club_submissions(team_id),
  player_id uuid,
  kind text not null check(kind in ('signed_roster','manager_declaration','player_declaration','insurance','federation','identity','other')),
  storage_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 180),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes integer not null check(size_bytes > 0 and size_bytes <= 5242880),
  source_updated_at timestamptz not null,
  is_current boolean not null default true,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(player_id,team_id) references public.fufy_club_players(id,team_id)
);
create index fufy_documents_team on public.fufy_club_documents(team_id);
create index fufy_documents_player_team on public.fufy_club_documents(player_id,team_id);

create table public.fufy_club_audit (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.fufy_club_submissions(team_id),
  action text not null,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index fufy_audit_team_created on public.fufy_club_audit(team_id,created_at desc);

-- Fixed allowlist of table names; no public or authenticated data paths.
do $security$
declare t text;
begin
  foreach t in array array['fufy_club_submissions','fufy_club_invites','fufy_club_players','fufy_club_documents','fufy_club_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select, insert, update, delete on table public.%I to service_role',t);
    execute format('create policy fufy_no_direct_client_access on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',t);
  end loop;
end
$security$;
revoke all on sequence public.fufy_club_audit_id_seq from public,anon,authenticated;
grant usage,select on sequence public.fufy_club_audit_id_seq to service_role;

-- Private files have no client Storage policy. Only the verified Edge function
-- can upload them or issue a two-minute download URL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('fufy-clubs-private','fufy-clubs-private',false,5242880,array['application/pdf','image/jpeg','image/png']);
create policy fufy_private_files_no_direct_clients on storage.objects
as restrictive for all to anon,authenticated
using(bucket_id<>'fufy-clubs-private') with check(bucket_id<>'fufy-clubs-private');

create function private.fufy_submission_timestamp() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  new.updated_at=clock_timestamp();
  return new;
end $fn$;
create trigger fufy_submission_timestamp before update on public.fufy_club_submissions
for each row execute function private.fufy_submission_timestamp();

create function private.fufy_manager_changed() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if new.manager_name is distinct from old.manager_name then
    update public.fufy_club_documents set is_current=false
      where team_id=new.team_id and removed_at is null and is_current and kind in ('signed_roster','manager_declaration');
  end if;
  return new;
end $fn$;
create trigger fufy_manager_changed after update on public.fufy_club_submissions
for each row execute function private.fufy_manager_changed();

create function private.fufy_edit_allowed(target_team uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
  select coalesce(s.unlock_until>now(),false) or (s.locked_at is null and not exists (
    select 1 from public.fufy_matches m where (m.home_team_id=target_team or m.away_team_id=target_team)
      and m.status<>'cancelled' and (m.status in ('in_progress','final') or m.starts_at<=now())
  )) from public.fufy_club_submissions s where s.team_id=target_team;
$fn$;

create function private.fufy_submission_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if (new.delegate_name,new.delegate_email,new.delegate_phone,new.manager_name,new.manager_phone,new.captain_name,new.first_aid_name,new.first_aid_phone,new.club_notes,new.accepted_bases,new.confirmed_accuracy,new.privacy_consent) is distinct from
     (old.delegate_name,old.delegate_email,old.delegate_phone,old.manager_name,old.manager_phone,old.captain_name,old.first_aid_name,old.first_aid_phone,old.club_notes,old.accepted_bases,old.confirmed_accuracy,old.privacy_consent)
     or (new.status='submitted' and new.status is distinct from old.status) then
    if not private.fufy_edit_allowed(new.team_id) then
      raise exception 'La nómina está cerrada; solicita una corrección al Comité Organizador.' using errcode='23514';
    end if;
  end if;
  return new;
end $fn$;
create trigger fufy_submission_guard before update on public.fufy_club_submissions
for each row execute function private.fufy_submission_guard();

create function private.fufy_player_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if tg_op='UPDATE' and new.team_id is distinct from old.team_id then
    raise exception 'No se puede mover un jugador a otro club.' using errcode='23514';
  end if;
  -- Serialize changes to the roster and its version before checking the limit.
  perform 1 from public.fufy_club_submissions where team_id=new.team_id for update;
  if (tg_op='INSERT' or (to_jsonb(new)-array['document_key','updated_at','review_status','review_note','reviewed_by','reviewed_at']) is distinct from (to_jsonb(old)-array['document_key','updated_at','review_status','review_note','reviewed_by','reviewed_at'])) and not private.fufy_edit_allowed(new.team_id) then
    raise exception 'La nómina está cerrada; solicita una corrección al Comité Organizador.' using errcode='23514';
  end if;
  if new.removed_at is null and (select count(*) from public.fufy_club_players where team_id=new.team_id and removed_at is null and id<>new.id)>=25 then
    raise exception 'La nómina admite hasta 25 jugadores.' using errcode='23514';
  end if;
  new.updated_at=clock_timestamp();
  return new;
end $fn$;
create trigger fufy_player_guard before insert or update on public.fufy_club_players
for each row execute function private.fufy_player_guard();

create function private.fufy_player_changed() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare identity_changed boolean; data_changed boolean;
begin
  if tg_op='INSERT' then
    identity_changed=true; data_changed=true;
  else
    identity_changed=(new.full_name,new.document_type,new.document_number,new.birth_date,new.nationality,new.removed_at) is distinct from (old.full_name,old.document_type,old.document_number,old.birth_date,old.nationality,old.removed_at);
    data_changed=(to_jsonb(new)-array['updated_at','review_status','review_note','reviewed_by','reviewed_at']) is distinct from (to_jsonb(old)-array['updated_at','review_status','review_note','reviewed_by','reviewed_at']);
  end if;
  if identity_changed then
    update public.fufy_club_documents set is_current=false where team_id=new.team_id and is_current and removed_at is null
      and (kind in ('signed_roster','manager_declaration') or player_id=new.id or (player_id is null and kind in ('insurance','federation')));
  end if;
  if data_changed then
    update public.fufy_club_submissions set status='draft',reviewed_at=null,reviewed_by=null where team_id=new.team_id;
  else
    update public.fufy_club_submissions set
      status=case when status='approved' and new.review_status in ('observed','pending') then 'observed' else status end,
      reviewed_at=case when new.review_status in ('observed','pending') then null else reviewed_at end,
      reviewed_by=case when new.review_status in ('observed','pending') then null else reviewed_by end,
      updated_at=clock_timestamp() where team_id=new.team_id;
  end if;
  return new;
end $fn$;
create trigger fufy_player_changed after insert or update on public.fufy_club_players
for each row execute function private.fufy_player_changed();

create function private.fufy_document_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare current_version timestamptz;
begin
  select updated_at into current_version from public.fufy_club_submissions where team_id=new.team_id for update;
  if tg_op='INSERT' and new.source_updated_at is distinct from current_version then
    raise exception 'La nómina cambió durante la carga. Recarga y comprueba que el documento corresponda a la versión actual.' using errcode='23514';
  end if;
  if (tg_op='INSERT' or new.removed_at is distinct from old.removed_at) and not private.fufy_edit_allowed(new.team_id) then
    raise exception 'La nómina está cerrada; solicita una corrección al Comité Organizador.' using errcode='23514';
  end if;
  return new;
end $fn$;
create trigger fufy_document_guard before insert or update on public.fufy_club_documents
for each row execute function private.fufy_document_guard();

create function private.fufy_document_changed() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  -- Signature invalidation also updates the dossier version atomically.
  update public.fufy_club_submissions set status='draft',reviewed_at=null,reviewed_by=null where team_id=new.team_id;
  return new;
end $fn$;
create trigger fufy_document_changed after insert or update on public.fufy_club_documents
for each row execute function private.fufy_document_changed();

revoke all on function private.fufy_submission_timestamp(),private.fufy_manager_changed(),private.fufy_edit_allowed(uuid),private.fufy_submission_guard(),private.fufy_player_guard(),private.fufy_player_changed(),private.fufy_document_guard(),private.fufy_document_changed() from public,anon,authenticated;
grant execute on function private.fufy_submission_timestamp(),private.fufy_manager_changed(),private.fufy_edit_allowed(uuid),private.fufy_submission_guard(),private.fufy_player_guard(),private.fufy_player_changed(),private.fufy_document_guard(),private.fufy_document_changed() to service_role;

insert into public.fufy_club_submissions(team_id)
select t.id from public.project_teams t join public.projects p on p.id=t.project_id
where p.code='FUFY2026' and t.active and t.status in ('organizer','confirmed','roster_pending');
