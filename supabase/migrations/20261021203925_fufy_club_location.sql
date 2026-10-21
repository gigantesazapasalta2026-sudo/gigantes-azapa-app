-- Delegates must be able to complete the location required by the bases.
-- Keep this information in the dossier, without changing the club master record.
alter table public.fufy_club_submissions
  add column club_city text not null default '' check(length(club_city)<=120),
  add column club_country text not null default '' check(length(club_country)<=80);

update public.fufy_club_submissions s
set club_city=coalesce(t.city,''),club_country=coalesce(t.country,'')
from public.project_teams t where t.id=s.team_id;

create or replace function private.fufy_submission_guard() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  if (new.delegate_name,new.delegate_email,new.delegate_phone,new.manager_name,new.manager_phone,new.captain_name,new.first_aid_name,new.first_aid_phone,new.club_notes,new.accepted_bases,new.confirmed_accuracy,new.privacy_consent,new.club_city,new.club_country) is distinct from
     (old.delegate_name,old.delegate_email,old.delegate_phone,old.manager_name,old.manager_phone,old.captain_name,old.first_aid_name,old.first_aid_phone,old.club_notes,old.accepted_bases,old.confirmed_accuracy,old.privacy_consent,old.club_city,old.club_country)
     or (new.status='submitted' and new.status is distinct from old.status) then
    if not private.fufy_edit_allowed(new.team_id) then
      raise exception 'La nómina está cerrada; solicita una corrección al Comité Organizador.' using errcode='23514';
    end if;
  end if;
  return new;
end $fn$;

create or replace function private.fufy_manager_changed() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
  -- These fields appear on the printable declaration. A changed declaration
  -- must be signed again; retain old metadata visibly marked as superseded.
  if (new.manager_name,new.manager_phone,new.club_city,new.club_country,new.delegate_name,new.delegate_phone,new.delegate_email,new.captain_name,new.first_aid_name,new.first_aid_phone) is distinct from
     (old.manager_name,old.manager_phone,old.club_city,old.club_country,old.delegate_name,old.delegate_phone,old.delegate_email,old.captain_name,old.first_aid_name,old.first_aid_phone) then
    update public.fufy_club_documents set is_current=false
      where team_id=new.team_id and removed_at is null and is_current and kind in ('signed_roster','manager_declaration');
  end if;
  return new;
end $fn$;
