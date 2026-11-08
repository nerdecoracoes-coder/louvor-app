-- Quem monta a escala vê se a pessoa já foi escalada em outro time no mesmo evento (mesmo evento da agenda ou mesmo horário).
create or replace function public.scheduled_elsewhere(p_team uuid, p_starts timestamptz, p_church_event uuid, p_exclude uuid, p_users uuid[])
returns table (user_id uuid, team_name text, role_name text, title text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_team(p_team) then raise exception 'forbidden'; end if;
  return query
    select a.user_id, t.name, a.role_name, s.title
    from schedule_assignments a
    join schedules s on s.id = a.schedule_id
    join teams t on t.id = s.team_id
    where a.user_id = any(p_users) and s.team_id <> p_team and s.org_id = public.team_org(p_team)
      and (p_exclude is null or s.id <> p_exclude)
      and ((p_church_event is not null and s.church_event_id = p_church_event) or s.starts_at = p_starts);
end $$;
revoke execute on function public.scheduled_elsewhere(uuid, timestamptz, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.scheduled_elsewhere(uuid, timestamptz, uuid, uuid, uuid[]) to authenticated;
