-- =====================================================================
-- SOMOS Recurso 10: Relatórios de Pessoas
-- Indicadores calculados no servidor a partir dos dados reais (ficha, histórico, família, times, decisões de fé). Nada é carregado em massa no navegador.
--  * uma pessoa conta uma vez; vínculos ministeriais e participações por time são contados à parte; usuário do app sem ficha nunca vira membro;
--  * novos convertidos são evento (faith_decisions), não classificação; dado ausente aparece como "não informado" e nunca é presumido;
--  * evolução usa o histórico (data de OCORRÊNCIA, não a do registro) e informa a cobertura do histórico em vez de inventar números;
--  * permissões people_reports_*; escopo "igreja" ou "só o que lidero/superviso", sempre validado aqui; menores têm nome abreviado nas listas; sem CPF/contato nas listas;
--  * toda exportação (indicadores ou lista) fica registrada em report_exports.
-- =====================================================================
-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;


-- ---------------------------------------------------------------- utilitários
create or replace function public.rp_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_reports_' || p_mode) = any (public.people_actions(p_org))
$$;
-- escopo: 'church' (igreja inteira), 'own' (só quem está nos times que lidera ou nas redes que supervisiona) ou erro
create or replace function public.rp_scope_kind(p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.rp_can(p_org, 'church') then return 'church'; end if;
  if public.rp_can(p_org, 'own') then return 'own'; end if;
  raise exception 'forbidden';
end $$;
create or replace function public.rp_own_teams(p_org uuid) returns table(tid uuid)
language sql stable security definer set search_path = public as $$
  select t.team_id from team_members t where t.user_id = auth.uid() and t.is_leader and t.org_id = p_org
  union
  select nt.team_id from access_grants g join network_teams nt on nt.network_id = g.network_id where g.user_id = auth.uid() and g.org_id = p_org and g.role_key = 'network_supervisor'
$$;
create or replace function public.rp_own(p_org uuid) returns table(sid uuid)
language sql stable security definer set search_path = public as $$
  select distinct pe.id from people pe join team_members tm on tm.user_id = pe.user_id
   where pe.org_id = p_org and tm.team_id in (select tid from public.rp_own_teams(p_org))
$$;
create or replace function public.rp_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.rp_arr(f jsonb, k text) returns text[] language sql immutable as $$
  select case when jsonb_typeof(f->k) = 'array' and jsonb_array_length(f->k) > 0 then array(select jsonb_array_elements_text(f->k)) end
$$;
revoke execute on function public.rp_can(uuid, text), public.rp_scope_kind(uuid), public.rp_own(uuid), public.rp_own_teams(uuid), public.rp_today(), public.rp_arr(jsonb, text) from public, anon, authenticated;

create table if not exists public.report_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  age_bands jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.report_exports (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  area text not null,
  kind text not null check (kind in ('indicators','list')),
  format text not null check (format in ('xlsx','csv','pdf')),
  filters jsonb not null default '{}'::jsonb,
  row_count int,
  at timestamptz not null default now()
);
create index if not exists report_exports_org on public.report_exports (org_id, at desc);
alter table public.report_settings enable row level security;
alter table public.report_exports enable row level security;
revoke all on public.report_settings, public.report_exports from anon, authenticated;
create index if not exists people_org_registered on public.people (org_id, registered_at);
create index if not exists person_history_org_kind on public.person_history (org_id, kind, person_id);

create or replace function public.rp_bands(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select age_bands from report_settings where org_id = p_org),
    '[{"label":"0 a 12 anos","min":0,"max":12},{"label":"13 a 17 anos","min":13,"max":17},{"label":"18 a 24 anos","min":18,"max":24},{"label":"25 a 34 anos","min":25,"max":34},{"label":"35 a 44 anos","min":35,"max":44},{"label":"45 a 54 anos","min":45,"max":54},{"label":"55 a 64 anos","min":55,"max":64},{"label":"65 anos ou mais","min":65,"max":null}]'::jsonb)
$$;
revoke execute on function public.rp_bands(uuid) from public, anon, authenticated;

-- população considerada: escopo do usuário + filtros de perfil. Idade calculada hoje (fuso de São Paulo).
create or replace function public.rp_pop(p_org uuid, f jsonb default '{}'::jsonb) returns table(id uuid, full_name text, classification text, status text, sex text, marital text, neighborhood text, city text, birth_date date, age int, band int,
  user_id uuid, registered_at date, joined_at date, created_at timestamptz, incomplete boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_scope text := public.rp_scope_kind(p_org); v_bands jsonb := public.rp_bands(p_org); v_today date := public.rp_today(); v_net uuid; v_team uuid;
        a_cls text[] := public.rp_arr(f, 'classification'); a_st text[] := coalesce(public.rp_arr(f, 'status'), array['active','inactive']); a_band text[] := public.rp_arr(f, 'band'); a_sex text[] := public.rp_arr(f, 'sex');
        a_mar text[] := public.rp_arr(f, 'marital'); a_nei text[] := public.rp_arr(f, 'neighborhood'); a_city text[] := public.rp_arr(f, 'city');
begin
  if exists (select 1 from unnest(a_st) s where s not in ('active','inactive','pending')) then raise exception 'invalid_filter'; end if;
  begin v_net := nullif(f->>'network', '')::uuid; v_team := nullif(f->>'team', '')::uuid; exception when others then raise exception 'invalid_filter'; end;
  return query
  select pe.id, pe.full_name, pe.classification, pe.status, pe.sex, pe.marital_status, nullif(trim(coalesce(pe.neighborhood, '')), ''), nullif(trim(coalesce(pe.city, '')), ''), pe.birth_date, a.age, bd.i, pe.user_id, pe.registered_at, pe.joined_at, pe.created_at,
         (pe.birth_date is null or pe.sex is null or (coalesce(pe.phone, '') = '' and coalesce(pe.whatsapp, '') = '' and coalesce(pe.email, '') = '') or nullif(trim(coalesce(pe.city, '')), '') is null)
    from people pe
    left join lateral (select case when pe.birth_date is null then null else date_part('year', age(v_today, pe.birth_date))::int end as age) a on true
    left join lateral (select (t.o - 1)::int as i from jsonb_array_elements(v_bands) with ordinality t(b, o) where a.age is not null and a.age >= (t.b->>'min')::int and (t.b->>'max' is null or a.age <= (t.b->>'max')::int) limit 1) bd on true
   where pe.org_id = p_org and pe.status = any (a_st)
     and (v_scope = 'church' or pe.id in (select sid from public.rp_own(p_org)))
     and (a_cls is null or pe.classification = any (a_cls))
     and (a_sex is null or coalesce(pe.sex, 'none') = any (a_sex))
     and (a_mar is null or coalesce(pe.marital_status, 'none') = any (a_mar))
     and (a_nei is null or coalesce(nullif(trim(coalesce(pe.neighborhood, '')), ''), 'none') = any (a_nei))
     and (a_city is null or coalesce(nullif(trim(coalesce(pe.city, '')), ''), 'none') = any (a_city))
     and (a_band is null or coalesce(bd.i::text, 'none') = any (a_band))
     and (v_net is null or exists (select 1 from team_members tm join network_teams nt on nt.team_id = tm.team_id where tm.user_id = pe.user_id and nt.network_id = v_net and tm.org_id = p_org))
     and (v_team is null or exists (select 1 from team_members tm where tm.user_id = pe.user_id and tm.team_id = v_team and tm.org_id = p_org));
end $$;
revoke execute on function public.rp_pop(uuid, jsonb) from public, anon, authenticated;

-- linha do tempo de classificação reconstruída do histórico (data de OCORRÊNCIA, não a do registro)
create or replace function public.rp_events(p_org uuid, p_ids uuid[]) returns table(person_id uuid, cls text, d date, at timestamptz, k text, prev text)
language sql stable security definer set search_path = public as $$
  with raw as (
    select h.person_id, h.new_value as cls, 'create'::text as k, pe.registered_at as d, h.at, pe.joined_at
      from person_history h join people pe on pe.id = h.person_id
     where h.org_id = p_org and h.kind = 'create' and h.person_id = any (p_ids) and h.voided_at is null and h.new_value in ('member','attender','visitor','none')
    union all
    select h.person_id, h.new_value, 'class', coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date), h.at, pe.joined_at
      from person_history h join people pe on pe.id = h.person_id
     where h.org_id = p_org and h.kind = 'classification' and h.person_id = any (p_ids) and h.voided_at is null and h.new_value in ('member','attender','visitor','none')
  ), r as (
    select raw.*, row_number() over (partition by person_id, (cls = 'member') order by d, at) as mrn from raw
  ), x as (
    select person_id, cls, case when cls = 'member' and mrn = 1 and joined_at is not null then joined_at else d end as d, at, k from r
  )
  select person_id, cls, d, at, k, lag(cls) over (partition by person_id order by d, at) as prev from x
$$;
revoke execute on function public.rp_events(uuid, uuid[]) from public, anon, authenticated;

-- movimento em um intervalo (cadastros, entradas por classificação, conversões, mudanças, inativações, reativações)
create or replace function public.rp_flows(p_org uuid, p_from date, p_to date, p_ids uuid[], p_unlinked boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  with ev as (select * from public.rp_events(p_org, p_ids)), st as (
    select h.person_id, h.old_value, h.new_value from person_history h
     where h.org_id = p_org and h.kind = 'field' and h.field = 'status' and h.person_id = any (p_ids) and h.voided_at is null
       and coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date) between p_from and p_to)
  select jsonb_build_object(
    'new_registrations', (select count(*) from people pe where pe.id = any (p_ids) and pe.registered_at between p_from and p_to),
    'new_visitors', (select count(*) from ev where k = 'create' and cls = 'visitor' and d between p_from and p_to),
    'new_attenders', (select count(*) from ev where cls = 'attender' and prev is distinct from 'attender' and d between p_from and p_to),
    'new_members', (select count(*) from ev where cls = 'member' and prev is distinct from 'member' and d between p_from and p_to),
    'class_changes', (select count(*) from ev where k = 'class' and d between p_from and p_to),
    'inactivations', (select count(*) from st where old_value = 'active' and new_value = 'inactive'),
    'reactivations', (select count(*) from st where old_value = 'inactive' and new_value = 'active'),
    'converts', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and fd.decided_on between p_from and p_to and (fd.person_id = any (p_ids) or (p_unlinked and fd.person_id is null))))
$$;
revoke execute on function public.rp_flows(uuid, date, date, uuid[], boolean) from public, anon, authenticated;

-- série por dia/semana/mês/ano + crescimento da membresia (estoque no fim de cada período)
create or replace function public.rp_series(p_org uuid, p_from date, p_to date, p_g text, p_ids uuid[], p_unlinked boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_n int; v_step interval; v_first date; res jsonb;
begin
  if p_g not in ('day','week','month','year') then raise exception 'invalid_granularity'; end if;
  if p_from > p_to then raise exception 'invalid_period'; end if;
  v_step := case p_g when 'day' then interval '1 day' when 'week' then interval '1 week' when 'month' then interval '1 month' else interval '1 year' end;
  v_first := date_trunc(p_g, p_from)::date;
  select count(*) into v_n from generate_series(v_first::timestamp, p_to::timestamp, v_step);
  if v_n > 400 then raise exception 'too_many_points'; end if;
  with b as (select s::date as bs, (s + v_step - interval '1 day')::date as be from generate_series(v_first::timestamp, p_to::timestamp, v_step) s),
  ev as (select * from public.rp_events(p_org, p_ids)),
  iv as (select person_id, cls, d as s, lead(d) over (partition by person_id order by d, at) as e from ev),
  st as (select coalesce(h.occurred_on, (h.at at time zone 'America/Sao_Paulo')::date) as d, h.old_value, h.new_value from person_history h
          where h.org_id = p_org and h.kind = 'field' and h.field = 'status' and h.person_id = any (p_ids) and h.voided_at is null)
  select coalesce(jsonb_agg(jsonb_build_object('start', b.bs, 'end', b.be,
      'new_registrations', (select count(*) from people pe where pe.id = any (p_ids) and pe.registered_at between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_visitors', (select count(*) from ev where k = 'create' and cls = 'visitor' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_attenders', (select count(*) from ev where cls = 'attender' and prev is distinct from 'attender' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'new_members', (select count(*) from ev where cls = 'member' and prev is distinct from 'member' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'class_changes', (select count(*) from ev where k = 'class' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'inactivations', (select count(*) from st where old_value = 'active' and new_value = 'inactive' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'reactivations', (select count(*) from st where old_value = 'inactive' and new_value = 'active' and d between greatest(b.bs, p_from) and least(b.be, p_to)),
      'converts', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and fd.decided_on between greatest(b.bs, p_from) and least(b.be, p_to) and (fd.person_id = any (p_ids) or (p_unlinked and fd.person_id is null))),
      'members', (select count(*) from iv where cls = 'member' and s <= least(b.be, p_to) and (e is null or e > least(b.be, p_to)))) order by b.bs), '[]'::jsonb) into res from b;
  return res;
end $$;
revoke execute on function public.rp_series(uuid, date, date, text, uuid[], boolean) from public, anon, authenticated;

-- grupos familiares: componentes conexos dos vínculos entre pessoas da população (um grupo conta uma vez)
create or replace function public.rp_family(p_org uuid, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_changed int := 1; v_loops int := 0; v_fam int; v_link int; v_kids int; v_sizes jsonb; v_mar jsonb;
begin
  drop table if exists _rp_f;
  create temporary table _rp_f (id uuid primary key, root text not null) on commit drop;
  insert into _rp_f select x, x::text from (select person_id x from person_relations where org_id = p_org and person_id = any (p_ids) and relative_id = any (p_ids)
                                            union select relative_id from person_relations where org_id = p_org and person_id = any (p_ids) and relative_id = any (p_ids)) n;
  while v_changed > 0 and v_loops < 200 loop
    update _rp_f f set root = m.r from (select a.id, min(least(a.root, b.root)) r from _rp_f a join (select person_id p, relative_id q from person_relations where org_id = p_org union all select relative_id, person_id from person_relations where org_id = p_org) e on e.p = a.id
                                         join _rp_f b on b.id = e.q group by a.id) m where m.id = f.id and m.r < f.root;
    get diagnostics v_changed = row_count; v_loops := v_loops + 1;
  end loop;
  select count(distinct root) into v_fam from _rp_f;
  select count(*) into v_link from _rp_f;
  select count(distinct c) into v_kids from (select relative_id c from person_relations where org_id = p_org and relation = 'child' and person_id = any (p_ids) and relative_id = any (p_ids)
                                             union select person_id from person_relations where org_id = p_org and relation = 'parent' and person_id = any (p_ids) and relative_id = any (p_ids)) k;
  select coalesce(jsonb_agg(jsonb_build_object('size', s, 'n', n) order by s), '[]'::jsonb) into v_sizes from (select least(c, 6) s, count(*) n from (select root, count(*) c from _rp_f group by root) g group by 1) z;
  return jsonb_build_object('families', v_fam, 'with_link', v_link, 'children', v_kids, 'sizes', v_sizes);
end $$;
revoke execute on function public.rp_family(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.rp_delta(p_cur numeric, p_prev numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('cur', p_cur, 'prev', p_prev, 'abs', p_cur - p_prev, 'pct', case when coalesce(p_prev, 0) = 0 then null else round((p_cur - p_prev) * 100.0 / p_prev, 1) end)
$$;
revoke execute on function public.rp_delta(numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------- relatório por área (agregado no servidor)
create or replace function public.rp_report(p_org uuid, p_area text, f jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_scope text; v_perm text; v_ids uuid[]; v_from date; v_to date; v_pf date; v_pt date; v_cmp text := coalesce(nullif(f->>'compare', ''), 'previous'); v_g text := coalesce(nullif(f->>'granularity', ''), 'month');
        v_unl boolean; v_total int; v_cov numeric; v_cur jsonb; v_prev jsonb; v_series jsonb; v_res jsonb; v_m0 int; v_lim jsonb := '[]'::jsonb; v_hist int; v_bands jsonb := public.rp_bands(p_org); v_fam jsonb;
begin
  v_scope := public.rp_scope_kind(p_org);
  v_perm := case p_area when 'overview' then 'dashboard' when 'profile' then 'demographics' when 'evolution' then 'membership' when 'family' then 'family' when 'ministry' then 'ministry' end;
  if v_perm is null then raise exception 'invalid_area'; end if;
  if not public.rp_can(p_org, v_perm) then raise exception 'forbidden'; end if;
  begin v_to := coalesce(nullif(f->>'to', '')::date, public.rp_today()); v_from := coalesce(nullif(f->>'from', '')::date, v_to - 364); exception when others then raise exception 'invalid_period'; end;
  if v_from > v_to or v_to - v_from > 3660 then raise exception 'invalid_period'; end if;
  if v_cmp not in ('previous','month','year','custom') then raise exception 'invalid_filter'; end if;
  if v_cmp = 'previous' then v_pt := v_from - 1; v_pf := v_pt - (v_to - v_from);
  elsif v_cmp = 'month' then v_pf := (date_trunc('month', v_to) - interval '1 month')::date; v_pt := (date_trunc('month', v_to) - interval '1 day')::date; v_from := date_trunc('month', v_to)::date;
  elsif v_cmp = 'year' then v_pf := (date_trunc('year', v_to) - interval '1 year')::date; v_pt := (date_trunc('year', v_to) - interval '1 day')::date; v_from := date_trunc('year', v_to)::date;
  else begin v_pf := (f->>'cfrom')::date; v_pt := (f->>'cto')::date; exception when others then raise exception 'invalid_period'; end; if v_pf is null or v_pt is null or v_pf > v_pt then raise exception 'invalid_period'; end if; end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.rp_pop(p_org, f);
  v_total := cardinality(v_ids);
  v_unl := v_scope = 'church' and not (f ?| array['classification','status','band','sex','marital','neighborhood','city','network','team']);
  select count(distinct person_id) into v_hist from public.rp_events(p_org, v_ids);
  v_cov := case when v_total = 0 then 1 else v_hist::numeric / v_total end;
  if v_cov < 1 then v_lim := v_lim || to_jsonb((v_total - v_hist)::text || ' pessoa(s) não têm registro de cadastro ou classificação no histórico. Elas não entram no crescimento da membresia nem nas entradas por classificação.'); end if;

  if p_area = 'overview' or p_area = 'evolution' then
    v_cur := public.rp_flows(p_org, v_from, v_to, v_ids, v_unl); v_prev := public.rp_flows(p_org, v_pf, v_pt, v_ids, v_unl);
    select count(*) into v_m0 from (select cls, d, lead(d) over (partition by person_id order by d, at) e from public.rp_events(p_org, v_ids)) q where cls = 'member' and d <= v_from - 1 and (e is null or e > v_from - 1);
    v_series := public.rp_series(p_org, v_from, v_to, v_g, v_ids, v_unl);
  end if;

  if p_area = 'overview' then
    select jsonb_build_object('total', count(*), 'member', count(*) filter (where classification = 'member'), 'attender', count(*) filter (where classification = 'attender'), 'visitor', count(*) filter (where classification = 'visitor'),
      'none', count(*) filter (where classification not in ('member','attender','visitor')), 'active', count(*) filter (where status = 'active'), 'inactive', count(*) filter (where status = 'inactive'), 'incomplete', count(*) filter (where incomplete)) into v_res from public.rp_pop(p_org, f);
    return jsonb_build_object('area', 'overview', 'period', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_pf, 'prev_to', v_pt, 'compare', v_cmp), 'pop', v_res,
      'converts_total', (select count(*) from faith_decisions fd where fd.org_id = p_org and fd.voided_at is null and (fd.person_id = any (v_ids) or (v_unl and fd.person_id is null))),
      'converts_period', v_cur->'converts', 'flows', v_cur,
      'variation', jsonb_build_object('new_registrations', public.rp_delta((v_cur->>'new_registrations')::numeric, (v_prev->>'new_registrations')::numeric), 'new_visitors', public.rp_delta((v_cur->>'new_visitors')::numeric, (v_prev->>'new_visitors')::numeric),
                                      'converts', public.rp_delta((v_cur->>'converts')::numeric, (v_prev->>'converts')::numeric), 'new_members', public.rp_delta((v_cur->>'new_members')::numeric, (v_prev->>'new_members')::numeric),
                                      'members', case when v_cov = 1 then public.rp_delta((v_res->>'member')::numeric, v_m0) end),
      'series', v_series, 'granularity', v_g, 'history_coverage', round(v_cov, 3), 'limitations', v_lim);
  elsif p_area = 'evolution' then
    return jsonb_build_object('area', 'evolution', 'period', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_pf, 'prev_to', v_pt, 'compare', v_cmp), 'granularity', v_g, 'current', v_cur, 'previous', v_prev,
      'delta', (select jsonb_object_agg(k, public.rp_delta((v_cur->>k)::numeric, (v_prev->>k)::numeric)) from jsonb_object_keys(v_cur) k), 'series', v_series, 'members_start', case when v_cov = 1 then v_m0 end,
      'members_end', (select count(*) from public.rp_pop(p_org, f) where classification = 'member'), 'history_coverage', round(v_cov, 3),
      'limitations', v_lim || to_jsonb('Mudanças de classificação, inativações e reativações só existem a partir do momento em que passaram a ser registradas no histórico da ficha.'::text));
  elsif p_area = 'profile' then
    v_fam := public.rp_family(p_org, v_ids);
    return jsonb_build_object('area', 'profile', 'total', v_total,
      'bands', (select coalesce(jsonb_agg(jsonb_build_object('label', l, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end, 'before', b4) order by o), '[]'::jsonb) from (
          select (t.o - 1) as o, t.b->>'label' as l, (select count(*) from public.rp_pop(p_org, f) x where x.band = t.o - 1) as n, (select count(*) from public.rp_pop(p_org, f) x where x.band = t.o - 1 and x.registered_at < v_from) as b4 from jsonb_array_elements(v_bands) with ordinality t(b, o)
          union all select 9999, 'Não informado', (select count(*) from public.rp_pop(p_org, f) x where x.band is null), (select count(*) from public.rp_pop(p_org, f) x where x.band is null and x.registered_at < v_from)) z),
      'sex', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select coalesce(sex, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'marital', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select coalesce(marital, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'classification', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'pct', case when v_total = 0 then null else round(n * 100.0 / v_total, 1) end) order by n desc), '[]'::jsonb) from (select classification k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'neighborhood', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb) from (select coalesce(neighborhood, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1 order by 2 desc limit 30) s),
      'city', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb) from (select coalesce(city, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1 order by 2 desc limit 30) s),
      'family_sizes', v_fam->'sizes', 'families', (v_fam->>'families')::int, 'without_family_link', v_total - (v_fam->>'with_link')::int, 'limitations', '[]'::jsonb);
  elsif p_area = 'family' then
    v_fam := public.rp_family(p_org, v_ids);
    return jsonb_build_object('area', 'family', 'total', v_total, 'families', (v_fam->>'families')::int, 'with_link', (v_fam->>'with_link')::int, 'without_link', v_total - (v_fam->>'with_link')::int, 'children', (v_fam->>'children')::int,
      'sizes', v_fam->'sizes', 'marital', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(marital, 'none') k, count(*) n from public.rp_pop(p_org, f) group by 1) s),
      'limitations', to_jsonb(array['Só aparecem totais: nenhum nome ou dado de menor de idade é exibido neste relatório.', 'Um grupo familiar é o conjunto de pessoas ligadas entre si pelos vínculos da ficha e conta uma vez só. Grupos de uma única pessoa não são família.']));
  else
    return public.rp_ministry(p_org, v_ids, v_total);
  end if;
end $$;

create or replace function public.rp_ministry(p_org uuid, p_ids uuid[], p_total int) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select pe.id, pe.user_id from people pe where pe.id = any (p_ids)),
  mem as (select tm.team_id, tm.is_leader, p.id as pid from team_members tm join p on p.user_id = tm.user_id where tm.org_id = p_org and (public.rp_scope_kind(p_org) = 'church' or tm.team_id in (select tid from public.rp_own_teams(p_org)))),
  per as (select pid, count(distinct team_id) c from mem group by pid)
  select jsonb_build_object('area', 'ministry', 'total', p_total,
    'unique_linked', (select count(*) from per), 'unlinked', p_total - (select count(*) from per), 'without_account', (select count(*) from p where user_id is null), 'links', (select count(*) from mem),
    'multi_team', (select count(*) from per where c > 1), 'by_team_count', (select coalesce(jsonb_agg(jsonb_build_object('teams', c, 'n', n) order by c), '[]'::jsonb) from (select least(c, 3) c, count(*) n from per group by 1) z),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'people', x.n, 'leaders', x.l, 'pct', case when p_total = 0 then null else round(x.n * 100.0 / p_total, 1) end,
        'networks', coalesce((select jsonb_agg(cn.name order by cn.name) from network_teams nt join church_networks cn on cn.id = nt.network_id where nt.team_id = t.id), '[]'::jsonb)) order by x.n desc, t.name)
        from (select team_id, count(distinct pid) n, count(distinct pid) filter (where is_leader) l from mem group by 1) x join teams t on t.id = x.team_id), '[]'::jsonb),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'people', n, 'links', l, 'teams', tc, 'pct', case when p_total = 0 then null else round(n * 100.0 / p_total, 1) end) order by n desc, name) from (
        select cn.id, cn.name, count(distinct m.pid) n, count(*) l, count(distinct m.team_id) tc from church_networks cn join network_teams nt on nt.network_id = cn.id join mem m on m.team_id = nt.team_id where cn.org_id = p_org group by cn.id, cn.name
        union all select null, 'Times sem ministério', count(distinct m.pid), count(*), count(distinct m.team_id) from mem m where not exists (select 1 from network_teams nt where nt.team_id = m.team_id) having count(*) > 0) q), '[]'::jsonb),
    'limitations', to_jsonb(array['Vínculo ministerial é o estado atual dos times. Só pessoas com conta no app entram em times, então quem não tem conta aparece como sem vínculo.', 'Pessoas únicas, vínculos e participações por time são números diferentes: quem está em três times conta uma vez no total e três vezes nos vínculos.']))
$$;
revoke execute on function public.rp_ministry(uuid, uuid[], int) from public, anon, authenticated;

-- ---------------------------------------------------------------- lista individual (campos autorizados; menores com nome abreviado)
create or replace function public.rp_list(p_org uuid, f jsonb default '{}'::jsonb, p_limit int default 50, p_offset int default 0, p_export boolean default false, p_format text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lim int; v_items jsonb; v_total int; v_bands jsonb := public.rp_bands(p_org); v_open boolean;
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'individual') then raise exception 'forbidden'; end if;
  if p_export then
    if not public.rp_can(p_org, 'export_lists') then raise exception 'forbidden'; end if;
    if p_format not in ('xlsx','csv','pdf') then raise exception 'invalid_format'; end if;
  end if;
  v_lim := least(greatest(coalesce(p_limit, 50), 1), case when p_export then 5000 else 200 end);
  v_open := not p_export and public.people_scope_all(p_org) and public.has_people_perm(p_org, 'people_view');
  select count(*) into v_total from public.rp_pop(p_org, f);
  select coalesce(jsonb_agg(x.j order by x.nm), '[]'::jsonb) into v_items from (
    select pe.full_name as nm, jsonb_build_object('id', case when v_open then pe.id end, 'name', case when pe.age is not null and pe.age < 18 then regexp_replace(initcap(pe.full_name), '(\S)\S*\s*', '\1. ', 'g') else pe.full_name end,
      'minor', pe.age is not null and pe.age < 18, 'classification', pe.classification, 'status', pe.status, 'band', case when pe.band is null then 'Não informado' else v_bands->pe.band->>'label' end, 'sex', pe.sex, 'marital', pe.marital,
      'neighborhood', pe.neighborhood, 'city', pe.city, 'registered_at', pe.registered_at, 'joined_at', pe.joined_at, 'created_at', pe.created_at, 'incomplete', pe.incomplete) as j
      from public.rp_pop(p_org, f) pe order by pe.full_name limit v_lim offset greatest(coalesce(p_offset, 0), 0)) x;
  if p_export then insert into report_exports (org_id, actor, area, kind, format, filters, row_count) values (p_org, auth.uid(), 'list', 'list', p_format, coalesce(f, '{}'::jsonb), jsonb_array_length(v_items)); end if;
  return jsonb_build_object('items', v_items, 'total', v_total);
end $$;

-- ---------------------------------------------------------------- opções de filtro (só valores que existem) e configuração
create or replace function public.rp_options(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_scope text := public.rp_scope_kind(p_org); v_bands jsonb := public.rp_bands(p_org);
begin
  if not (public.rp_can(p_org, 'dashboard') or public.rp_can(p_org, 'membership') or public.rp_can(p_org, 'demographics') or public.rp_can(p_org, 'family') or public.rp_can(p_org, 'ministry')) then raise exception 'forbidden'; end if;
  return jsonb_build_object('scope', v_scope,
    'areas', jsonb_build_object('overview', public.rp_can(p_org, 'dashboard'), 'profile', public.rp_can(p_org, 'demographics'), 'evolution', public.rp_can(p_org, 'membership'), 'family', public.rp_can(p_org, 'family'), 'ministry', public.rp_can(p_org, 'ministry')),
    'can', jsonb_build_object('export', public.rp_can(p_org, 'export'), 'individual', public.rp_can(p_org, 'individual'), 'export_lists', public.rp_can(p_org, 'export_lists') and public.rp_can(p_org, 'individual'), 'admin', public.rp_can(p_org, 'admin')),
    'org_name', (select name from organizations where id = p_org),
    'classification', coalesce((select jsonb_agg(distinct classification) from public.rp_pop(p_org, '{"status":["active","inactive","pending"]}')), '[]'::jsonb),
    'status', coalesce((select jsonb_agg(distinct status) from public.rp_pop(p_org, '{"status":["active","inactive","pending"]}')), '[]'::jsonb),
    'sex', coalesce((select jsonb_agg(distinct coalesce(sex, 'none')) from public.rp_pop(p_org, '{}')), '[]'::jsonb),
    'marital', coalesce((select jsonb_agg(distinct coalesce(marital, 'none')) from public.rp_pop(p_org, '{}')), '[]'::jsonb),
    'neighborhood', coalesce((select jsonb_agg(k order by k) from (select distinct coalesce(neighborhood, 'none') k from public.rp_pop(p_org, '{}') limit 200) z), '[]'::jsonb),
    'city', coalesce((select jsonb_agg(k order by k) from (select distinct coalesce(city, 'none') k from public.rp_pop(p_org, '{}') limit 200) z), '[]'::jsonb),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('i', (t.o - 1)::text, 'label', t.b->>'label') order by t.o), '[]'::jsonb) from jsonb_array_elements(v_bands) with ordinality t(b, o) where exists (select 1 from public.rp_pop(p_org, '{}') x where x.band = t.o - 1))
      || case when exists (select 1 from public.rp_pop(p_org, '{}') x where x.band is null) then jsonb_build_array(jsonb_build_object('i', 'none', 'label', 'Não informado')) else '[]'::jsonb end,
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', cn.id, 'name', cn.name) order by cn.name) from church_networks cn where cn.org_id = p_org and exists (select 1 from network_teams nt join team_members tm on tm.team_id = nt.team_id where nt.network_id = cn.id)), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from teams t where t.org_id = p_org and exists (select 1 from team_members tm where tm.team_id = t.id)), '[]'::jsonb));
end $$;
create or replace function public.rp_settings_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  return jsonb_build_object('age_bands', public.rp_bands(p_org), 'can_admin', public.rp_can(p_org, 'admin'));
end $$;
create or replace function public.rp_settings_save(p_org uuid, p_bands jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; i int; b jsonb; v_prev_max int;
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_bands) <> 'array' then raise exception 'invalid_bands'; end if;
  n := jsonb_array_length(p_bands);
  if n < 2 or n > 15 then raise exception 'invalid_bands'; end if;
  for i in 0 .. n - 1 loop
    b := p_bands->i;
    if length(trim(coalesce(b->>'label', ''))) not between 1 and 40 then raise exception 'invalid_bands'; end if;
    begin perform (b->>'min')::int; if b->>'max' is not null then perform (b->>'max')::int; end if; exception when others then raise exception 'invalid_bands'; end;
    if i = 0 and (b->>'min')::int <> 0 then raise exception 'invalid_bands'; end if;
    if i > 0 and (b->>'min')::int <> v_prev_max + 1 then raise exception 'invalid_bands'; end if;
    if i < n - 1 then if b->>'max' is null or (b->>'max')::int < (b->>'min')::int then raise exception 'invalid_bands'; end if; v_prev_max := (b->>'max')::int;
    elsif b->>'max' is not null then raise exception 'invalid_bands'; end if;
  end loop;
  insert into report_settings (org_id, age_bands, updated_by) values (p_org, p_bands, auth.uid()) on conflict (org_id) do update set age_bands = excluded.age_bands, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('saved', true);
end $$;

-- auditoria das exportações de indicadores (as de listas são registradas pela própria rp_list)
create or replace function public.report_export_log(p_org uuid, p_area text, p_format text, p_filters jsonb default '{}'::jsonb, p_rows int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'export') then raise exception 'forbidden'; end if;
  if p_area not in ('overview','profile','evolution','family','ministry') then raise exception 'invalid_area'; end if;
  if p_format not in ('xlsx','csv','pdf') then raise exception 'invalid_format'; end if;
  insert into report_exports (org_id, actor, area, kind, format, filters, row_count) values (p_org, auth.uid(), p_area, 'indicators', p_format, coalesce(p_filters, '{}'::jsonb), p_rows);
  return jsonb_build_object('saved', true);
end $$;
create or replace function public.rp_export_audit(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.rp_scope_kind(p_org);
  if not public.rp_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('area', e.area, 'kind', e.kind, 'format', e.format, 'rows', e.row_count, 'at', e.at, 'filters', e.filters, 'by', coalesce(public.welcome_name(e.org_id, e.actor), 'Usuário removido')) order by e.at desc)
    from (select * from report_exports where org_id = p_org order by at desc limit 100) e), '[]'::jsonb);
end $$;

revoke execute on function public.rp_report(uuid, text, jsonb), public.rp_list(uuid, jsonb, int, int, boolean, text), public.rp_options(uuid), public.rp_settings_get(uuid), public.rp_settings_save(uuid, jsonb),
  public.report_export_log(uuid, text, text, jsonb, int), public.rp_export_audit(uuid) from public, anon;
grant execute on function public.rp_report(uuid, text, jsonb), public.rp_list(uuid, jsonb, int, int, boolean, text), public.rp_options(uuid), public.rp_settings_get(uuid), public.rp_settings_save(uuid, jsonb),
  public.report_export_log(uuid, text, text, jsonb, int), public.rp_export_audit(uuid) to authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.report_exports') is not null
--      and to_regprocedure('public.rp_report(uuid,text,jsonb)') is not null
--      and to_regprocedure('public.rp_list(uuid,jsonb,integer,integer,boolean,text)') is not null
--      and 'people_reports_dashboard' = any (public.all_actions()) as ok;
