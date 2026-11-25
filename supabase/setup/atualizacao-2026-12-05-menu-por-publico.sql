-- =====================================================================
-- SOMOS — Menu por público: o servidor decide quais atalhos pessoais cada pessoa vê.
--  * "Decidi seguir a Jesus": visitante, congregado/frequentador e quem ainda não tem ficha; membro só se a liderança liberar.
--  * "Minhas jornadas": só para quem participa de uma jornada ou tem jornada pública aberta para a sua classificação.
--  * "Minhas escalas": só para quem está em alguma escala publicada.
-- Isto só controla o que aparece no menu; as páginas continuam acessíveis por link e o servidor confere cada operação.
-- Alteração não destrutiva: uma coluna nova com valor padrão falso.
-- =====================================================================
alter table public.people add column if not exists menu_decision boolean not null default false;

create or replace function public.my_menu(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_mem boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) into v_mem;
  if not v_mem then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  v_ids := array(select id from people where org_id = p_org and user_id = auth.uid());
  return jsonb_build_object(
    'classification', pe.classification,
    'decision', pe.id is null or pe.classification in ('visitor','attender') or coalesce(pe.menu_decision, false),
    'journeys', exists (select 1 from journey_participants x where x.person_id = any (v_ids) and x.status <> 'cancelled')
                or exists (select 1 from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and pe.id is not null
                           and (j.eligible_classes is null or pe.classification = any (j.eligible_classes))
                           and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_ids) and x.status <> 'cancelled')),
    'rosters', exists (select 1 from roster_assignments a join rosters r on r.id = a.roster_id where a.person_id = any (v_ids) and a.status in ('invited','confirmed','declined','sub_requested')
                       and r.status not in ('draft') and r.starts_at > now() - interval '30 days'));
end $$;

-- a liderança libera (ou retira) o atalho "Decidi seguir a Jesus" no menu de uma pessoa específica
create or replace function public.person_menu_decision_set(p_person uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person;
  if pe.id is null then raise exception 'not_found'; end if;
  if not (public.has_people_perm(pe.org_id, 'people_edit') and public.people_scope_all(pe.org_id)) then raise exception 'forbidden'; end if;
  update people set menu_decision = coalesce(p_on, false) where id = p_person;
  perform public.mod_log(pe.org_id, 'people', 'person', p_person, case when p_on then 'menu_decision_on' else 'menu_decision_off' end, null, jsonb_build_object('name', pe.full_name));
end $$;
revoke execute on function public.my_menu(uuid), public.person_menu_decision_set(uuid, boolean) from public, anon;
grant execute on function public.my_menu(uuid), public.person_menu_decision_set(uuid, boolean) to authenticated;

-- verificação (deve retornar true):
--   select to_regprocedure('public.my_menu(uuid)') is not null and to_regprocedure('public.person_menu_decision_set(uuid,boolean)') is not null
--      and exists (select 1 from information_schema.columns where table_name = 'people' and column_name = 'menu_decision') as ok;
-- REVERSÃO: drop function public.my_menu(uuid); drop function public.person_menu_decision_set(uuid, boolean); alter table public.people drop column menu_decision;
