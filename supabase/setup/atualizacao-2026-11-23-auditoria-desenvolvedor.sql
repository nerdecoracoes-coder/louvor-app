-- =====================================================================
-- Modo auditoria do desenvolvedor (23/11/2026)
--  O desenvolvedor circula e edita TODAS as áreas (times, escalas, músicas, repertórios, redes, configurações),
--  mas NÃO lê dados pessoais de ninguém: perfis, telefone, nascimento, conversas, enquetes, crianças, visitantes,
--  indisponibilidades, arquivos privados e lista de integrantes de igrejas em que não é membro de verdade.
--  * Aditivo e reversível: só recria shares_team/schedule_candidates e acrescenta políticas RESTRITIVAS
--    (valem somente quando is_developer() é verdadeiro; para todas as outras pessoas nada muda).
--  * Vínculo "de verdade" (membro, líder ou administrador da própria igreja) continua valendo como sempre.
-- =====================================================================

-- vínculo real, sem o atalho de desenvolvedor nem concessões de rede
create or replace function public.real_org_access(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
$$;
create or replace function public.real_team_access(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid())
      or exists (select 1 from teams t join org_members m on m.org_id = t.org_id and m.user_id = auth.uid() and m.role = 'admin' where t.id = p_team)
$$;
revoke execute on function public.real_org_access(uuid), public.real_team_access(uuid) from public, anon;
grant execute on function public.real_org_access(uuid), public.real_team_access(uuid) to authenticated;

-- "divide time com": volta a não incluir o desenvolvedor (é isto que libera perfis de outras pessoas)
create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and (a.access_until is null or a.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
  or exists (select 1 from team_members b where b.user_id = p_user and public.grant_covers_team(b.team_id, 'view'))
$$;

-- políticas restritivas (só afetam o desenvolvedor)
drop policy if exists dev_audit_org_members on public.org_members;
create policy dev_audit_org_members on public.org_members as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or public.real_org_access(org_id));
drop policy if exists dev_audit_unavailability on public.unavailability;
create policy dev_audit_unavailability on public.unavailability as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or public.real_org_access(org_id));

do $$
declare t text;
begin
  foreach t in array array['messages','polls','children','child_checkins','visitors','team_files','service_checks'] loop
    execute format('drop policy if exists dev_audit_%1$s on public.%1$s', t);
    execute format('create policy dev_audit_%1$s on public.%1$s as restrictive for all to authenticated using (not public.is_developer() or public.real_team_access(team_id))', t);
  end loop;
end $$;
drop policy if exists dev_audit_poll_votes on public.poll_votes;
create policy dev_audit_poll_votes on public.poll_votes as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or exists (select 1 from polls p where p.id = poll_votes.poll_id and public.real_team_access(p.team_id)));
drop policy if exists dev_audit_team_event_rsvps on public.team_event_rsvps;
create policy dev_audit_team_event_rsvps on public.team_event_rsvps as restrictive for all to authenticated
  using (not public.is_developer() or user_id = auth.uid() or exists (select 1 from team_events e where e.id = team_event_rsvps.event_id and public.real_team_access(e.team_id)));

-- sugestão de escala (nomes e indisponibilidades): idem
CREATE OR REPLACE FUNCTION public.schedule_candidates(p_team uuid, p_starts timestamp with time zone, p_ends timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exclude_schedule uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, role_id uuid, display_name text, available boolean, unavailable_note text, month_count integer, monthly_limit integer, same_day_count integer, avoid_with uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := team_org(p_team); v_end timestamptz := coalesce(p_ends, p_starts + interval '2 hours');
        v_day date := (p_starts at time zone 'America/Sao_Paulo')::date;
begin
  if not can_manage_team(p_team) then raise exception 'forbidden'; end if;
  -- modo auditoria: o desenvolvedor não lê nomes nem indisponibilidades de times em que não está de verdade
  if public.is_developer() and not public.real_team_access(p_team) then raise exception 'forbidden'; end if;
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
end $function$;

-- verificação:
-- select count(*) filter (where policyname like 'dev_audit_%') as politicas from pg_policies where schemaname='public';   -- esperado: 11
-- REVERSÃO: drop policy dev_audit_<tabela> on public.<tabela>;  (todas as dev_audit_*) e recriar shares_team como em 20261123000001.
