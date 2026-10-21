-- A club's table closes when the championship starts. Exceptions are individual
-- Control Center operations; no exception reopens access for a club delegate.
create table public.fufy_club_roster_changes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.fufy_club_submissions(team_id),
  player_id uuid not null references public.fufy_club_players(id),
  player_name text not null,
  action text not null check(action in ('added','updated','removed')),
  is_exception boolean not null,
  reason text,
  organization_authorizer text,
  approval_reference text,
  club_approvals jsonb not null default '[]'::jsonb,
  actor_user_id uuid not null,
  before_player jsonb,
  after_player jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index fufy_roster_changes_team on public.fufy_club_roster_changes(team_id,created_at desc);
alter table public.fufy_club_roster_changes enable row level security;
revoke all on public.fufy_club_roster_changes from public,anon,authenticated;
grant select,insert,update,delete on public.fufy_club_roster_changes to service_role;
create policy fufy_no_direct_client_access on public.fufy_club_roster_changes
as restrictive for all to anon,authenticated using(false) with check(false);

create or replace function private.fufy_edit_allowed(target_team uuid) returns boolean
language sql volatile security invoker set search_path='' as $fn$
  select s.locked_at is null and not exists (
    select 1 from public.fufy_matches m
    where m.project_id=t.project_id and m.status<>'cancelled'
      and (m.status in ('in_progress','final') or m.starts_at<=clock_timestamp())
  ) from public.fufy_club_submissions s join public.project_teams t on t.id=s.team_id
  where s.team_id=target_team;
$fn$;

create function private.fufy_admin_roster_context(target_team uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
  select coalesce(current_setting('app.fufy_admin_roster_team',true)=target_team::text,false);
$fn$;

create function private.fufy_require_roster_admin(actor_id uuid,project_id uuid) returns void
language plpgsql security invoker set search_path='' as $fn$
begin
  if not exists (
    select 1 from public.profiles p where p.user_id=actor_id and p.active
      and (p.role in ('superadmin','board') or exists (
        select 1 from public.project_user_access a where a.user_id=actor_id
          and a.project_id=fufy_require_roster_admin.project_id and a.access_role in ('editor','manager')
      ))
  ) then
    raise exception 'Tu cuenta no está autorizada para modificar la nómina desde Control Center.' using errcode='PT403';
  end if;
end $fn$;

-- Capture the first start persistently. Rescheduling a match later cannot undo
-- a closure already observed by the portal or the match-state trigger.
create function public.fufy_close_started_rosters(p_project_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare first_at timestamptz; started boolean; affected integer;
begin
  select min(starts_at),coalesce(bool_or(status in ('in_progress','final') or starts_at<=clock_timestamp()),false)
    into first_at,started from public.fufy_matches where project_id=p_project_id and status<>'cancelled';
  if started then
    with closed as (
      update public.fufy_club_submissions s set locked_at=clock_timestamp(),unlock_until=null,unlock_reason=null
      from public.project_teams t where t.id=s.team_id and t.project_id=p_project_id and s.locked_at is null
      returning s.team_id
    ) insert into public.fufy_club_audit(team_id,action,detail)
      select team_id,'roster_closed_first_match',jsonb_build_object('first_match_at',first_at) from closed;
    get diagnostics affected=row_count;
  end if;
  return jsonb_build_object('first_match_at',first_at,'tournament_started',started,'closed_count',coalesce(affected,0));
end $fn$;

create function private.fufy_capture_match_start() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  -- Match permissions are enforced on the originating write. This narrowly
  -- scoped trigger can only close that match's project, never reopen it.
  if new.status<>'cancelled' and (new.status in ('in_progress','final') or new.starts_at<=clock_timestamp()) then
    perform public.fufy_close_started_rosters(new.project_id);
  end if;
  return new;
end $fn$;
create trigger fufy_capture_match_start after insert or update of starts_at,status on public.fufy_matches
for each row execute function private.fufy_capture_match_start();

create function private.fufy_preserve_match_start() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  -- OLD is still visible here. A started match cannot silently reopen the
  -- tournament by being moved into the future, cancelled, or removed.
  if old.status<>'cancelled' and (old.status in ('in_progress','final') or old.starts_at<=clock_timestamp()) then
    perform public.fufy_close_started_rosters(old.project_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $fn$;
create trigger fufy_preserve_match_start before update or delete on public.fufy_matches
for each row execute function private.fufy_preserve_match_start();

create or replace function private.fufy_player_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if tg_op='UPDATE' and new.team_id is distinct from old.team_id then
    raise exception 'No se puede mover un jugador a otro club.' using errcode='23514';
  end if;
  perform 1 from public.fufy_club_submissions where team_id=new.team_id for update;
  if (tg_op='INSERT' or (to_jsonb(new)-array['document_key','updated_at','review_status','review_note','reviewed_by','reviewed_at']) is distinct from (to_jsonb(old)-array['document_key','updated_at','review_status','review_note','reviewed_by','reviewed_at']))
     and not private.fufy_edit_allowed(new.team_id) and not private.fufy_admin_roster_context(new.team_id) then
    raise exception 'La nómina está cerrada. Solo Control Center puede registrar una excepción autorizada por la organización y todos los clubes.' using errcode='PT423';
  end if;
  if new.removed_at is null and (select count(*) from public.fufy_club_players where team_id=new.team_id and removed_at is null and id<>new.id)>=25 then
    raise exception 'La nómina admite hasta 25 jugadores.' using errcode='23514';
  end if;
  new.updated_at=clock_timestamp();
  return new;
end $fn$;

create or replace function private.fufy_submission_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if (new.delegate_name,new.delegate_email,new.delegate_phone,new.manager_name,new.manager_phone,new.captain_name,new.first_aid_name,new.first_aid_phone,new.club_notes,new.accepted_bases,new.confirmed_accuracy,new.privacy_consent,new.club_city,new.club_country) is distinct from
     (old.delegate_name,old.delegate_email,old.delegate_phone,old.manager_name,old.manager_phone,old.captain_name,old.first_aid_name,old.first_aid_phone,old.club_notes,old.accepted_bases,old.confirmed_accuracy,old.privacy_consent,old.club_city,old.club_country)
     and not private.fufy_edit_allowed(new.team_id) then
    raise exception 'La nómina está cerrada. Los datos de la delegación ya no se pueden modificar.' using errcode='PT423';
  end if;
  if new.status='submitted' and new.status is distinct from old.status
     and not private.fufy_edit_allowed(new.team_id) and not private.fufy_admin_roster_context(new.team_id) then
    raise exception 'La nómina está cerrada. La organización gestiona las excepciones desde Control Center.' using errcode='PT423';
  end if;
  return new;
end $fn$;

create function public.fufy_admin_roster_change(
  p_team_id uuid,p_actor_id uuid,p_action text,p_player jsonb,
  p_expected_updated_at timestamptz default null,p_exception jsonb default null
) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare
  event_project_id uuid; is_closed boolean; player_id uuid; operation text;
  old_player public.fufy_club_players; saved public.fufy_club_players; clean public.fufy_club_players;
  approvals jsonb='[]'::jsonb; item jsonb; club record; club_ids uuid[]; submitted_ids uuid[];
  reason_text text; org_name text; reference_text text; prior_context text; change_id uuid;
begin
  select t.project_id into event_project_id from public.project_teams t join public.projects p on p.id=t.project_id
    where t.id=p_team_id and p.code='FUFY2026' and t.active and t.status in ('organizer','confirmed','roster_pending');
  if event_project_id is null then raise exception 'El club no está habilitado para esta nómina.' using errcode='PT403'; end if;
  perform private.fufy_require_roster_admin(p_actor_id,event_project_id);
  if p_action not in ('save','delete') or p_action is null or jsonb_typeof(p_player) is distinct from 'object' then
    raise exception 'La operación de nómina no es válida.' using errcode='PT400';
  end if;
  perform public.fufy_close_started_rosters(event_project_id);
  perform 1 from public.fufy_club_submissions where team_id=p_team_id for update;
  if not found then raise exception 'La nómina de este club todavía no está habilitada.' using errcode='PT400'; end if;
  is_closed=not private.fufy_edit_allowed(p_team_id);
  if p_player->>'id' is not null then
    begin player_id=(p_player->>'id')::uuid;
    exception when invalid_text_representation then raise exception 'El jugador seleccionado no es válido.' using errcode='PT400'; end;
    select * into old_player from public.fufy_club_players where id=player_id and team_id=p_team_id and removed_at is null for update;
    if not found then raise exception 'El jugador no está disponible en la nómina de este club.' using errcode='PT400'; end if;
    if p_expected_updated_at is distinct from old_player.updated_at then
      raise exception 'La nómina cambió en otra sesión. Actualiza antes de guardar.' using errcode='PT409';
    end if;
  elsif p_action='delete' then
    raise exception 'Selecciona el jugador que quieres retirar de la nómina.' using errcode='PT400';
  end if;
  if is_closed then
    if p_exception is null then
      raise exception 'La nómina está cerrada. Registra la condición especial y las autorizaciones antes de guardar desde Control Center.' using errcode='PT423';
    end if;
    if jsonb_typeof(p_exception) is distinct from 'object' then raise exception 'Revisa la autorización especial de la nómina.' using errcode='PT400'; end if;
    reason_text=btrim(p_exception->>'reason'); org_name=btrim(p_exception->>'organization_authorizer'); reference_text=btrim(p_exception->>'approval_reference');
    if (length(reason_text) between 10 and 1200) is not true or (length(org_name) between 3 and 160) is not true
       or (length(reference_text) between 5 and 1000) is not true or (p_exception->'organization_agreed'='true'::jsonb) is not true then
      raise exception 'La excepción de nómina requiere motivo, responsable de organización, acuerdo confirmado y referencia de la autorización.' using errcode='PT400';
    end if;
    if jsonb_typeof(p_exception->'club_approvals') is distinct from 'array' then
      raise exception 'La excepción de nómina requiere la autorización de todos los representantes de los clubes.' using errcode='PT400';
    end if;
    select array_agg(t.id order by t.id) into club_ids from public.project_teams t
      where t.project_id=event_project_id and t.active and t.status in ('organizer','confirmed','roster_pending');
    if jsonb_array_length(p_exception->'club_approvals')<>coalesce(array_length(club_ids,1),0) then
      raise exception 'Deben autorizar todos los clubes participantes, sin omitir ni repetir un representante de club.' using errcode='PT400';
    end if;
    begin
      select array_agg((a->>'team_id')::uuid order by (a->>'team_id')::uuid) into submitted_ids
        from jsonb_array_elements(p_exception->'club_approvals') a;
    exception when invalid_text_representation then raise exception 'Revisa los clubes que autorizan la excepción de nómina.' using errcode='PT400'; end;
    if submitted_ids is distinct from club_ids then raise exception 'La autorización debe corresponder exactamente a todos los clubes participantes.' using errcode='PT400'; end if;
    for club in select id,name from public.project_teams where id=any(club_ids) order by sort_order,id loop
      select a into item from jsonb_array_elements(p_exception->'club_approvals') a where (a->>'team_id')::uuid=club.id;
      if jsonb_typeof(item) is distinct from 'object' or (item->'approved'='true'::jsonb) is not true
        or (length(btrim(item->>'representative_name')) between 3 and 160) is not true then
        raise exception 'Cada club debe tener identificado a su representante y confirmada su autorización.' using errcode='PT400';
      end if;
      approvals=approvals||jsonb_build_array(jsonb_build_object('team_id',club.id,'team_name',club.name,'representative_name',btrim(item->>'representative_name'),'approved',true));
    end loop;
  end if;
  prior_context=current_setting('app.fufy_admin_roster_team',true);
  -- Before kickoff, normal guards still run: if kickoff occurs while this
  -- operation is in progress, the caller must retry with the authorization.
  if is_closed then perform set_config('app.fufy_admin_roster_team',p_team_id::text,true); end if;
  if p_action='delete' then
    update public.fufy_club_players set removed_at=clock_timestamp() where id=player_id returning * into saved;
    operation='removed';
  else
    -- Only these player fields are writable. Client-supplied review status,
    -- timestamps, team ownership and the generated document key are ignored.
    select * into clean from jsonb_populate_record(null::public.fufy_club_players,p_player);
    if player_id is null then
      insert into public.fufy_club_players(team_id,full_name,document_type,document_number,birth_date,nationality,jersey_number,emergency_contact,emergency_phone,federation_status,coverage_type,insurance_provider,insurance_valid_until,signature_declared,notes)
      values(p_team_id,clean.full_name,clean.document_type,clean.document_number,clean.birth_date,coalesce(clean.nationality,''),clean.jersey_number,coalesce(clean.emergency_contact,''),coalesce(clean.emergency_phone,''),coalesce(clean.federation_status,'pending'),coalesce(clean.coverage_type,'pending'),coalesce(clean.insurance_provider,''),clean.insurance_valid_until,coalesce(clean.signature_declared,false),coalesce(clean.notes,'')) returning * into saved;
      operation='added';
    else
      update public.fufy_club_players set full_name=clean.full_name,document_type=clean.document_type,document_number=clean.document_number,birth_date=clean.birth_date,nationality=coalesce(clean.nationality,''),jersey_number=clean.jersey_number,emergency_contact=coalesce(clean.emergency_contact,''),emergency_phone=coalesce(clean.emergency_phone,''),federation_status=coalesce(clean.federation_status,'pending'),coverage_type=coalesce(clean.coverage_type,'pending'),insurance_provider=coalesce(clean.insurance_provider,''),insurance_valid_until=clean.insurance_valid_until,signature_declared=coalesce(clean.signature_declared,false),notes=coalesce(clean.notes,''),review_status='pending',review_note='',reviewed_at=null,reviewed_by=null
      where id=player_id returning * into saved;
      operation='updated';
    end if;
  end if;
  if is_closed then
    update public.fufy_club_submissions set status='submitted',submitted_at=clock_timestamp() where team_id=p_team_id;
  end if;
  perform set_config('app.fufy_admin_roster_team',coalesce(prior_context,''),true);
  insert into public.fufy_club_roster_changes(team_id,player_id,player_name,action,is_exception,reason,organization_authorizer,approval_reference,club_approvals,actor_user_id,before_player,after_player)
  values(p_team_id,saved.id,saved.full_name,operation,is_closed,reason_text,org_name,reference_text,approvals,p_actor_id,case when player_id is null then null else to_jsonb(old_player) end,to_jsonb(saved)) returning id into change_id;
  insert into public.fufy_club_audit(team_id,action,actor_user_id,detail)
    values(p_team_id,'admin_player_'||operation,p_actor_id,jsonb_build_object('player_id',saved.id,'change_id',change_id,'is_exception',is_closed));
  return jsonb_build_object('player_id',saved.id,'change_id',change_id,'is_exception',is_closed);
end $fn$;

create function public.fufy_admin_close_rosters(p_project_id uuid,p_actor_id uuid) returns integer
language plpgsql security invoker set search_path='' as $fn$
declare affected integer;
begin
  perform private.fufy_require_roster_admin(p_actor_id,p_project_id);
  with closed as (
    update public.fufy_club_submissions s set locked_at=clock_timestamp(),unlock_until=null,unlock_reason=null
    from public.project_teams t where t.id=s.team_id and t.project_id=p_project_id and s.locked_at is null returning s.team_id
  ) insert into public.fufy_club_audit(team_id,action,actor_user_id) select team_id,'roster_closed_control_center',p_actor_id from closed;
  get diagnostics affected=row_count;
  return affected;
end $fn$;

revoke all on function private.fufy_admin_roster_context(uuid),private.fufy_require_roster_admin(uuid,uuid),private.fufy_capture_match_start(),private.fufy_preserve_match_start(),public.fufy_close_started_rosters(uuid),public.fufy_admin_roster_change(uuid,uuid,text,jsonb,timestamptz,jsonb),public.fufy_admin_close_rosters(uuid,uuid) from public,anon,authenticated;
grant execute on function private.fufy_admin_roster_context(uuid),private.fufy_require_roster_admin(uuid,uuid),public.fufy_close_started_rosters(uuid),public.fufy_admin_roster_change(uuid,uuid,text,jsonb,timestamptz,jsonb),public.fufy_admin_close_rosters(uuid,uuid) to service_role;
-- Remove legacy reopen grants. This does not close pre-tournament rosters.
update public.fufy_club_submissions set unlock_until=null,unlock_reason=null where unlock_until is not null or unlock_reason is not null;
