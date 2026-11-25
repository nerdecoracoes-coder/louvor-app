-- =====================================================================
-- SOMOS Recursos 11 e 12: Segmentação de Pessoas e Carteira Digital do Membro
--  * segmentos dinâmicos (critérios E/OU aninhados avaliados ao vivo sobre a Ficha, só campos permitidos), grupos manuais com histórico de participação;
--  * participação em segmento ou grupo NUNCA concede permissão nem direito à carteira; nenhum dado confidencial entra como critério;
--  * carteira: matrícula pertence à pessoa, QR com token assinado (não armazenado), validação pelo servidor com limite de tentativas,
--    elegibilidade reavaliada a cada consulta, histórico de tudo e nada é apagado em silêncio.
-- =====================================================================
-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin','people_segments_view','people_segments_create','people_segments_edit','people_segments_delete','people_groups_view','people_groups_create','people_groups_members','people_segments_functions','people_segments_export','people_segments_use','people_wallet_view','people_wallet_issue','people_wallet_batch','people_wallet_suspend','people_wallet_reactivate','people_wallet_revoke','people_wallet_token','people_wallet_config','people_wallet_validate']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin','people_segments_view','people_segments_create','people_segments_edit','people_segments_delete','people_groups_view','people_groups_create','people_groups_members','people_segments_functions','people_segments_export','people_segments_use','people_wallet_view','people_wallet_issue','people_wallet_batch','people_wallet_suspend','people_wallet_reactivate','people_wallet_revoke','people_wallet_token','people_wallet_config','people_wallet_validate']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin','people_segments_view','people_segments_create','people_segments_edit','people_segments_delete','people_groups_view','people_groups_create','people_groups_members','people_segments_functions','people_segments_export','people_segments_use','people_wallet_view','people_wallet_issue','people_wallet_batch','people_wallet_suspend','people_wallet_reactivate','people_wallet_revoke','people_wallet_token','people_wallet_config','people_wallet_validate']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;


-- ================================================================ RECURSO 11: SEGMENTAÇÃO DE PESSOAS
-- Segmentos dinâmicos (critérios avaliados ao vivo sobre a Ficha), grupos manuais com participação histórica, histórico auditável.
-- Não cria cadastros nem vínculos paralelos: reaproveita people, team_members, church_networks, journey_participants, access_grants.
create table if not exists public.seg_segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  kind text not null default 'dynamic' check (kind in ('dynamic','links','roles')),
  criteria jsonb not null default '{"op":"and","items":[]}'::jsonb,
  owner_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists seg_segments_name on public.seg_segments (org_id, lower(name));
create table if not exists public.seg_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  category text check (category is null or length(category) <= 40),
  kind text not null default 'permanent' check (kind in ('permanent','temporary')),
  visibility text not null default 'all' check (visibility in ('all','restricted')),
  ends_on date,
  owner_id uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists seg_groups_name on public.seg_groups (org_id, lower(name));
create table if not exists public.seg_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.seg_groups(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'active' check (status in ('active','removed')),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete set null,
  removed_at timestamptz,
  remove_reason text check (remove_reason is null or length(remove_reason) <= 200)
);
create unique index if not exists seg_group_members_active on public.seg_group_members (group_id, person_id) where status = 'active';
create index if not exists seg_group_members_person on public.seg_group_members (person_id) where status = 'active';
-- última lista conhecida de cada segmento: serve só para registrar quem entrou e quem saiu
create table if not exists public.seg_segment_cache (segment_id uuid not null references public.seg_segments(id) on delete cascade, person_id uuid not null, since timestamptz not null default now(), primary key (segment_id, person_id));
create table if not exists public.seg_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  segment_id uuid, group_id uuid, person_id uuid,
  kind text not null, actor uuid references auth.users(id) on delete set null,
  detail jsonb, at timestamptz not null default now()
);
create index if not exists seg_log_segment on public.seg_log (segment_id, at desc) where segment_id is not null;
create index if not exists seg_log_group on public.seg_log (group_id, at desc) where group_id is not null;
alter table public.seg_segments enable row level security; alter table public.seg_groups enable row level security; alter table public.seg_group_members enable row level security;
alter table public.seg_segment_cache enable row level security; alter table public.seg_log enable row level security;
revoke all on public.seg_segments, public.seg_groups, public.seg_group_members, public.seg_segment_cache, public.seg_log from anon, authenticated;

-- escopo: administrador, liderança geral e secretaria com permissão do módulo veem a igreja; supervisor só a sua rede
create or replace function public.sg_scope(p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then return 'all'; end if;
  if exists (select 1 from access_grants g, unnest(g.actions) a where g.org_id = p_org and g.user_id = auth.uid() and g.role_key in ('general_leader','secretary') and (a like 'people\_segments\_%' or a like 'people\_groups\_%' or a like 'people\_wallet\_%')) then return 'all'; end if;
  if exists (select 1 from access_grants g, unnest(g.actions) a where g.org_id = p_org and g.user_id = auth.uid() and g.role_key = 'network_supervisor' and (a like 'people\_segments\_%' or a like 'people\_groups\_%' or a like 'people\_wallet\_%')) then return 'own'; end if;
  raise exception 'forbidden';
end $$;
create or replace function public.sg_people(p_org uuid) returns setof public.people
language sql stable security definer set search_path = public as $$
  select pe.* from people pe where pe.org_id = p_org and pe.status in ('active','inactive','pending')
     and (public.sg_scope(p_org) = 'all' or pe.id in (select sid from public.rp_own(p_org)))
$$;
create or replace function public.sg_need(p_org uuid, p_action text) returns void language plpgsql stable security definer set search_path = public as $$
begin perform public.sg_scope(p_org); if not public.has_people_perm(p_org, p_action) then raise exception 'forbidden'; end if; end $$;
revoke execute on function public.sg_scope(uuid), public.sg_people(uuid), public.sg_need(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- construtor de critérios (lista branca de campos; valores sempre escapados)
create or replace function public.sg_vals(v jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'array' then v when v is null or jsonb_typeof(v) = 'null' then '[]'::jsonb else jsonb_build_array(v) end
$$;
create or replace function public.sg_list(p_vals jsonb, p_kind text) returns text
language plpgsql immutable as $$
declare x text; out text[] := '{}'; i int := 0;
begin
  for x in select jsonb_array_elements_text(p_vals) loop
    i := i + 1; if i > 50 then raise exception 'invalid_criteria'; end if;
    if p_kind = 'uuid' then out := array_append(out, format('%L', x::uuid)); elsif p_kind = 'int' then out := array_append(out, (x::int)::text); else out := array_append(out, format('%L', x)); end if;
  end loop;
  if i = 0 then raise exception 'invalid_criteria'; end if;
  return array_to_string(out, ',');
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_criteria';
end $$;
-- campos e operadores aceitos. Nada confidencial ou pastoral entra aqui.
create or replace function public.sg_cond(p_org uuid, n jsonb, p_depth int default 0) returns text
language plpgsql stable security definer set search_path = public as $$
declare f text; c text; v jsonb; parts text[] := '{}'; it jsonb; col text; vals text; k text; ex text; b jsonb; rngs text[]; i int; lo int; hi int; num text; neg boolean;
begin
  if p_depth > 4 or jsonb_typeof(n) <> 'object' then raise exception 'invalid_criteria'; end if;
  if n ? 'items' then
    c := lower(coalesce(n->>'op', 'and')); if c not in ('and','or') or jsonb_typeof(n->'items') <> 'array' then raise exception 'invalid_criteria'; end if;
    for it in select * from jsonb_array_elements(n->'items') loop parts := array_append(parts, public.sg_cond(p_org, it, p_depth + 1)); end loop;
    if cardinality(parts) = 0 then return 'true'; end if;
    return '(' || array_to_string(parts, case c when 'and' then ' and ' else ' or ' end) || ')';
  end if;
  f := n->>'field'; c := n->>'cmp'; v := public.sg_vals(n->'value');
  if c not in ('eq','neq','contains','not_contains','gt','lt','filled','empty','in','not_in','between','not_between') then raise exception 'invalid_operator'; end if;
  neg := c in ('neq','not_in','not_contains','not_between','empty');
  if f in ('function','title') and not public.has_people_perm(p_org, 'people_segments_functions') then raise exception 'forbidden'; end if;
  -- texto e listas fechadas
  if f in ('classification','status','sex','marital','neighborhood','city') then
    col := case f when 'marital' then 'p.marital_status' else 'p.' || f end;
    if f = 'classification' and exists (select 1 from jsonb_array_elements_text(v) x where x not in ('member','attender','visitor')) then raise exception 'invalid_criteria'; end if;
    if f = 'status' and exists (select 1 from jsonb_array_elements_text(v) x where x not in ('active','inactive','pending')) then raise exception 'invalid_criteria'; end if;
    if f = 'sex' and exists (select 1 from jsonb_array_elements_text(v) x where x not in ('M','F')) then raise exception 'invalid_criteria'; end if;
    if c = 'filled' then return format('(nullif(trim(coalesce(%s, '''')), '''') is not null)', col); end if;
    if c = 'empty' then return format('(nullif(trim(coalesce(%s, '''')), '''') is null)', col); end if;
    if c in ('eq','in') then return format('(%s in (%s))', col, public.sg_list(v, 'text')); end if;
    if c in ('neq','not_in') then return format('(coalesce(%s, '''') not in (%s))', col, public.sg_list(v, 'text')); end if;
    if c = 'contains' then return format('(coalesce(%s, '''') ilike %L)', col, '%' || replace(replace(v->>0, '\', '\\'), '%', '\%') || '%'); end if;
    if c = 'not_contains' then return format('(coalesce(%s, '''') not ilike %L)', col, '%' || replace(replace(v->>0, '\', '\\'), '%', '\%') || '%'); end if;
    raise exception 'invalid_operator';
  end if;
  -- idade e faixa etária
  if f = 'age' or f = 'band' then
    num := '(case when p.birth_date is null then null else date_part(''year'', age(public.rp_today(), p.birth_date))::int end)';
    if f = 'age' then
      if c = 'filled' then return '(' || num || ' is not null)'; elsif c = 'empty' then return '(' || num || ' is null)'; end if;
      begin
        if c = 'eq' then return format('(%s = %s)', num, (v->>0)::int); elsif c = 'neq' then return format('(coalesce(%s, -1) <> %s)', num, (v->>0)::int);
        elsif c = 'gt' then return format('(%s > %s)', num, (v->>0)::int); elsif c = 'lt' then return format('(%s < %s)', num, (v->>0)::int);
        elsif c = 'between' then return format('(%s between %s and %s)', num, (v->>0)::int, (v->>1)::int);
        elsif c = 'not_between' then return format('(coalesce(%s, -1) not between %s and %s)', num, (v->>0)::int, (v->>1)::int); end if;
      exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_criteria'; end;
      raise exception 'invalid_operator';
    end if;
    if c in ('filled','empty') then return '(' || num || case when c = 'filled' then ' is not null)' else ' is null)' end; end if;
    if c not in ('eq','in','neq','not_in') then raise exception 'invalid_operator'; end if;
    b := public.rp_bands(p_org); rngs := '{}';
    for k in select jsonb_array_elements_text(v) loop
      if k = 'none' then rngs := array_append(rngs, '(' || num || ' is null)'); continue; end if;
      begin i := k::int; exception when others then raise exception 'invalid_criteria'; end;
      if i < 0 or i >= jsonb_array_length(b) then raise exception 'invalid_criteria'; end if;
      lo := (b->i->>'min')::int; hi := (b->i->>'max')::int;
      rngs := array_append(rngs, case when hi is null then format('(%s >= %s)', num, lo) else format('(%s between %s and %s)', num, lo, hi) end);
    end loop;
    if cardinality(rngs) = 0 then raise exception 'invalid_criteria'; end if;
    return case when c in ('eq','in') then '(' || array_to_string(rngs, ' or ') || ')' else 'not coalesce(' || array_to_string(rngs, ' or ') || ', false)' end;
  end if;
  -- datas
  if f in ('registered_at','joined_at','class_changed') then
    col := case f when 'registered_at' then 'p.registered_at' when 'joined_at' then 'p.joined_at'
      else '(select max(coalesce(h.occurred_on, (h.at at time zone ''America/Sao_Paulo'')::date)) from person_history h where h.person_id = p.id and h.kind = ''classification'' and h.voided_at is null)' end;
    if c = 'filled' then return '(' || col || ' is not null)'; elsif c = 'empty' then return '(' || col || ' is null)'; end if;
    begin
      if c = 'eq' then return format('(%s = %L::date)', col, (v->>0)::date); elsif c = 'neq' then return format('(%s is distinct from %L::date)', col, (v->>0)::date);
      elsif c = 'gt' then return format('(%s > %L::date)', col, (v->>0)::date); elsif c = 'lt' then return format('(%s < %L::date)', col, (v->>0)::date);
      elsif c = 'between' then return format('(%s between %L::date and %L::date)', col, (v->>0)::date, (v->>1)::date);
      elsif c = 'not_between' then return format('(%s is null or %s not between %L::date and %L::date)', col, col, (v->>0)::date, (v->>1)::date); end if;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'invalid_criteria'; end;
    raise exception 'invalid_operator';
  end if;
  -- vínculos existentes (existe / não existe)
  if f in ('network','team','group','journey','journey_active','journey_paused','journey_completed','function','title','wallet','convert','wallet_eligible') then
    if f = 'convert' or f = 'wallet_eligible' then
      if c not in ('eq','neq') then raise exception 'invalid_operator'; end if;
      ex := case f when 'convert' then 'exists (select 1 from faith_decisions fd where fd.person_id = p.id and fd.voided_at is null)' else '(p.classification = ''member'' and p.status = ''active'')' end;
      return case when (c = 'eq') = coalesce((v->>0)::boolean, true) then '(' || ex || ')' else '(not ' || ex || ')' end;
    end if;
    if f = 'wallet' then
      if c in ('filled','empty') then return format('(public.wl_status(p.id) %s ''none'')', case c when 'filled' then '<>' else '=' end); end if;
      if exists (select 1 from jsonb_array_elements_text(v) x where x not in ('none','active','suspended','revoked')) then raise exception 'invalid_criteria'; end if;
      return format('(public.wl_status(p.id) %s (%s))', case when c in ('neq','not_in') then 'not in' else 'in' end, public.sg_list(v, 'text'));
    end if;
    if c in ('filled','empty') then vals := null;
    elsif c in ('eq','in','neq','not_in') then
      vals := public.sg_list(v, case when f in ('function') then 'text' when f = 'title' then 'text' else 'uuid' end);
    elsif c in ('contains','not_contains') and f = 'title' then vals := null;
    else raise exception 'invalid_operator'; end if;
    ex := case f
      when 'network' then 'exists (select 1 from team_members tm join network_teams nt on nt.team_id = tm.team_id where tm.user_id = p.user_id' || case when vals is null then '' else ' and nt.network_id in (' || vals || ')' end || ')'
      when 'team' then 'exists (select 1 from team_members tm where tm.user_id = p.user_id and tm.org_id = p.org_id' || case when vals is null then '' else ' and tm.team_id in (' || vals || ')' end || ')'
      when 'group' then 'exists (select 1 from seg_group_members gm where gm.person_id = p.id and gm.status = ''active''' || case when vals is null then '' else ' and gm.group_id in (' || vals || ')' end || ')'
      when 'journey' then 'exists (select 1 from journey_participants jp where jp.person_id = p.id and jp.status <> ''cancelled''' || case when vals is null then '' else ' and jp.journey_id in (' || vals || ')' end || ')'
      when 'journey_active' then 'exists (select 1 from journey_participants jp where jp.person_id = p.id and jp.status = ''active''' || case when vals is null then '' else ' and jp.journey_id in (' || vals || ')' end || ')'
      when 'journey_paused' then 'exists (select 1 from journey_participants jp where jp.person_id = p.id and jp.status = ''paused''' || case when vals is null then '' else ' and jp.journey_id in (' || vals || ')' end || ')'
      when 'journey_completed' then 'exists (select 1 from journey_participants jp where jp.person_id = p.id and jp.status = ''completed''' || case when vals is null then '' else ' and jp.journey_id in (' || vals || ')' end || ')'
      when 'function' then 'false'
      else null end;
    if f = 'function' then
      if c in ('eq','in','neq','not_in') and exists (select 1 from jsonb_array_elements_text(v) x where x not in ('team_leader','network_supervisor','general_leader','secretary')) then raise exception 'invalid_criteria'; end if;
      ex := '(' || concat_ws(' or ',
        case when vals is null or vals like '%team_leader%' then 'exists (select 1 from team_members tm where tm.user_id = p.user_id and tm.org_id = p.org_id and tm.is_leader)' end,
        case when vals is null or vals like '%network_supervisor%' then 'exists (select 1 from access_grants g where g.user_id = p.user_id and g.org_id = p.org_id and g.role_key = ''network_supervisor'')' end,
        case when vals is null or vals like '%general_leader%' then 'exists (select 1 from access_grants g where g.user_id = p.user_id and g.org_id = p.org_id and g.role_key = ''general_leader'')' end,
        case when vals is null or vals like '%secretary%' then 'exists (select 1 from access_grants g where g.user_id = p.user_id and g.org_id = p.org_id and g.role_key = ''secretary'')' end) || ')';
    elsif f = 'title' then
      ex := 'exists (select 1 from access_grants g where g.user_id = p.user_id and g.org_id = p.org_id and g.title is not null' ||
            case when c in ('contains','not_contains') then format(' and g.title ilike %L', '%' || replace(replace(v->>0, '\', '\\'), '%', '\%') || '%') when vals is null then '' else ' and lower(g.title) in (' || lower(vals) || ')' end || ')';
    end if;
    return case when neg then '(not ' || ex || ')' else '(' || ex || ')' end;
  end if;
  raise exception 'invalid_field';
end $$;
-- pessoas (dentro do escopo de quem consulta) que atendem aos critérios; a ordem das condições não muda o resultado
create or replace function public.sg_ids(p_org uuid, p_crit jsonb) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare w text; v_n int;
begin
  perform public.sg_scope(p_org);
  if p_crit is null or jsonb_typeof(p_crit) <> 'object' then raise exception 'invalid_criteria'; end if;
  select count(*) into v_n from regexp_matches(p_crit::text, '"field"', 'g'); if v_n > 30 then raise exception 'invalid_criteria'; end if;
  w := public.sg_cond(p_org, p_crit, 0);
  return query execute format('select distinct p.id from public.sg_people(%L) p where %s', p_org, w);
end $$;
revoke execute on function public.sg_vals(jsonb), public.sg_list(jsonb, text), public.sg_cond(uuid, jsonb, int), public.sg_ids(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- segmentos
create or replace function public.sg_row(pe public.people, p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pe.id, 'name', pe.full_name, 'classification', pe.classification, 'status', pe.status, 'photo_url', pe.photo_url,
    'age', case when pe.birth_date is not null and public.has_people_perm(p_org, 'people_view') then date_part('year', age(public.rp_today(), pe.birth_date))::int end,
    'links', coalesce((select jsonb_agg(x.n order by x.n) from (select t.name n from team_members tm join teams t on t.id = tm.team_id where tm.user_id = pe.user_id and tm.org_id = pe.org_id limit 3) x), '[]'::jsonb))
$$;
revoke execute on function public.sg_row(public.people, uuid) from public, anon, authenticated;

create or replace function public.segment_preview(p_org uuid, p_criteria jsonb, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[];
begin
  perform public.sg_need(p_org, 'people_segments_view');
  select coalesce(array_agg(x), '{}') into v_ids from public.sg_ids(p_org, p_criteria) x;
  return jsonb_build_object('total', cardinality(v_ids), 'items', coalesce((select jsonb_agg(public.sg_row(pe, p_org) order by pe.full_name) from (select * from people where id = any (v_ids) order by full_name limit least(greatest(coalesce(p_limit, 20), 1), 100)) pe), '[]'::jsonb));
end $$;

create or replace function public.segment_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seg_segments; v_name text := trim(coalesce(p->>'name', '')); v_crit jsonb := p->'criteria'; v_kind text := coalesce(nullif(p->>'kind', ''), 'dynamic'); v_owner uuid := nullif(p->>'owner_id', '')::uuid; v_id uuid;
begin
  perform public.sg_need(p_org, case when p_id is null then 'people_segments_create' else 'people_segments_edit' end);
  if length(v_name) not between 1 and 80 then raise exception 'name_required'; end if;
  if v_kind not in ('dynamic','links','roles') then raise exception 'invalid_criteria'; end if;
  if v_crit is null or jsonb_typeof(v_crit) <> 'object' or v_crit::text not like '%"field"%' then raise exception 'criteria_required'; end if;
  perform 1 from public.sg_ids(p_org, v_crit) limit 1; -- valida critérios e permissões de campo
  if v_owner is not null and not exists (select 1 from org_members where org_id = p_org and user_id = v_owner) then raise exception 'invalid_owner'; end if;
  if p_id is null then
    begin
      insert into seg_segments (org_id, name, description, kind, criteria, owner_id, created_by) values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_kind, v_crit, coalesce(v_owner, auth.uid()), auth.uid()) returning id into v_id;
    exception when unique_violation then raise exception 'duplicate_name'; end;
    insert into seg_log (org_id, segment_id, kind, actor, detail) values (p_org, v_id, 'created', auth.uid(), jsonb_build_object('name', v_name));
  else
    select * into s from seg_segments where id = p_id and org_id = p_org for update; if not found then raise exception 'not_found'; end if;
    begin
      update seg_segments set name = v_name, description = nullif(trim(coalesce(p->>'description', '')), ''), kind = v_kind, criteria = v_crit, owner_id = coalesce(v_owner, owner_id), updated_at = now() where id = p_id;
    exception when unique_violation then raise exception 'duplicate_name'; end;
    insert into seg_log (org_id, segment_id, kind, actor, detail) values (p_org, p_id, 'updated', auth.uid(), jsonb_build_object('name', v_name, 'criteria_changed', s.criteria is distinct from v_crit));
    v_id := p_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.segment_set_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seg_segments;
begin
  select * into s from seg_segments where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(s.org_id, 'people_segments_delete');
  update seg_segments set active = coalesce(p_active, false), updated_at = now() where id = p_id;
  insert into seg_log (org_id, segment_id, kind, actor) values (s.org_id, p_id, case when p_active then 'activated' else 'deactivated' end, auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- quem entrou e quem saiu desde a última consulta fica registrado (a lista em si é sempre calculada na hora)
create or replace function public.sg_sync(s seg_segments) returns int
language plpgsql security definer set search_path = public as $$
declare v_cur uuid[]; v_in uuid[]; v_out uuid[];
begin
  select coalesce(array_agg(x), '{}') into v_cur from public.sg_ids(s.org_id, s.criteria) x;
  if public.sg_scope(s.org_id) <> 'all' then return cardinality(v_cur); end if;
  select coalesce(array_agg(u), '{}') into v_in from unnest(v_cur) u where not exists (select 1 from seg_segment_cache c where c.segment_id = s.id and c.person_id = u);
  select coalesce(array_agg(c.person_id), '{}') into v_out from seg_segment_cache c where c.segment_id = s.id and not (c.person_id = any (v_cur));
  insert into seg_log (org_id, segment_id, person_id, kind, actor) select s.org_id, s.id, u, 'entered', null from unnest(v_in) u;
  insert into seg_log (org_id, segment_id, person_id, kind, actor) select s.org_id, s.id, u, 'left', null from unnest(v_out) u;
  delete from seg_segment_cache where segment_id = s.id and person_id = any (v_out);
  insert into seg_segment_cache (segment_id, person_id) select s.id, u from unnest(v_in) u on conflict do nothing;
  return cardinality(v_cur);
end $$;
revoke execute on function public.sg_sync(seg_segments) from public, anon, authenticated;

create or replace function public.segment_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_st text := nullif(p->>'status', ''); v_ord text := coalesce(p->>'order', 'name');
begin
  perform public.sg_need(p_org, 'people_segments_view');
  return coalesce((select jsonb_agg(x.j order by case when v_ord = 'name' then lower(x.nm) end asc, case when v_ord = 'count' then x.cnt end desc, case when v_ord = 'recent' then x.up end desc) from (
    select s.name nm, s.updated_at up, (select count(*) from public.sg_ids(p_org, s.criteria)) cnt,
      jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'kind', s.kind, 'active', s.active, 'owner', coalesce(public.welcome_name(p_org, s.owner_id), ''), 'created_at', s.created_at, 'updated_at', s.updated_at,
        'count', (select count(*) from public.sg_ids(p_org, s.criteria))) j
      from seg_segments s where s.org_id = p_org and (v_q is null or s.name ilike '%' || v_q || '%') and (v_st is null or s.active = (v_st = 'active'))) x), '[]'::jsonb);
end $$;

create or replace function public.segment_get(p_id uuid, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seg_segments; v_ids uuid[];
begin
  select * into s from seg_segments where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(s.org_id, 'people_segments_view');
  perform public.sg_sync(s);
  select coalesce(array_agg(x), '{}') into v_ids from public.sg_ids(s.org_id, s.criteria) x;
  return jsonb_build_object('segment', jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'kind', s.kind, 'criteria', s.criteria, 'active', s.active, 'owner_id', s.owner_id,
      'owner', coalesce(public.welcome_name(s.org_id, s.owner_id), ''), 'created_at', s.created_at, 'updated_at', s.updated_at),
    'total', cardinality(v_ids),
    'items', coalesce((select jsonb_agg(public.sg_row(pe, s.org_id) order by pe.full_name) from (select * from people where id = any (v_ids) order by full_name limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) pe), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'person', (select full_name from people where id = l.person_id), 'by', public.welcome_name(l.org_id, l.actor), 'at', l.at, 'detail', l.detail) order by l.at desc, l.id desc)
                  from (select * from seg_log where segment_id = p_id order by at desc, id desc limit 60) l), '[]'::jsonb));
end $$;

-- exportar participantes (campos mínimos) e consultar o público de um segmento para outros módulos
create or replace function public.segment_export(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seg_segments; v_items jsonb;
begin
  select * into s from seg_segments where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(s.org_id, 'people_segments_export');
  select coalesce(jsonb_agg(jsonb_build_object('name', pe.full_name, 'classification', pe.classification, 'status', pe.status) order by pe.full_name), '[]'::jsonb) into v_items from people pe where pe.id in (select public.sg_ids(s.org_id, s.criteria));
  insert into seg_log (org_id, segment_id, kind, actor, detail) values (s.org_id, p_id, 'exported', auth.uid(), jsonb_build_object('rows', jsonb_array_length(v_items)));
  return jsonb_build_object('name', s.name, 'items', v_items);
end $$;
-- público atual do segmento para uso por outros módulos (comunicação, eventos, conteúdos). Nunca dispara mensagens por si só.
create or replace function public.segment_audience(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s seg_segments;
begin
  select * into s from seg_segments where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(s.org_id, 'people_segments_use');
  if not s.active then raise exception 'segment_inactive'; end if;
  return jsonb_build_object('people', (select count(*) from public.sg_ids(s.org_id, s.criteria)),
    'with_account', (select count(*) from people pe where pe.id in (select public.sg_ids(s.org_id, s.criteria)) and pe.user_id is not null),
    'user_ids', coalesce((select jsonb_agg(pe.user_id) from people pe where pe.id in (select public.sg_ids(s.org_id, s.criteria)) and pe.user_id is not null and pe.status = 'active'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- grupos manuais
create or replace function public.sg_group_vis(g seg_groups) returns boolean
language sql stable security definer set search_path = public as $$
  select g.visibility = 'all' or g.created_by = auth.uid() or g.owner_id = auth.uid() or exists (select 1 from org_members where org_id = g.org_id and user_id = auth.uid() and role = 'admin')
$$;
revoke execute on function public.sg_group_vis(seg_groups) from public, anon, authenticated;

create or replace function public.group_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g seg_groups; v_name text := trim(coalesce(p->>'name', '')); v_kind text := coalesce(nullif(p->>'kind', ''), 'permanent'); v_vis text := coalesce(nullif(p->>'visibility', ''), 'all');
        v_owner uuid := nullif(p->>'owner_id', '')::uuid; v_ends date := nullif(p->>'ends_on', '')::date; v_id uuid;
begin
  perform public.sg_need(p_org, case when p_id is null then 'people_groups_create' else 'people_groups_members' end);
  if length(v_name) not between 1 and 80 then raise exception 'name_required'; end if;
  if v_kind not in ('permanent','temporary') or v_vis not in ('all','restricted') then raise exception 'invalid_criteria'; end if;
  if v_owner is not null and not exists (select 1 from org_members where org_id = p_org and user_id = v_owner) then raise exception 'invalid_owner'; end if;
  if p_id is null then
    begin insert into seg_groups (org_id, name, description, category, kind, visibility, ends_on, owner_id, created_by) values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), nullif(trim(coalesce(p->>'category', '')), ''), v_kind, v_vis, v_ends, coalesce(v_owner, auth.uid()), auth.uid()) returning id into v_id;
    exception when unique_violation then raise exception 'duplicate_name'; end;
    insert into seg_log (org_id, group_id, kind, actor, detail) values (p_org, v_id, 'created', auth.uid(), jsonb_build_object('name', v_name));
  else
    select * into g from seg_groups where id = p_id and org_id = p_org for update; if not found then raise exception 'not_found'; end if;
    if not public.sg_group_vis(g) then raise exception 'forbidden'; end if;
    begin update seg_groups set name = v_name, description = nullif(trim(coalesce(p->>'description', '')), ''), category = nullif(trim(coalesce(p->>'category', '')), ''), kind = v_kind, visibility = v_vis, ends_on = v_ends, owner_id = coalesce(v_owner, owner_id), updated_at = now() where id = p_id;
    exception when unique_violation then raise exception 'duplicate_name'; end;
    insert into seg_log (org_id, group_id, kind, actor, detail) values (p_org, p_id, 'updated', auth.uid(), jsonb_build_object('name', v_name));
    v_id := p_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.group_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g seg_groups;
begin
  select * into g from seg_groups where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(g.org_id, 'people_groups_members');
  if p_status not in ('active','inactive','closed') then raise exception 'invalid_status'; end if;
  if not public.sg_group_vis(g) then raise exception 'forbidden'; end if;
  update seg_groups set status = p_status, updated_at = now() where id = p_id; -- participantes e histórico permanecem
  insert into seg_log (org_id, group_id, kind, actor, detail) values (g.org_id, p_id, 'status', auth.uid(), jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.group_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_st text := nullif(p->>'status', '');
begin
  perform public.sg_need(p_org, 'people_groups_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'category', g.category, 'kind', g.kind, 'status', g.status, 'visibility', g.visibility,
      'owner', coalesce(public.welcome_name(p_org, g.owner_id), ''), 'created_at', g.created_at, 'ends_on', g.ends_on,
      'count', (select count(*) from seg_group_members m where m.group_id = g.id and m.status = 'active')) order by lower(g.name))
    from seg_groups g where g.org_id = p_org and public.sg_group_vis(g) and (v_q is null or g.name ilike '%' || v_q || '%') and (v_st is null or g.status = v_st)), '[]'::jsonb);
end $$;

create or replace function public.group_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g seg_groups;
begin
  select * into g from seg_groups where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(g.org_id, 'people_groups_view');
  if not public.sg_group_vis(g) then raise exception 'forbidden'; end if;
  return jsonb_build_object('group', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'category', g.category, 'kind', g.kind, 'visibility', g.visibility, 'ends_on', g.ends_on, 'status', g.status,
      'owner_id', g.owner_id, 'owner', coalesce(public.welcome_name(g.org_id, g.owner_id), ''), 'creator', coalesce(public.welcome_name(g.org_id, g.created_by), ''), 'created_at', g.created_at),
    'members', coalesce((select jsonb_agg(public.sg_row(pe, g.org_id) || jsonb_build_object('since', m.added_at) order by pe.full_name) from seg_group_members m join public.sg_people(g.org_id) pe on pe.id = m.person_id where m.group_id = g.id and m.status = 'active'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('person', pe.full_name, 'status', m.status, 'added_at', m.added_at, 'added_by', public.welcome_name(g.org_id, m.added_by), 'removed_at', m.removed_at, 'removed_by', public.welcome_name(g.org_id, m.removed_by), 'reason', m.remove_reason) order by coalesce(m.removed_at, m.added_at) desc)
                  from seg_group_members m join people pe on pe.id = m.person_id where m.group_id = g.id), '[]'::jsonb));
end $$;

-- adicionar em lote: quem já participa é ignorado; quem está fora do escopo ou não existe volta como falha
create or replace function public.group_members_add(p_id uuid, p_people uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g seg_groups; pid uuid; v_added int := 0; v_skip int := 0; v_fail jsonb := '[]'::jsonb;
begin
  select * into g from seg_groups where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(g.org_id, 'people_groups_members');
  if not public.sg_group_vis(g) then raise exception 'forbidden'; end if;
  if g.status <> 'active' then raise exception 'group_not_active'; end if;
  if p_people is null or cardinality(p_people) = 0 or cardinality(p_people) > 500 then raise exception 'invalid_criteria'; end if;
  for pid in select distinct x from unnest(p_people) x loop
    if not exists (select 1 from public.sg_people(g.org_id) pe where pe.id = pid) then v_fail := v_fail || jsonb_build_object('person_id', pid, 'reason', 'not_visible'); continue; end if;
    insert into seg_group_members (group_id, org_id, person_id, added_by) values (p_id, g.org_id, pid, auth.uid()) on conflict do nothing;
    if found then v_added := v_added + 1; insert into seg_log (org_id, group_id, person_id, kind, actor) values (g.org_id, p_id, pid, 'member_added', auth.uid()); else v_skip := v_skip + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'already', v_skip, 'failed', v_fail);
end $$;

create or replace function public.group_member_remove(p_id uuid, p_person uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g seg_groups;
begin
  select * into g from seg_groups where id = p_id; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(g.org_id, 'people_groups_members');
  if not public.sg_group_vis(g) then raise exception 'forbidden'; end if;
  update seg_group_members set status = 'removed', removed_by = auth.uid(), removed_at = now(), remove_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200) where group_id = p_id and person_id = p_person and status = 'active';
  if not found then raise exception 'not_found'; end if;
  insert into seg_log (org_id, group_id, person_id, kind, actor, detail) values (g.org_id, p_id, p_person, 'member_removed', auth.uid(), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.segment_options(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sg_scope(p_org);
  return jsonb_build_object('scope', public.sg_scope(p_org),
    'can', (select jsonb_object_agg(a, public.has_people_perm(p_org, a)) from unnest(array['people_segments_view','people_segments_create','people_segments_edit','people_segments_delete','people_groups_view','people_groups_create','people_groups_members','people_segments_functions','people_segments_export','people_segments_use','people_view']) a),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from church_networks where org_id = p_org), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from teams where org_id = p_org), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name) from seg_groups g where g.org_id = p_org and public.sg_group_vis(g)), '[]'::jsonb),
    'journeys', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from journeys where org_id = p_org), '[]'::jsonb),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('i', (t.o - 1)::text, 'label', t.b->>'label') order by t.o), '[]'::jsonb) from jsonb_array_elements(public.rp_bands(p_org)) with ordinality t(b, o)),
    'cities', coalesce((select jsonb_agg(k order by k) from (select distinct nullif(trim(city), '') k from public.sg_people(p_org) where nullif(trim(city), '') is not null limit 200) z), '[]'::jsonb),
    'neighborhoods', coalesce((select jsonb_agg(k order by k) from (select distinct nullif(trim(neighborhood), '') k from public.sg_people(p_org) where nullif(trim(neighborhood), '') is not null limit 200) z), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name) order by full_name) from (select id, full_name from public.sg_people(p_org) order by full_name limit 1000) z), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', om.user_id, 'name', coalesce(public.welcome_name(p_org, om.user_id), '')) order by public.welcome_name(p_org, om.user_id)) from org_members om where om.org_id = p_org), '[]'::jsonb));
end $$;
revoke execute on function public.segment_preview(uuid, jsonb, int), public.segment_save(uuid, uuid, jsonb), public.segment_set_active(uuid, boolean), public.segment_list(uuid, jsonb), public.segment_get(uuid, int, int), public.segment_export(uuid), public.segment_audience(uuid),
  public.group_save(uuid, uuid, jsonb), public.group_set_status(uuid, text), public.group_list(uuid, jsonb), public.group_get(uuid), public.group_members_add(uuid, uuid[]), public.group_member_remove(uuid, uuid, text), public.segment_options(uuid) from public, anon;
grant execute on function public.segment_preview(uuid, jsonb, int), public.segment_save(uuid, uuid, jsonb), public.segment_set_active(uuid, boolean), public.segment_list(uuid, jsonb), public.segment_get(uuid, int, int), public.segment_export(uuid), public.segment_audience(uuid),
  public.group_save(uuid, uuid, jsonb), public.group_set_status(uuid, text), public.group_list(uuid, jsonb), public.group_get(uuid), public.group_members_add(uuid, uuid[]), public.group_member_remove(uuid, uuid, text), public.segment_options(uuid) to authenticated;

-- ================================================================ RECURSO 12: CARTEIRA DIGITAL DO MEMBRO
-- Identificação eclesiástica digital (não é documento civil nem meio de pagamento). A matrícula pertence à PESSOA e nunca é reaproveitada.
-- O QR traz só um token assinado: nenhum dado pessoal. O token é derivado no servidor de um segredo da igreja; não é guardado em lugar nenhum,
-- renovar ou revogar muda a versão e invalida qualquer QR antigo. Quem valida consulta o servidor; o aparelho nunca decide a validade.
create table if not exists public.wallet_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  title text not null default 'CARTEIRA DE MEMBRO' check (length(trim(title)) between 1 and 40),
  church_name text check (church_name is null or length(trim(church_name)) between 1 and 80),
  accent text check (accent is null or accent ~ '^#[0-9A-Fa-f]{6}$'),
  style text not null default 'dark' check (style in ('dark','light','accent')),
  show_logo boolean not null default true, show_photo boolean not null default true, show_issue_date boolean not null default true, show_matricula boolean not null default true,
  public_matricula boolean not null default false,   -- mostra a matrícula na página pública de validação?
  public_photo boolean not null default true,
  issue_policy text not null default 'manual' check (issue_policy in ('manual','auto')),            -- auto: o membro elegível emite ao abrir
  suspension_policy text not null default 'auto' check (suspension_policy in ('auto','manual')),     -- auto: inativo = suspensa
  matricula_prefix text not null default 'M' check (matricula_prefix ~ '^[A-Za-z0-9]{0,6}$'),
  matricula_digits int not null default 5 check (matricula_digits between 3 and 8),
  matricula_next bigint not null default 1,
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table if not exists public.person_matricula (
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  matricula text not null, created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null,
  primary key (org_id, person_id)
);
create unique index if not exists person_matricula_unique on public.person_matricula (org_id, matricula);
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  version int not null default 1,                       -- sobe a cada renovação/reemissão; QR de versão antiga nunca mais vale
  issued_at timestamptz not null default now(), issued_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  suspended_at timestamptz, revoked_at timestamptz, reason text check (reason is null or length(reason) <= 300),
  unique (org_id, person_id)
);
create table if not exists public.wallet_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null, person_id uuid,
  kind text not null, actor uuid references auth.users(id) on delete set null, reason text, detail jsonb, at timestamptz not null default now()
);
create index if not exists wallet_log_wallet on public.wallet_log (wallet_id, at desc);
create table if not exists public.wallet_attempts (id bigint generated always as identity primary key, bucket text not null, ok boolean not null, at timestamptz not null default now());
create index if not exists wallet_attempts_bucket on public.wallet_attempts (bucket, at desc);
alter table public.wallet_settings enable row level security; alter table public.person_matricula enable row level security; alter table public.wallets enable row level security;
alter table public.wallet_log enable row level security; alter table public.wallet_attempts enable row level security;
revoke all on public.wallet_settings, public.person_matricula, public.wallets, public.wallet_log, public.wallet_attempts from anon, authenticated;

create or replace function public.wl_cfg(p_org uuid) returns public.wallet_settings
language plpgsql security definer set search_path = public as $$
declare c wallet_settings;
begin
  insert into wallet_settings (org_id) values (p_org) on conflict do nothing;
  select * into c from wallet_settings where org_id = p_org; return c;
end $$;
-- token = id da carteira + assinatura (derivada do segredo da igreja e da versão); sem armazenamento
create or replace function public.wl_token(w public.wallets) returns text
language sql stable security definer set search_path = public as $$
  select replace(w.id::text, '-', '') || '.' || left(encode(sha256(convert_to(c.secret, 'utf8') || sha256(convert_to(c.secret || ':' || w.id::text || ':' || w.version::text, 'utf8'))), 'hex'), 32)
    from wallet_settings c where c.org_id = w.org_id
$$;
create or replace function public.wl_eligible(pe public.people) returns boolean language sql immutable as $$ select pe.classification = 'member' and pe.status = 'active' $$;
-- situação efetiva: o servidor reavalia a ficha a cada consulta (inativação e perda de membresia suspendem sem depender de ninguém lembrar)
create or replace function public.wl_effective(w public.wallets, pe public.people, c public.wallet_settings) returns text
language sql immutable as $$
  select case when w.status = 'revoked' then 'revoked'
    when w.status = 'suspended' or pe.classification <> 'member' or pe.status in ('pending','rejected') or (pe.status = 'inactive' and c.suspension_policy = 'auto') then 'suspended' else 'active' end
$$;
create or replace function public.wl_status(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select public.wl_effective(w, pe, c) from wallets w join people pe on pe.id = w.person_id join wallet_settings c on c.org_id = w.org_id where w.person_id = p_person), 'none')
$$;
revoke execute on function public.wl_cfg(uuid), public.wl_token(public.wallets), public.wl_eligible(public.people), public.wl_effective(public.wallets, public.people, public.wallet_settings), public.wl_status(uuid) from public, anon, authenticated;

create or replace function public.wl_matricula(p_org uuid, p_person uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m text; c wallet_settings; n bigint; i int := 0;
begin
  select matricula into m from person_matricula where org_id = p_org and person_id = p_person; if found then return m; end if;
  perform public.wl_cfg(p_org);
  loop
    update wallet_settings set matricula_next = matricula_next + 1 where org_id = p_org returning * into c; n := c.matricula_next - 1;
    m := case when c.matricula_prefix = '' then '' else upper(c.matricula_prefix) || '-' end || lpad(n::text, c.matricula_digits, '0');
    begin insert into person_matricula (org_id, person_id, matricula, created_by) values (p_org, p_person, m, auth.uid()); return m;
    exception when unique_violation then
      select matricula into m from person_matricula where org_id = p_org and person_id = p_person; if found then return m; end if;  -- outra emissão simultânea
      i := i + 1; if i > 20 then raise exception 'matricula_conflict'; end if;
    end;
  end loop;
end $$;
revoke execute on function public.wl_matricula(uuid, uuid) from public, anon, authenticated;

create or replace function public.wl_log(p_org uuid, p_wallet uuid, p_person uuid, p_kind text, p_reason text default null, p_detail jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into wallet_log (org_id, wallet_id, person_id, kind, actor, reason, detail) values (p_org, p_wallet, p_person, p_kind, auth.uid(), p_reason, p_detail)
$$;
revoke execute on function public.wl_log(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
create or replace function public.wl_notify(w public.wallets, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select user_id into u from people where id = w.person_id; if u is null then return; end if;
  perform public.notify_user(u, w.org_id, 'wallet', case p_kind when 'issued' then 'Sua carteira digital foi emitida' when 'reissued' then 'Sua carteira digital foi reemitida' when 'suspended' then 'Sua carteira digital foi suspensa' when 'reactivated' then 'Sua carteira digital foi reativada' else 'Sua carteira digital foi revogada' end,
    case p_kind when 'issued' then 'Abra Meu perfil → Carteira Digital para ver.' when 'reissued' then 'Use o novo QR Code a partir de agora.' else 'Procure a secretaria da igreja se tiver dúvidas.' end, '#/carteira', null);
end $$;
revoke execute on function public.wl_notify(public.wallets, text) from public, anon, authenticated;

-- emissão (individual, lote e auto-emissão passam por aqui): a elegibilidade é SEMPRE reavaliada na ficha
create or replace function public.wl_issue(p_org uuid, p_person uuid, p_reason text, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pe people; w wallets; c wallet_settings := public.wl_cfg(p_org);
begin
  select * into pe from people where id = p_person and org_id = p_org; if not found then raise exception 'not_found'; end if;
  if pe.status = 'pending' then raise exception 'person_pending'; end if;
  if not public.wl_eligible(pe) then raise exception 'not_eligible'; end if;
  select * into w from wallets where org_id = p_org and person_id = p_person for update;
  if found then raise exception 'already_issued'; end if;
  perform public.wl_matricula(p_org, p_person);
  insert into wallets (org_id, person_id, issued_by) values (p_org, p_person, auth.uid()) returning * into w;
  perform public.wl_log(p_org, w.id, p_person, p_kind, p_reason);
  perform public.wl_notify(w, 'issued');
  return w.id;
end $$;
revoke execute on function public.wl_issue(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.wallet_issue(p_org uuid, p_person uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.sg_need(p_org, 'people_wallet_issue');
  if not exists (select 1 from public.sg_people(p_org) where id = p_person) then raise exception 'forbidden'; end if;
  v_id := public.wl_issue(p_org, p_person, p_reason, 'issued');
  return jsonb_build_object('id', v_id, 'matricula', (select matricula from person_matricula where org_id = p_org and person_id = p_person));
end $$;

create or replace function public.wl_load(p_id uuid, p_action text) returns public.wallets
language plpgsql security definer set search_path = public as $$
declare w wallets;
begin
  select * into w from wallets where id = p_id for update; if not found then raise exception 'not_found'; end if;
  perform public.sg_need(w.org_id, p_action);
  if not exists (select 1 from public.sg_people(w.org_id) where id = w.person_id) then raise exception 'forbidden'; end if;
  return w;
end $$;
revoke execute on function public.wl_load(uuid, text) from public, anon, authenticated;

create or replace function public.wallet_suspend(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets := public.wl_load(p_id, 'people_wallet_suspend');
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  if w.status <> 'active' then raise exception 'invalid_status'; end if;
  update wallets set status = 'suspended', suspended_at = now(), reason = left(p_reason, 300), updated_at = now() where id = p_id returning * into w;
  perform public.wl_log(w.org_id, w.id, w.person_id, 'suspended', p_reason); perform public.wl_notify(w, 'suspended');
  return jsonb_build_object('status', 'suspended');
end $$;
create or replace function public.wallet_reactivate(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets := public.wl_load(p_id, 'people_wallet_reactivate'); pe people;
begin
  if w.status <> 'suspended' then raise exception 'invalid_status'; end if;
  select * into pe from people where id = w.person_id; if not public.wl_eligible(pe) then raise exception 'not_eligible'; end if;
  update wallets set status = 'active', suspended_at = null, reason = null, updated_at = now() where id = p_id returning * into w;
  perform public.wl_log(w.org_id, w.id, w.person_id, 'reactivated', p_reason); perform public.wl_notify(w, 'reactivated');
  return jsonb_build_object('status', 'active');
end $$;
create or replace function public.wallet_revoke(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets := public.wl_load(p_id, 'people_wallet_revoke');
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  if w.status = 'revoked' then raise exception 'invalid_status'; end if;
  update wallets set status = 'revoked', revoked_at = now(), reason = left(p_reason, 300), updated_at = now() where id = p_id returning * into w;
  perform public.wl_log(w.org_id, w.id, w.person_id, 'revoked', p_reason); perform public.wl_notify(w, 'revoked');
  return jsonb_build_object('status', 'revoked');
end $$;
-- reemitir: novo QR e nova data, mesma matrícula. Vale também para carteira revogada, desde que a pessoa seja elegível de novo.
create or replace function public.wallet_reissue(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets := public.wl_load(p_id, 'people_wallet_issue'); pe people;
begin
  select * into pe from people where id = w.person_id; if not public.wl_eligible(pe) then raise exception 'not_eligible'; end if;
  update wallets set status = 'active', version = version + 1, issued_at = now(), issued_by = auth.uid(), suspended_at = null, revoked_at = null, reason = null, updated_at = now() where id = p_id returning * into w;
  perform public.wl_log(w.org_id, w.id, w.person_id, 'reissued', p_reason); perform public.wl_notify(w, 'reissued');
  return jsonb_build_object('status', 'active', 'matricula', (select matricula from person_matricula where org_id = w.org_id and person_id = w.person_id));
end $$;
create or replace function public.wallet_renew_token(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wallets := public.wl_load(p_id, 'people_wallet_token');
begin
  update wallets set version = version + 1, updated_at = now() where id = p_id returning * into w;
  perform public.wl_log(w.org_id, w.id, w.person_id, 'token_renewed', p_reason);
  return jsonb_build_object('ok', true);
end $$;

-- lote: seleção por pessoas, por segmento ou todos os elegíveis; cada pessoa é conferida de novo; repetir a operação não duplica
create or replace function public.wallet_batch(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; pid uuid; v_ok int := 0; v_skip int := 0; v_fail jsonb := '[]'::jsonb; v_seg uuid := nullif(p->>'segment_id', '')::uuid; v_net uuid := nullif(p->>'network_id', '')::uuid; s seg_segments;
begin
  perform public.sg_need(p_org, 'people_wallet_batch');
  if jsonb_typeof(p->'person_ids') = 'array' then select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p->'person_ids') x;
  elsif v_seg is not null then
    perform public.sg_need(p_org, 'people_segments_view');
    select * into s from seg_segments where id = v_seg and org_id = p_org; if not found then raise exception 'not_found'; end if;
    select array_agg(x) into v_ids from public.sg_ids(p_org, s.criteria) x;
  elsif coalesce((p->>'all')::boolean, false) then
    select array_agg(pe.id) into v_ids from public.sg_people(p_org) pe where public.wl_eligible(pe)
      and (v_net is null or exists (select 1 from team_members tm join network_teams nt on nt.team_id = tm.team_id where tm.user_id = pe.user_id and nt.network_id = v_net));
  else raise exception 'invalid_criteria'; end if;
  if v_ids is null or cardinality(v_ids) = 0 then return jsonb_build_object('created', 0, 'skipped', 0, 'failed', '[]'::jsonb, 'total', 0); end if;
  if cardinality(v_ids) > 2000 then raise exception 'too_many'; end if;
  for pid in select distinct x from unnest(v_ids) x loop
    begin
      if not exists (select 1 from public.sg_people(p_org) where id = pid) then raise exception 'forbidden'; end if;
      if exists (select 1 from wallets where org_id = p_org and person_id = pid) then v_skip := v_skip + 1; continue; end if;
      perform public.wl_issue(p_org, pid, null, 'issued_batch'); v_ok := v_ok + 1;
    exception when others then v_fail := v_fail || jsonb_build_object('person_id', pid, 'name', (select full_name from people where id = pid), 'reason', sqlerrm);
    end;
  end loop;
  perform public.wl_log(p_org, null, null, 'batch', null, jsonb_build_object('created', v_ok, 'skipped', v_skip, 'failed', jsonb_array_length(v_fail), 'segment', v_seg));
  return jsonb_build_object('created', v_ok, 'skipped', v_skip, 'failed', v_fail, 'total', cardinality(v_ids));
end $$;

create or replace function public.wallet_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_st text := coalesce(nullif(p->>'status', ''), 'all'); v_lim int := least(greatest(coalesce((p->>'limit')::int, 30), 1), 100); v_off int := greatest(coalesce((p->>'offset')::int, 0), 0);
        c wallet_settings; v_rows jsonb; v_total int; v_counts jsonb;
begin
  perform public.sg_need(p_org, 'people_wallet_view');
  c := public.wl_cfg(p_org);
  create temp table if not exists _wl_l (person_id uuid, wallet_id uuid, st text, nm text, mat text, j jsonb) on commit drop;
  delete from _wl_l;
  insert into _wl_l
  select pe.id, w.id, case when w.id is null then 'none' else public.wl_effective(w, pe, c) end, pe.full_name, pm.matricula,
         jsonb_build_object('person_id', pe.id, 'wallet_id', w.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'classification', pe.classification, 'person_status', pe.status, 'eligible', public.wl_eligible(pe),
           'status', case when w.id is null then 'none' else public.wl_effective(w, pe, c) end, 'stored_status', w.status, 'matricula', pm.matricula, 'issued_at', w.issued_at, 'reason', w.reason)
    from public.sg_people(p_org) pe left join wallets w on w.person_id = pe.id left join person_matricula pm on pm.person_id = pe.id and pm.org_id = pe.org_id
   where (pe.classification = 'member' or w.id is not null)
     and (v_q is null or pe.full_name ilike '%' || v_q || '%' or pm.matricula ilike '%' || v_q || '%');
  select jsonb_build_object('all', count(*), 'none', count(*) filter (where st = 'none' and (j->>'eligible')::boolean), 'active', count(*) filter (where st = 'active'), 'suspended', count(*) filter (where st = 'suspended'), 'revoked', count(*) filter (where st = 'revoked')) into v_counts from _wl_l;
  select count(*) into v_total from _wl_l where case when v_st = 'all' then true when v_st = 'none' then st = 'none' and (j->>'eligible')::boolean else st = v_st end;
  select coalesce(jsonb_agg(j order by nm), '[]'::jsonb) into v_rows from (select * from _wl_l where case when v_st = 'all' then true when v_st = 'none' then st = 'none' and (j->>'eligible')::boolean else st = v_st end order by nm limit v_lim offset v_off) z;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_rows);
end $$;

create or replace function public.wallet_get(p_org uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; w wallets; c wallet_settings;
begin
  perform public.sg_need(p_org, 'people_wallet_view');
  select * into pe from public.sg_people(p_org) where id = p_person; if not found then raise exception 'not_found'; end if;
  c := public.wl_cfg(p_org); select * into w from wallets where org_id = p_org and person_id = p_person;
  return jsonb_build_object('person', jsonb_build_object('id', pe.id, 'name', pe.full_name, 'classification', pe.classification, 'status', pe.status, 'photo_url', pe.photo_url), 'eligible', public.wl_eligible(pe),
    'wallet', case when w.id is null then null else jsonb_build_object('id', w.id, 'status', public.wl_effective(w, pe, c), 'stored_status', w.status, 'issued_at', w.issued_at, 'suspended_at', w.suspended_at, 'revoked_at', w.revoked_at, 'reason', w.reason, 'version', w.version) end,
    'matricula', (select matricula from person_matricula where org_id = p_org and person_id = p_person),
    'history', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'by', public.welcome_name(l.org_id, l.actor), 'reason', l.reason, 'at', l.at) order by l.at desc, l.id desc) from (select * from wallet_log where org_id = p_org and person_id = p_person order by at desc, id desc limit 50) l), '[]'::jsonb));
end $$;

-- configuração do modelo e das políticas
create or replace function public.wallet_settings_get(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c wallet_settings; o organizations;
begin
  perform public.sg_scope(p_org);
  c := public.wl_cfg(p_org); select * into o from organizations where id = p_org;
  return jsonb_build_object('title', c.title, 'church_name', coalesce(c.church_name, o.name), 'church_name_custom', c.church_name, 'accent', coalesce(c.accent, o.accent_color), 'accent_custom', c.accent, 'style', c.style, 'show_logo', c.show_logo, 'show_photo', c.show_photo,
    'show_issue_date', c.show_issue_date, 'show_matricula', c.show_matricula, 'public_matricula', c.public_matricula, 'public_photo', c.public_photo, 'issue_policy', c.issue_policy, 'suspension_policy', c.suspension_policy,
    'matricula_prefix', c.matricula_prefix, 'matricula_digits', c.matricula_digits, 'matricula_next', c.matricula_next, 'logo_url', o.logo_url, 'can_config', public.has_people_perm(p_org, 'people_wallet_config'));
end $$;
create or replace function public.wallet_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b boolean;
begin
  perform public.sg_need(p_org, 'people_wallet_config'); perform public.wl_cfg(p_org);
  begin
    update wallet_settings set title = coalesce(nullif(trim(p->>'title'), ''), title), church_name = case when p ? 'church_name' then nullif(trim(p->>'church_name'), '') else church_name end,
      accent = case when p ? 'accent' then nullif(p->>'accent', '') else accent end, style = coalesce(p->>'style', style),
      show_logo = coalesce((p->>'show_logo')::boolean, show_logo), show_photo = coalesce((p->>'show_photo')::boolean, show_photo), show_issue_date = coalesce((p->>'show_issue_date')::boolean, show_issue_date), show_matricula = coalesce((p->>'show_matricula')::boolean, show_matricula),
      public_matricula = coalesce((p->>'public_matricula')::boolean, public_matricula), public_photo = coalesce((p->>'public_photo')::boolean, public_photo),
      issue_policy = coalesce(p->>'issue_policy', issue_policy), suspension_policy = coalesce(p->>'suspension_policy', suspension_policy),
      matricula_prefix = coalesce(p->>'matricula_prefix', matricula_prefix), matricula_digits = coalesce((p->>'matricula_digits')::int, matricula_digits), updated_by = auth.uid(), updated_at = now() where org_id = p_org;
  exception when check_violation or invalid_text_representation then raise exception 'invalid_config'; end;
  perform public.wl_log(p_org, null, null, 'config', null, p - 'secret');
  return jsonb_build_object('saved', true);
end $$;

-- carteira do próprio membro (SOMOS Um): conta autenticada → ficha vinculada → elegibilidade → carteira
create or replace function public.wallet_mine(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; w wallets; c wallet_settings; o organizations; v_eff text; v_mat text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid(); if not found then return jsonb_build_object('state', 'no_person'); end if;
  c := public.wl_cfg(p_org); select * into o from organizations where id = p_org;
  select * into w from wallets where org_id = p_org and person_id = pe.id for update;
  if not found then
    if pe.status = 'pending' then return jsonb_build_object('state', 'pending'); end if;
    if not public.wl_eligible(pe) then return jsonb_build_object('state', 'not_eligible', 'reason', case when pe.classification <> 'member' then 'classification' else 'inactive' end); end if;
    if c.issue_policy = 'auto' then perform public.wl_issue(p_org, pe.id, 'Emissão automática pelo membro', 'issued_self'); select * into w from wallets where org_id = p_org and person_id = pe.id;
    else return jsonb_build_object('state', 'not_issued'); end if;
  end if;
  v_eff := public.wl_effective(w, pe, c); v_mat := (select matricula from person_matricula where org_id = p_org and person_id = pe.id);
  if pe.status = 'pending' then return jsonb_build_object('state', 'pending'); end if;
  if v_eff <> 'active' then return jsonb_build_object('state', v_eff, 'reason', case when pe.classification <> 'member' then 'classification' when pe.status = 'inactive' then 'inactive' else 'admin' end); end if;
  return jsonb_build_object('state', 'active', 'token', public.wl_token(w),
    'card', jsonb_build_object('title', c.title, 'church_name', coalesce(c.church_name, o.name), 'logo_url', case when c.show_logo then o.logo_url end, 'accent', coalesce(c.accent, o.accent_color), 'style', c.style,
      'name', pe.full_name, 'photo_url', case when c.show_photo then pe.photo_url end, 'matricula', case when c.show_matricula then v_mat end, 'issued_at', case when c.show_issue_date then w.issued_at end, 'status', v_eff));
end $$;

-- validação (pública): só nome, foto (se permitido), igreja, matrícula (se a igreja permitir) e situação. Com limite de tentativas.
create or replace function public.wallet_validate(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_hdr jsonb; v_bucket text; v_fail int; v_all int; v_id uuid; w wallets; pe people; c wallet_settings; o organizations; v_res text := 'not_found'; v_eff text; v_out jsonb; v_ok boolean := false; v_tok text := left(coalesce(p_token, ''), 100);
begin
  begin v_hdr := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb); exception when others then v_hdr := '{}'::jsonb; end;
  v_bucket := left(md5(coalesce(v_hdr->>'cf-connecting-ip', v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip', 'unknown') || coalesce(auth.uid()::text, '')), 16);
  select count(*) filter (where not ok), count(*) into v_fail, v_all from wallet_attempts where bucket = v_bucket and at > now() - interval '10 minutes';
  if v_fail >= 10 or v_all >= 120 then raise exception 'rate_limited'; end if;
  if random() < 0.02 then delete from wallet_attempts where at < now() - interval '1 day'; end if;
  if v_tok ~ '^[0-9a-f]{32}\.[0-9a-f]{32}$' then
    v_id := (substr(v_tok, 1, 8) || '-' || substr(v_tok, 9, 4) || '-' || substr(v_tok, 13, 4) || '-' || substr(v_tok, 17, 4) || '-' || substr(v_tok, 21, 12))::uuid;
    select * into w from wallets where id = v_id;
    if found and public.wl_token(w) = v_tok then v_ok := true; end if;
  end if;
  insert into wallet_attempts (bucket, ok) values (v_bucket, v_ok);
  if not v_ok then return jsonb_build_object('result', 'not_found', 'checked_at', now()); end if;
  select * into pe from people where id = w.person_id; select * into c from wallet_settings where org_id = w.org_id; select * into o from organizations where id = w.org_id;
  v_eff := public.wl_effective(w, pe, c); v_res := case v_eff when 'active' then 'valid' when 'suspended' then 'suspended' else 'revoked' end;
  if auth.uid() is not null and public.has_people_perm(w.org_id, 'people_wallet_validate') then perform public.wl_log(w.org_id, w.id, w.person_id, 'validated', null, jsonb_build_object('result', v_res)); end if;
  v_out := jsonb_build_object('result', v_res, 'church', coalesce(c.church_name, o.name), 'checked_at', now(), 'notice', 'Esta validação confirma a situação da carteira no sistema da igreja. Ela não comprova a identidade civil de quem a apresenta.');
  if v_res <> 'revoked' then
    v_out := v_out || jsonb_build_object('name', pe.full_name, 'photo_url', case when c.public_photo and c.show_photo then pe.photo_url end,
      'matricula', case when c.public_matricula then (select matricula from person_matricula where org_id = w.org_id and person_id = w.person_id) end);
  end if;
  return v_out;
end $$;

revoke execute on function public.wallet_issue(uuid, uuid, text), public.wallet_suspend(uuid, text), public.wallet_reactivate(uuid, text), public.wallet_revoke(uuid, text), public.wallet_reissue(uuid, text), public.wallet_renew_token(uuid, text),
  public.wallet_batch(uuid, jsonb), public.wallet_list(uuid, jsonb), public.wallet_get(uuid, uuid), public.wallet_settings_get(uuid), public.wallet_settings_save(uuid, jsonb), public.wallet_mine(uuid), public.wallet_validate(text) from public, anon;
grant execute on function public.wallet_issue(uuid, uuid, text), public.wallet_suspend(uuid, text), public.wallet_reactivate(uuid, text), public.wallet_revoke(uuid, text), public.wallet_reissue(uuid, text), public.wallet_renew_token(uuid, text),
  public.wallet_batch(uuid, jsonb), public.wallet_list(uuid, jsonb), public.wallet_get(uuid, uuid), public.wallet_settings_get(uuid), public.wallet_settings_save(uuid, jsonb), public.wallet_mine(uuid) to authenticated;
grant execute on function public.wallet_validate(text) to anon, authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.wallets') is not null and to_regclass('public.seg_segments') is not null
--      and to_regprocedure('public.wallet_validate(text)') is not null and to_regprocedure('public.segment_preview(uuid,jsonb,integer)') is not null
--      and 'people_wallet_issue' = any (public.all_actions()) as ok;
