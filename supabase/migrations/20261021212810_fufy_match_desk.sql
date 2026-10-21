-- Copa FUFY Classic: one continuous period. Credentials, identified shifts and
-- audit stay private; public event rows contain sports information only.
create table public.fufy_desk_access (
  project_id uuid primary key references public.projects(id),
  password_hash text not null check(password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  active boolean not null default true,
  credential_version bigint not null default 1 check(credential_version>0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.fufy_desk_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fufy_desk_access(project_id),
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  operator_name text not null check(length(btrim(operator_name)) between 3 and 80),
  credential_version bigint not null check(credential_version>0),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check(expires_at>started_at)
);
create index fufy_desk_sessions_project on public.fufy_desk_sessions(project_id,started_at desc);
create table public.fufy_desk_login_limits (
  project_id uuid not null references public.projects(id),
  ip_hash text not null check(ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null check(attempt_count between 1 and 21),
  window_started_at timestamptz not null,
  primary key(project_id,ip_hash)
);

alter table public.fufy_matches
  add column desk_enabled boolean not null default false,
  add column desk_phase text not null default 'not_started'
    check(desk_phase in ('not_started','playing','suspended','finished')),
  add constraint fufy_desk_match_phase_consistent check(
    (not desk_enabled and desk_phase='not_started') or
    (desk_enabled and ((desk_phase in ('playing','suspended') and status='in_progress') or
                      (desk_phase='finished' and status='final')))
  );

create table public.fufy_match_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  match_id uuid not null references public.fufy_matches(id),
  team_id uuid not null references public.project_teams(id),
  player_id uuid,
  player_name text,
  jersey_number integer check(jersey_number between 0 and 999),
  kind text not null check(kind in ('try','conversion','penalty','drop_goal','penalty_try','yellow_card','red_card')),
  points smallint not null,
  period smallint not null default 1 check(period=1),
  match_minute smallint check(match_minute between 0 and 120),
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  foreign key(player_id,team_id) references public.fufy_club_players(id,team_id),
  check(points=case kind when 'try' then 5 when 'conversion' then 2 when 'penalty' then 3
    when 'drop_goal' then 3 when 'penalty_try' then 7 else 0 end),
  check((kind='penalty_try' and player_id is null and player_name is null and jersey_number is null)
    or (kind<>'penalty_try' and player_id is not null and player_name is not null))
);
create index fufy_events_project_created on public.fufy_match_events(project_id,created_at);
create index fufy_events_match_created on public.fufy_match_events(match_id,created_at);
create index fufy_events_player on public.fufy_match_events(player_id) where player_id is not null;

create table public.fufy_desk_commands (
  request_id uuid primary key,
  project_id uuid not null references public.projects(id),
  session_id uuid not null references public.fufy_desk_sessions(id),
  match_id uuid not null references public.fufy_matches(id),
  command text not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index fufy_desk_commands_session on public.fufy_desk_commands(session_id,created_at);
create index fufy_desk_commands_match on public.fufy_desk_commands(match_id);
create table public.fufy_desk_audit (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  session_id uuid references public.fufy_desk_sessions(id),
  actor_user_id uuid,
  match_id uuid references public.fufy_matches(id),
  event_id uuid references public.fufy_match_events(id),
  operator_name text not null,
  action text not null,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
create index fufy_desk_audit_project on public.fufy_desk_audit(project_id,created_at desc);
create index fufy_desk_audit_session on public.fufy_desk_audit(session_id);
create index fufy_desk_audit_match on public.fufy_desk_audit(match_id);
create index fufy_desk_audit_event on public.fufy_desk_audit(event_id);

do $security$
declare v_table text;
begin
  foreach v_table in array array['fufy_desk_access','fufy_desk_sessions','fufy_desk_login_limits','fufy_desk_commands','fufy_desk_audit'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update,delete on public.%I to service_role',v_table);
    execute format('create policy fufy_no_direct_client_access on public.%I as restrictive for all to anon,authenticated using(false) with check(false)',v_table);
  end loop;
end $security$;
alter table public.fufy_match_events enable row level security;
revoke all on public.fufy_match_events from public,anon,authenticated;
grant select on public.fufy_match_events to anon,authenticated;
grant select,insert,update,delete on public.fufy_match_events to service_role;
create policy fufy_public_sports_events on public.fufy_match_events for select to anon,authenticated
using(exists(select 1 from public.projects p where p.id=fufy_match_events.project_id and p.public_visible));
create policy fufy_public_sports_events_boundary on public.fufy_match_events as restrictive for select to anon,authenticated
using(exists(select 1 from public.projects p where p.id=fufy_match_events.project_id and p.public_visible));

-- Trigger bodies do not call service-only helpers: permitted fixture edits by
-- authenticated staff must continue to work under SECURITY INVOKER.
create function private.fufy_desk_match_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare v_context boolean;
begin
  if tg_op='DELETE' then
    if old.desk_enabled then
      raise exception 'El acta digital conserva su historial y no se puede eliminar desde el editor de fixture.' using errcode='PT423';
    end if;
    return old;
  end if;
  v_context=coalesce(current_setting('app.fufy_desk_match',true)=new.id::text,false);
  if tg_op='INSERT' then
    if (new.desk_enabled or new.desk_phase<>'not_started') and not v_context then
      raise exception 'El acta digital se inicia únicamente desde la mesa de control.' using errcode='PT423';
    end if;
    new.updated_at=clock_timestamp();
  else
    if old.desk_enabled and (not new.desk_enabled or new.id is distinct from old.id or new.project_id is distinct from old.project_id) then
      raise exception 'No se puede desactivar ni trasladar un acta digital iniciada.' using errcode='PT423';
    end if;
    if (old.desk_enabled or new.desk_enabled) and not v_context and
       (new.id,new.project_id,new.home_team_id,new.away_team_id,new.status,new.home_score,new.away_score,new.home_tries,new.away_tries,new.home_yellow,new.away_yellow,new.home_red,new.away_red,new.desk_enabled,new.desk_phase) is distinct from
       (old.id,old.project_id,old.home_team_id,old.away_team_id,old.status,old.home_score,old.away_score,old.home_tries,old.away_tries,old.home_yellow,old.away_yellow,old.home_red,old.away_red,old.desk_enabled,old.desk_phase) then
      raise exception 'Los resultados y estados de esta acta se gestionan únicamente desde la mesa de control.' using errcode='PT423';
    end if;
    new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  end if;
  return new;
end $fn$;
create trigger fufy_desk_match_guard before insert or update or delete on public.fufy_matches
for each row execute function private.fufy_desk_match_guard();

create function private.fufy_desk_event_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if tg_op='DELETE' then
    raise exception 'Los eventos del acta se anulan con un motivo y conservan su historial.' using errcode='PT423';
  end if;
  if coalesce(current_setting('app.fufy_desk_match',true)=new.match_id::text,false) is not true then
    raise exception 'Los eventos se registran únicamente mediante la mesa de control.' using errcode='PT423';
  end if;
  if tg_op='UPDATE' and ((to_jsonb(new)-'voided_at') is distinct from (to_jsonb(old)-'voided_at')
    or old.voided_at is not null or new.voided_at is null) then
    raise exception 'Un evento se corrige anulándolo y registrando el evento correcto.' using errcode='PT423';
  end if;
  return new;
end $fn$;
create trigger fufy_desk_event_guard before insert or update or delete on public.fufy_match_events
for each row execute function private.fufy_desk_event_guard();

-- Writers lock access then session. Rotation takes the same access row first,
-- so a revoked credential cannot finish a new command after rotation commits.
create function private.fufy_desk_require_session(p_token_hash text,p_lock boolean default false)
returns public.fufy_desk_sessions
language plpgsql security invoker set search_path='' as $fn$
declare v_session public.fufy_desk_sessions; v_access public.fufy_desk_access; v_project_id uuid;
begin
  if (p_token_hash ~ '^[0-9a-f]{64}$') is not true then
    raise exception 'El turno no está vigente. Ingresa nuevamente a la mesa de control.' using errcode='PT401';
  end if;
  select s.project_id into v_project_id from public.fufy_desk_sessions s where s.token_hash=p_token_hash;
  if v_project_id is null then raise exception 'El turno no está vigente. Ingresa nuevamente a la mesa de control.' using errcode='PT401'; end if;
  if p_lock then
    select * into v_access from public.fufy_desk_access where project_id=v_project_id for share;
    select * into v_session from public.fufy_desk_sessions where token_hash=p_token_hash and project_id=v_project_id for update;
  else
    select * into v_access from public.fufy_desk_access where project_id=v_project_id;
    select * into v_session from public.fufy_desk_sessions where token_hash=p_token_hash and project_id=v_project_id;
  end if;
  if v_session.id is null or v_access.project_id is null or not v_access.active or v_session.ended_at is not null
    or v_session.credential_version<>v_access.credential_version or v_session.expires_at<=clock_timestamp() or v_access.expires_at<=clock_timestamp() then
    raise exception 'El turno venció o fue cerrado. Ingresa nuevamente a la mesa de control.' using errcode='PT401';
  end if;
  return v_session;
end $fn$;

create function public.fufy_desk_session(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare v_session public.fufy_desk_sessions;
begin
  select * into v_session from private.fufy_desk_require_session(p_token_hash,false);
  return jsonb_build_object('id',v_session.id,'project_id',v_session.project_id,'operator_name',v_session.operator_name,
    'started_at',v_session.started_at,'expires_at',v_session.expires_at);
end $fn$;

create function public.fufy_desk_login(p_project_id uuid,p_password text,p_operator_name text,p_token_hash text,p_ip_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_access public.fufy_desk_access; v_attempts integer; v_session_id uuid; v_now timestamptz; v_name text;
begin
  v_name=btrim(p_operator_name);
  if not exists(select 1 from public.projects where id=p_project_id and code='FUFY2026') then
    return jsonb_build_object('ok',false,'error','La mesa de control no está disponible.','status',403);
  end if;
  if (p_token_hash ~ '^[0-9a-f]{64}$') is not true or (p_ip_hash ~ '^[0-9a-f]{64}$') is not true
    or (length(v_name) between 3 and 80) is not true or v_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok',false,'error','Revisa el nombre del responsable del turno.','status',400);
  end if;
  v_now=clock_timestamp();
  insert into public.fufy_desk_login_limits(project_id,ip_hash,attempt_count,window_started_at)
    values(p_project_id,p_ip_hash,1,v_now)
  on conflict(project_id,ip_hash) do update set
    attempt_count=case when fufy_desk_login_limits.window_started_at<=v_now-interval '15 minutes' then 1 else least(fufy_desk_login_limits.attempt_count+1,21) end,
    window_started_at=case when fufy_desk_login_limits.window_started_at<=v_now-interval '15 minutes' then v_now else fufy_desk_login_limits.window_started_at end
  returning attempt_count into v_attempts;
  if v_attempts>20 then
    return jsonb_build_object('ok',false,'error','Se alcanzó el límite de intentos. Espera 15 minutos antes de volver a ingresar.','status',429);
  end if;
  select * into v_access from public.fufy_desk_access where project_id=p_project_id for share;
  if v_access.project_id is null or not v_access.active or v_access.expires_at<=clock_timestamp()
    or (octet_length(p_password) between 1 and 72) is not true then
    return jsonb_build_object('ok',false,'error','La clave no es válida o el acceso de la mesa venció.','status',401);
  end if;
  if extensions.crypt(p_password,v_access.password_hash) is distinct from v_access.password_hash then
    -- Do not RAISE here: invalid credentials must commit the rate counter.
    return jsonb_build_object('ok',false,'error','La clave no es válida o el acceso de la mesa venció.','status',401);
  end if;
  v_now=clock_timestamp();
  if v_access.expires_at<=v_now then
    return jsonb_build_object('ok',false,'error','El acceso de la mesa venció.','status',401);
  end if;
  insert into public.fufy_desk_sessions(project_id,token_hash,operator_name,credential_version,started_at,expires_at)
    values(p_project_id,p_token_hash,v_name,v_access.credential_version,v_now,least(v_now+interval '12 hours',v_access.expires_at))
    on conflict(token_hash) do nothing returning id into v_session_id;
  if v_session_id is null then return jsonb_build_object('ok',false,'error','Vuelve a iniciar un turno nuevo.','status',409); end if;
  insert into public.fufy_desk_audit(project_id,session_id,operator_name,action)
    values(p_project_id,v_session_id,v_name,'login');
  return jsonb_build_object('ok',true,'session_id',v_session_id);
end $fn$;

create function public.fufy_desk_logout(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare v_session public.fufy_desk_sessions;
begin
  select * into v_session from private.fufy_desk_require_session(p_token_hash,true);
  update public.fufy_desk_sessions set ended_at=clock_timestamp() where id=v_session.id;
  insert into public.fufy_desk_audit(project_id,session_id,operator_name,action)
    values(v_session.project_id,v_session.id,v_session.operator_name,'logout');
  return jsonb_build_object('ok',true);
end $fn$;

create function public.fufy_desk_rotate_access(p_project_id uuid,p_actor_id uuid,p_password text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare v_event_date date; v_expires_at timestamptz; v_hash text;
begin
  perform private.fufy_require_roster_admin(p_actor_id,p_project_id);
  select event_date into v_event_date from public.projects where id=p_project_id and code='FUFY2026';
  if not found then raise exception 'La mesa de control de este proyecto no está disponible.' using errcode='PT403'; end if;
  if (octet_length(p_password) between 16 and 72) is not true or p_password ~ '[[:cntrl:]]' then
    raise exception 'La clave generada para la mesa no es válida.' using errcode='PT400';
  end if;
  v_expires_at=greatest((v_event_date+14)::timestamp at time zone 'UTC',clock_timestamp()+interval '1 day');
  v_hash=extensions.crypt(p_password,extensions.gen_salt('bf',12));
  insert into public.fufy_desk_access(project_id,password_hash,active,credential_version,expires_at,updated_at)
    values(p_project_id,v_hash,true,1,v_expires_at,clock_timestamp())
  on conflict(project_id) do update set password_hash=excluded.password_hash,active=true,
    credential_version=fufy_desk_access.credential_version+1,expires_at=excluded.expires_at,updated_at=clock_timestamp();
  update public.fufy_desk_sessions set ended_at=clock_timestamp() where project_id=p_project_id and ended_at is null;
  insert into public.fufy_desk_audit(project_id,actor_user_id,operator_name,action)
    values(p_project_id,p_actor_id,'Control Center','rotate_access');
  return jsonb_build_object('ok',true);
end $fn$;

create function public.fufy_desk_command(p_token_hash text,p_request_id uuid,p_match_id uuid,
  p_expected_updated_at timestamptz,p_command text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare
  v_session public.fufy_desk_sessions; v_match public.fufy_matches; v_player public.fufy_club_players;
  v_previous public.fufy_desk_commands; v_event public.fufy_match_events;
  v_fingerprint text; v_result jsonb; v_data jsonb; v_reason text; v_kind text;
  v_team_id uuid; v_player_id uuid; v_event_id uuid; v_points smallint; v_minute smallint;
  v_score_home integer; v_score_away integer; v_tries_home integer; v_tries_away integer;
  v_yellow_home integer; v_yellow_away integer; v_red_home integer; v_red_away integer;
  v_phase text; v_prior_context text;
begin
  if p_request_id is null or p_match_id is null or p_command is null
    or p_command not in ('start','resume','finish','suspend','reopen','add_event','void_event')
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'La acción de la mesa no es válida.' using errcode='PT400';
  end if;
  v_fingerprint=encode(extensions.digest(jsonb_build_object('match_id',p_match_id,
    'expected_updated_at',p_expected_updated_at at time zone 'UTC','command',p_command,'payload',p_payload)::text,'sha256'),'hex');
  -- Serialize repeated request IDs even across different matches or shifts.
  perform pg_advisory_xact_lock(hashtextextended('fufy_desk:'||p_request_id::text,0));
  select * into v_session from private.fufy_desk_require_session(p_token_hash,true);
  select * into v_previous from public.fufy_desk_commands where request_id=p_request_id;
  if found then
    if v_previous.session_id<>v_session.id or v_previous.request_hash<>v_fingerprint then
      raise exception 'Ese identificador ya corresponde a otra acción. Actualiza antes de continuar.' using errcode='PT409';
    end if;
    return v_previous.result||jsonb_build_object('replayed',true);
  end if;
  select * into v_match from public.fufy_matches where id=p_match_id and project_id=v_session.project_id for update;
  if not found then raise exception 'El partido no está disponible para este turno.' using errcode='PT403'; end if;
  -- Revalidate after the match lock, including wall-clock expiry after waits.
  select * into v_session from private.fufy_desk_require_session(p_token_hash,true);
  select * into v_previous from public.fufy_desk_commands where request_id=p_request_id;
  if found then
    if v_previous.session_id<>v_session.id or v_previous.request_hash<>v_fingerprint then
      raise exception 'Ese identificador ya corresponde a otra acción. Actualiza antes de continuar.' using errcode='PT409';
    end if;
    return v_previous.result||jsonb_build_object('replayed',true);
  end if;
  if p_expected_updated_at is distinct from v_match.updated_at then
    raise exception 'El acta cambió en otra mesa. Actualiza el resultado antes de registrar una nueva acción.' using errcode='PT409';
  end if;
  v_phase=v_match.desk_phase;
  v_reason=nullif(btrim(p_payload->>'reason'),'');
  if length(v_reason)>1200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'El motivo debe tener hasta 1200 caracteres.' using errcode='PT400';
  end if;
  if p_command='start' then
    if v_match.desk_enabled or v_match.status<>'scheduled' then
      raise exception 'Solo se puede iniciar un partido programado sin acta digital previa.' using errcode='PT409';
    end if;
    if coalesce(v_match.home_score,0)<>0 or coalesce(v_match.away_score,0)<>0
      or coalesce(v_match.home_tries,0)<>0 or coalesce(v_match.away_tries,0)<>0
      or v_match.home_yellow<>0 or v_match.away_yellow<>0 or v_match.home_red<>0 or v_match.away_red<>0
      or exists(select 1 from public.fufy_match_events where match_id=p_match_id) then
      raise exception 'Este partido ya tiene datos manuales. La mesa no los importa ni los sobrescribe.' using errcode='PT409';
    end if;
    v_phase='playing';
  else
    if not v_match.desk_enabled then raise exception 'Primero inicia el acta digital desde la mesa de control.' using errcode='PT409'; end if;
    if p_command='resume' then
      if v_phase<>'suspended' then raise exception 'Solo se puede reanudar un partido suspendido.' using errcode='PT409'; end if;
      v_phase='playing';
    elsif p_command='finish' then
      if v_phase<>'playing' then raise exception 'Solo se puede finalizar un partido en juego.' using errcode='PT409'; end if;
      v_phase='finished';
    elsif p_command='suspend' then
      if v_phase<>'playing' then raise exception 'Solo se puede suspender un partido en juego.' using errcode='PT409'; end if;
      if (length(v_reason)>=5) is not true then raise exception 'Indica un motivo de suspensión de al menos 5 caracteres.' using errcode='PT400'; end if;
      v_phase='suspended';
    elsif p_command='reopen' then
      if v_phase<>'finished' then raise exception 'Solo se puede reabrir un acta finalizada.' using errcode='PT409'; end if;
      if (length(v_reason)>=10) is not true then raise exception 'Indica un motivo de reapertura de al menos 10 caracteres.' using errcode='PT400'; end if;
      v_phase='playing';
    else
      if v_phase not in ('playing','suspended') then
        raise exception 'Para corregir o registrar eventos de un acta finalizada, primero debes reabrirla con un motivo.' using errcode='PT409';
      end if;
      if p_command='add_event' then
        v_data=p_payload->'event';
        if jsonb_typeof(v_data) is distinct from 'object' then raise exception 'Revisa los datos del evento.' using errcode='PT400'; end if;
        v_kind=v_data->>'kind';
        if v_kind is null or v_kind not in ('try','conversion','penalty','drop_goal','penalty_try','yellow_card','red_card') then
          raise exception 'Selecciona un tipo de evento válido.' using errcode='PT400';
        end if;
        begin
          v_team_id=(v_data->>'team_id')::uuid;
          v_player_id=nullif(v_data->>'player_id','')::uuid;
          v_minute=nullif(v_data->>'match_minute','')::smallint;
          if coalesce((v_data->>'period')::smallint,1)<>1 then raise exception 'Periodo no válido' using errcode='22023'; end if;
        exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
          raise exception 'Revisa el equipo, jugador, período y minuto del evento.' using errcode='PT400';
        end;
        if v_team_id is null or v_team_id not in (v_match.home_team_id,v_match.away_team_id) then
          raise exception 'El equipo no participa en este partido.' using errcode='PT400';
        end if;
        if v_minute is not null and (v_minute<0 or v_minute>120) then raise exception 'El minuto debe estar entre 0 y 120.' using errcode='PT400'; end if;
        if v_kind='penalty_try' then
          if v_player_id is not null then raise exception 'El try penal no se atribuye a un goleador individual.' using errcode='PT400'; end if;
        else
          select p.* into v_player from public.fufy_club_players p join public.project_teams t on t.id=p.team_id
            where p.id=v_player_id and p.team_id=v_team_id and p.removed_at is null and p.review_status<>'rejected'
              and t.project_id=v_session.project_id and t.active and t.status in ('organizer','confirmed','roster_pending') for share of p;
          if not found then raise exception 'Selecciona un jugador de la nómina activa del equipo. No se admiten jugadores retirados o rechazados.' using errcode='PT400'; end if;
        end if;
        v_points=case v_kind when 'try' then 5 when 'conversion' then 2 when 'penalty' then 3 when 'drop_goal' then 3 when 'penalty_try' then 7 else 0 end;
      else
        if (length(v_reason)>=5) is not true then raise exception 'Indica un motivo de anulación de al menos 5 caracteres.' using errcode='PT400'; end if;
        begin v_event_id=(p_payload->>'event_id')::uuid;
        exception when invalid_text_representation then raise exception 'Selecciona el evento que deseas anular.' using errcode='PT400'; end;
        select * into v_event from public.fufy_match_events where id=v_event_id and match_id=p_match_id and project_id=v_session.project_id;
        if not found then raise exception 'El evento no pertenece a este partido.' using errcode='PT400'; end if;
        if v_event.voided_at is not null then raise exception 'El evento ya fue anulado. Actualiza el acta.' using errcode='PT409'; end if;
      end if;
    end if;
  end if;

  -- A roster correction may have held the player row after the match check.
  -- Do not let that wait extend an expired shift's write authorization.
  if v_session.expires_at<=clock_timestamp() then
    raise exception 'El turno venció. Ingresa nuevamente a la mesa de control.' using errcode='PT401';
  end if;
  v_prior_context=current_setting('app.fufy_desk_match',true);
  perform set_config('app.fufy_desk_match',p_match_id::text,true);
  if p_command='add_event' then
    insert into public.fufy_match_events(project_id,match_id,team_id,player_id,player_name,jersey_number,kind,points,period,match_minute)
      values(v_session.project_id,p_match_id,v_team_id,v_player_id,
        case when v_kind='penalty_try' then null else v_player.full_name end,
        case when v_kind='penalty_try' then null else v_player.jersey_number end,v_kind,v_points,1,v_minute)
      returning id into v_event_id;
  elsif p_command='void_event' then
    update public.fufy_match_events set voided_at=clock_timestamp() where id=v_event_id;
  end if;
  select
    coalesce(sum(points) filter(where team_id=v_match.home_team_id),0),coalesce(sum(points) filter(where team_id=v_match.away_team_id),0),
    count(*) filter(where team_id=v_match.home_team_id and kind in ('try','penalty_try')),count(*) filter(where team_id=v_match.away_team_id and kind in ('try','penalty_try')),
    count(*) filter(where team_id=v_match.home_team_id and kind='yellow_card'),count(*) filter(where team_id=v_match.away_team_id and kind='yellow_card'),
    count(*) filter(where team_id=v_match.home_team_id and kind='red_card'),count(*) filter(where team_id=v_match.away_team_id and kind='red_card')
  into v_score_home,v_score_away,v_tries_home,v_tries_away,v_yellow_home,v_yellow_away,v_red_home,v_red_away
  from public.fufy_match_events where match_id=p_match_id and voided_at is null;
  update public.fufy_matches set desk_enabled=true,desk_phase=v_phase,
    status=case when v_phase='finished' then 'final' else 'in_progress' end,
    home_score=v_score_home,away_score=v_score_away,home_tries=v_tries_home,away_tries=v_tries_away,
    home_yellow=v_yellow_home,away_yellow=v_yellow_away,home_red=v_red_home,away_red=v_red_away where id=p_match_id;
  perform set_config('app.fufy_desk_match',coalesce(v_prior_context,''),true);
  insert into public.fufy_desk_audit(project_id,session_id,match_id,event_id,operator_name,action,reason)
    values(v_session.project_id,v_session.id,p_match_id,v_event_id,v_session.operator_name,p_command,v_reason);
  v_result=jsonb_build_object('ok',true,'match_id',p_match_id);
  if v_event_id is not null then v_result=v_result||jsonb_build_object('event_id',v_event_id); end if;
  insert into public.fufy_desk_commands(request_id,project_id,session_id,match_id,command,request_hash,result)
    values(p_request_id,v_session.project_id,v_session.id,p_match_id,p_command,v_fingerprint,v_result);
  return v_result;
end $fn$;

revoke all on function private.fufy_desk_match_guard(),private.fufy_desk_event_guard(),private.fufy_desk_require_session(text,boolean),
  public.fufy_desk_session(text),public.fufy_desk_login(uuid,text,text,text,text),public.fufy_desk_logout(text),
  public.fufy_desk_rotate_access(uuid,uuid,text),public.fufy_desk_command(text,uuid,uuid,timestamptz,text,jsonb)
from public,anon,authenticated;
grant execute on function private.fufy_desk_match_guard(),private.fufy_desk_event_guard(),private.fufy_desk_require_session(text,boolean),
  public.fufy_desk_session(text),public.fufy_desk_login(uuid,text,text,text,text),public.fufy_desk_logout(text),
  public.fufy_desk_rotate_access(uuid,uuid,text),public.fufy_desk_command(text,uuid,uuid,timestamptz,text,jsonb)
to service_role;

do $realtime$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='fufy_matches') then
      alter publication supabase_realtime add table public.fufy_matches;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='fufy_match_events') then
      alter publication supabase_realtime add table public.fufy_match_events;
    end if;
  end if;
end $realtime$;
