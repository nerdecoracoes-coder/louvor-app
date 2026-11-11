-- 'Já escalado neste dia' passa a considerar só escalas que se sobrepõem ao horário do evento (manhã e noite não se misturam).
-- A coluna continua se chamando same_day_count para não mudar o app; agora conta conflitos no mesmo horário.
create or replace function public.schedule_candidates(p_team uuid, p_starts timestamptz, p_ends timestamptz default null,
  p_exclude_schedule uuid default null)
returns table (user_id uuid, role_id uuid, display_name text, available boolean, unavailable_note text,
               month_count int, monthly_limit int, same_day_count int, avoid_with uuid[])
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := team_org(p_team); v_end timestamptz := coalesce(p_ends, p_starts + interval '2 hours');
        v_day date := (p_starts at time zone 'America/Sao_Paulo')::date;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  return query
  select tm.user_id, r.role_id,
         coalesce(om.display_name, p.full_name),
         not exists (select 1 from unavailability u where u.user_id = tm.user_id and u.org_id = v_org
                     and v_day between u.start_date and u.end_date
                     and (u.all_day or ((v_day + u.start_time) at time zone 'America/Sao_Paulo' < v_end
                                        and (v_day + u.end_time) at time zone 'America/Sao_Paulo' > p_starts))),
         (select string_agg(coalesce(u.note, 'Indisponível'), '; ') from unavailability u
           where u.user_id = tm.user_id and u.org_id = v_org and v_day between u.start_date and u.end_date),
         (select count(distinct a.schedule_id)::int from schedule_assignments a join schedules s on s.id = a.schedule_id
           where a.user_id = tm.user_id and s.org_id = v_org and s.id is distinct from p_exclude_schedule
             and date_trunc('month', s.starts_at at time zone 'America/Sao_Paulo') = date_trunc('month', p_starts at time zone 'America/Sao_Paulo')),
         tm.monthly_limit,
         (select count(distinct a.schedule_id)::int from schedule_assignments a join schedules s on s.id = a.schedule_id
           where a.user_id = tm.user_id and s.org_id = v_org and s.id is distinct from p_exclude_schedule
             and s.starts_at < v_end and coalesce(s.ends_at, s.starts_at + interval '2 hours') > p_starts),   -- mesmo culto/horário (sobrepõe), não o dia inteiro
         tm.avoid_with
  from team_members tm
  join team_member_roles r on r.team_id = tm.team_id and r.user_id = tm.user_id
  join org_members om on om.org_id = v_org and om.user_id = tm.user_id
  join profiles p on p.id = tm.user_id
  where tm.team_id = p_team;
end $$;

-- verificação:
-- select pg_get_functiondef('public.schedule_candidates(uuid,timestamptz,timestamptz,uuid)'::regprocedure) like '%sobrepõe%' as atualizada;
