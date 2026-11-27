-- =====================================================================
-- SOMOS  Fase 6A: Gestao de Multiplas Igrejas (Administracao Institucional)
--  * Cada igreja/unidade JA e uma organizacao isolada (todas as tabelas tem org_id e RLS). Nada e movido nem apagado:
--    a igreja atual continua como esta e passa a poder ser agrupada em uma estrutura configuravel.
--  * Estrutura sem hierarquia fixa: cada unidade tem um "pai" opcional e um nome de tipo livre
--    (Organizacao principal, Regional, Igreja, Congregacao, Unidade ou o que a denominacao usar). Maximo de 8 niveis abaixo da raiz.
--  * Vincular uma igreja existente a um pai exige o consentimento dos dois lados (administrador da igreja + quem estrutura o pai).
--  * Acesso global so por concessao explicita (org_scope_grants) ou por ser administrador do no. Desenvolvedor NAO tem acesso implicito.
--  * O consolidado devolve so numeros agregados (sem nomes de pessoas). Indicadores financeiros exigem concessao propria e ficam auditados.
--  * Quem tem acesso a um no NAO ganha acesso aos dados internos das unidades abaixo: pessoas, financeiro etc. continuam isolados por RLS.
-- =====================================================================

alter table public.organizations add column if not exists parent_id uuid references public.organizations(id) on delete set null;
alter table public.organizations add column if not exists unit_kind text check (unit_kind is null or length(unit_kind) between 1 and 40);
create index if not exists organizations_parent on public.organizations (parent_id) where parent_id is not null;

-- ---------------------------------------------------------------- concessoes de escopo (acesso regional/global)
create table if not exists public.org_scope_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level text check (level is null or length(level) <= 60),
  actions text[] not null check (cardinality(actions) between 1 and 3 and actions <@ array['structure','consolidated','consolidated_fin']),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table public.org_scope_grants enable row level security;
revoke all on public.org_scope_grants from anon, authenticated;

-- ---------------------------------------------------------------- arvore
-- nos abaixo de p_org (inclui o proprio, depth 0)
create or replace function public.org_subtree(p_org uuid) returns table (id uuid, parent_id uuid, depth int)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select o.id, o.parent_id, 0 as depth from organizations o where o.id = p_org
    union all
    select c.id, c.parent_id, t.depth + 1 from organizations c join t on c.parent_id = t.id where t.depth < 8)
  select t.id, t.parent_id, t.depth from t
$$;
-- p_org e todos os pais acima dele
create or replace function public.org_ancestors(p_org uuid) returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with recursive a as (
    select o.id, o.parent_id, 0 as n from organizations o where o.id = p_org
    union all
    select p.id, p.parent_id, a.n + 1 from organizations p join a on p.id = a.parent_id where a.n < 8)
  select a.id from a
$$;
revoke execute on function public.org_subtree(uuid), public.org_ancestors(uuid) from public, anon, authenticated;

-- so mexe em parent_id quem passa pelas funcoes abaixo (que conferem consentimento, ciclo e profundidade)
create or replace function public.org_parent_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0; v_h int;
begin
  if tg_op = 'INSERT' and new.parent_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then return new; end if;
  if coalesce(current_setting('somos.org_tree', true), '') <> 'on' and auth.uid() is not null then raise exception 'org_parent_locked'; end if;
  v_id := new.parent_id;
  while v_id is not null loop
    if v_id = new.id then raise exception 'org_cycle'; end if;
    v_n := v_n + 1; if v_n > 8 then raise exception 'org_too_deep'; end if;
    select o.parent_id into v_id from organizations o where o.id = v_id;
  end loop;
  -- a unidade que esta entrando leva consigo as filhas: a altura delas tambem conta (maximo de 8 niveis abaixo da raiz)
  select coalesce(max(depth), 0) into v_h from public.org_subtree(new.id);
  if tg_op = 'UPDATE' and new.parent_id is not null and (v_n + v_h) > 8 then raise exception 'org_too_deep'; end if;
  return new;
end $$;
drop trigger if exists org_parent_guard_trg on public.organizations;
create trigger org_parent_guard_trg before insert or update of parent_id on public.organizations for each row execute function public.org_parent_guard();

-- administrador (papel) da propria unidade  o desenvolvedor nao entra aqui
create or replace function public.inst_is_admin(p_org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
$$;
-- 'structure' | 'consolidated' | 'consolidated_fin' sobre p_org: administrador do no ou de um pai (structure/consolidated), ou concessao no no ou em um pai
create or replace function public.org_scope_has(p_org uuid, p_action text) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.org_ancestors(p_org) a
    where (p_action in ('structure', 'consolidated') and exists (select 1 from org_members m where m.org_id = a.id and m.user_id = auth.uid() and m.role = 'admin'))
       or exists (select 1 from org_scope_grants g where g.org_id = a.id and g.user_id = auth.uid() and p_action = any (g.actions)))
$$;
revoke execute on function public.inst_is_admin(uuid), public.org_scope_has(uuid, text) from public, anon;
grant execute on function public.inst_is_admin(uuid), public.org_scope_has(uuid, text) to authenticated;

-- o que a pessoa pode fazer na Administracao Institucional a partir da igreja atual
create or replace function public.inst_access(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('admin', public.inst_is_admin(p_org), 'structure', public.org_scope_has(p_org, 'structure'),
    'consolidated', public.org_scope_has(p_org, 'consolidated'), 'fin', public.org_scope_has(p_org, 'consolidated_fin'),
    'has_parent', exists (select 1 from organizations where id = p_org and parent_id is not null),
    'has_children', exists (select 1 from organizations where parent_id = p_org));
end $$;

-- ---------------------------------------------------------------- estrutura
create or replace function public.org_tree(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.org_scope_has(p_org, 'structure') or public.org_scope_has(p_org, 'consolidated')) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'org_id', p_org,
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.unit_kind) from organizations o join organizations p on p.id = o.parent_id where o.id = p_org
                 and (public.inst_is_admin(p.id) or public.org_scope_has(p.id, 'structure'))),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.unit_kind, 'parent_id', t.parent_id, 'depth', t.depth,
        'i_admin', public.inst_is_admin(o.id), 'members', (select count(*) from org_members m where m.org_id = o.id)) order by t.depth, o.name)
      from public.org_subtree(p_org) t join organizations o on o.id = t.id), '[]'::jsonb));
end $$;

create or replace function public.org_unit_create(p_parent uuid, p_name text, p_kind text default null, p_accent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p_name, '')); v_kind text := nullif(trim(coalesce(p_kind, '')), ''); v_id uuid; v_depth int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.org_scope_has(p_parent, 'structure') then raise exception 'forbidden'; end if;
  if length(v_name) not between 2 and 80 then raise exception 'org_need_name'; end if;
  if v_kind is not null and length(v_kind) > 40 then raise exception 'org_kind_long'; end if;
  select max(n) into v_depth from (select count(*) n from public.org_ancestors(p_parent)) x;
  if v_depth > 8 then raise exception 'org_too_deep'; end if;
  v_id := public.create_organization(v_name, coalesce(nullif(p_accent, ''), '#1EA7FF'), null);
  perform set_config('somos.org_tree', 'on', true);
  update organizations set parent_id = p_parent, unit_kind = v_kind where id = v_id;
  perform set_config('somos.org_tree', 'off', true);
  perform public.mod_log(p_parent, 'institucional', 'unit', v_id, 'create', null, jsonb_build_object('name', v_name, 'kind', v_kind));
  perform public.mod_log(v_id, 'institucional', 'unit', v_id, 'create', null, jsonb_build_object('parent', p_parent));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- vincular uma igreja que ja existe: precisa ser administrador dela E ter 'structure' no pai
create or replace function public.org_unit_link(p_child uuid, p_parent uuid, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_kind text := nullif(trim(coalesce(p_kind, '')), '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_child = p_parent then raise exception 'org_cycle'; end if;
  if not (public.inst_is_admin(p_child) and public.org_scope_has(p_parent, 'structure')) then raise exception 'forbidden'; end if;
  if exists (select 1 from organizations where id = p_child and parent_id is not null) then raise exception 'org_has_parent'; end if;
  if v_kind is not null and length(v_kind) > 40 then raise exception 'org_kind_long'; end if;
  perform set_config('somos.org_tree', 'on', true);
  update organizations set parent_id = p_parent, unit_kind = coalesce(v_kind, unit_kind) where id = p_child;
  perform set_config('somos.org_tree', 'off', true);
  perform public.mod_log(p_parent, 'institucional', 'unit', p_child, 'link', null, null);
  perform public.mod_log(p_child, 'institucional', 'unit', p_child, 'link', null, jsonb_build_object('parent', p_parent));
  return jsonb_build_object('ok', true);
end $$;

-- convite: quem estrutura o pai gera um codigo de uso unico (7 dias); o administrador da igreja que quer entrar o aceita.
-- O codigo so aparece uma vez (guardamos apenas o hash).
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  parent_org_id uuid not null references public.organizations(id) on delete cascade,
  code_hash text not null unique,
  unit_kind text check (unit_kind is null or length(unit_kind) between 1 and 40),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by_org uuid references public.organizations(id) on delete set null
);
alter table public.org_invites enable row level security;
revoke all on public.org_invites from anon, authenticated;

create or replace function public.org_invite_create(p_parent uuid, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; v_kind text := nullif(trim(coalesce(p_kind, '')), '');
begin
  if not public.org_scope_has(p_parent, 'structure') then raise exception 'forbidden'; end if;
  if v_kind is not null and length(v_kind) > 40 then raise exception 'org_kind_long'; end if;
  v_code := 'IGR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into org_invites (parent_org_id, code_hash, unit_kind, created_by) values (p_parent, encode(sha256(convert_to(v_code, 'utf8')), 'hex'), v_kind, auth.uid());
  perform public.mod_log(p_parent, 'institucional', 'invite', null, 'create', null, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_in_days', 7);
end $$;
create or replace function public.org_invite_list(p_parent uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_scope_has(p_parent, 'structure') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'unit_kind', i.unit_kind, 'created_at', i.created_at, 'expires_at', i.expires_at,
      'state', case when i.used_at is not null then 'used' when i.expires_at < now() then 'expired' else 'open' end, 'used_by', o.name) order by i.created_at desc)
    from (select * from org_invites where parent_org_id = p_parent order by created_at desc limit 30) i left join organizations o on o.id = i.used_by_org), '[]'::jsonb);
end $$;
create or replace function public.org_invite_revoke(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v org_invites;
begin
  select * into v from org_invites where id = p_id; if v.id is null then raise exception 'not_found'; end if;
  if not public.org_scope_has(v.parent_org_id, 'structure') then raise exception 'forbidden'; end if;
  delete from org_invites where id = p_id and used_at is null;
  perform public.mod_log(v.parent_org_id, 'institucional', 'invite', p_id, 'revoke', null, null);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.org_invite_accept(p_child uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v org_invites;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.inst_is_admin(p_child) then raise exception 'forbidden'; end if;
  select * into v from org_invites where code_hash = encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'utf8')), 'hex') and used_at is null and expires_at >= now();
  if v.id is null then raise exception 'org_invite_invalid'; end if;
  -- quem criou o convite ainda precisa poder estruturar o pai
  if not exists (select 1 from public.org_ancestors(v.parent_org_id) a where
       exists (select 1 from org_members m where m.org_id = a.id and m.user_id = v.created_by and m.role = 'admin')
       or exists (select 1 from org_scope_grants g where g.org_id = a.id and g.user_id = v.created_by and 'structure' = any (g.actions))) then raise exception 'org_invite_invalid'; end if;
  if v.parent_org_id = p_child then raise exception 'org_cycle'; end if;
  if exists (select 1 from organizations where id = p_child and parent_id is not null) then raise exception 'org_has_parent'; end if;
  perform set_config('somos.org_tree', 'on', true);
  update organizations set parent_id = v.parent_org_id, unit_kind = coalesce(v.unit_kind, unit_kind) where id = p_child;
  perform set_config('somos.org_tree', 'off', true);
  update org_invites set used_at = now(), used_by_org = p_child where id = v.id;
  perform public.mod_log(v.parent_org_id, 'institucional', 'unit', p_child, 'link', null, null);
  perform public.mod_log(p_child, 'institucional', 'unit', p_child, 'link', null, jsonb_build_object('parent', v.parent_org_id));
  return jsonb_build_object('ok', true, 'parent_id', v.parent_org_id);
end $$;

-- desvincular nao apaga nem move nada: so tira a unidade da estrutura. Pode o administrador da unidade ou quem estrutura o pai.
create or replace function public.org_unit_unlink(p_child uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_parent uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select parent_id into v_parent from organizations where id = p_child;
  if v_parent is null then raise exception 'not_found'; end if;
  if not (public.inst_is_admin(p_child) or public.org_scope_has(v_parent, 'structure')) then raise exception 'forbidden'; end if;
  perform set_config('somos.org_tree', 'on', true);
  update organizations set parent_id = null where id = p_child;
  perform set_config('somos.org_tree', 'off', true);
  perform public.mod_log(v_parent, 'institucional', 'unit', p_child, 'unlink', null, null);
  perform public.mod_log(p_child, 'institucional', 'unit', p_child, 'unlink', null, jsonb_build_object('parent', v_parent));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.org_unit_set_kind(p_org uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_kind text := nullif(trim(coalesce(p_kind, '')), '');
begin
  if not public.org_scope_has(p_org, 'structure') then raise exception 'forbidden'; end if;
  if v_kind is not null and length(v_kind) > 40 then raise exception 'org_kind_long'; end if;
  update organizations set unit_kind = v_kind where id = p_org;
  perform public.mod_log(p_org, 'institucional', 'unit', p_org, 'kind', null, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- concessoes (so administrador do no concede; ninguem repassa)
create or replace function public.org_scope_list(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.inst_is_admin(p_org) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'user_id', g.user_id, 'name', coalesce(m.display_name, 'Sem nome'), 'level', g.level, 'actions', g.actions, 'created_at', g.created_at) order by g.created_at)
    from org_scope_grants g left join org_members m on m.org_id = g.org_id and m.user_id = g.user_id where g.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.org_scope_set(p_org uuid, p_user uuid, p_level text, p_actions text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_level text := nullif(trim(coalesce(p_level, '')), ''); v_id uuid;
begin
  if not public.inst_is_admin(p_org) then raise exception 'forbidden'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = p_user) then raise exception 'org_member_required'; end if;
  if p_actions is null or cardinality(p_actions) = 0 or not (p_actions <@ array['structure','consolidated','consolidated_fin']) then raise exception 'org_invalid_actions'; end if;
  if v_level is not null and length(v_level) > 60 then raise exception 'org_kind_long'; end if;
  insert into org_scope_grants (org_id, user_id, level, actions, created_by) values (p_org, p_user, v_level, p_actions, auth.uid())
    on conflict (org_id, user_id) do update set level = excluded.level, actions = excluded.actions returning id into v_id;
  perform public.mod_log(p_org, 'institucional', 'scope', v_id, 'grant', null, jsonb_build_object('user', p_user, 'actions', p_actions, 'level', v_level));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.org_scope_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g org_scope_grants;
begin
  select * into g from org_scope_grants where id = p_id; if g.id is null then raise exception 'not_found'; end if;
  if not public.inst_is_admin(g.org_id) then raise exception 'forbidden'; end if;
  delete from org_scope_grants where id = p_id;
  perform public.mod_log(g.org_id, 'institucional', 'scope', p_id, 'revoke', null, jsonb_build_object('user', g.user_id, 'actions', g.actions));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- consolidado (somente numeros)
create or replace function public.org_consolidated(p_org uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fin boolean; v_from date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date; v_units jsonb;
begin
  if not public.org_scope_has(p_org, 'consolidated') then raise exception 'forbidden'; end if;
  v_fin := public.org_scope_has(p_org, 'consolidated_fin');
  select coalesce(jsonb_agg(u order by (u->>'depth')::int, u->>'name'), '[]'::jsonb) into v_units from (
    select jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.unit_kind, 'depth', t.depth, 'parent_id', t.parent_id,
      'people', (select count(*) from people x where x.org_id = o.id and x.status = 'active'),
      'members', (select count(*) from people x where x.org_id = o.id and x.status = 'active' and x.classification = 'member'),
      'cells', (select count(*) from cells c where c.org_id = o.id and c.status = 'active'),
      'events_upcoming', (select count(*) from ev_events e where e.org_id = o.id and e.status = 'published' and e.starts_at >= now()),
      'events_30d', (select count(*) from ev_events e where e.org_id = o.id and e.status in ('published', 'finished') and e.starts_at between now() - interval '30 days' and now()),
      'programs', (select count(*) from prog_items p where p.org_id = o.id and p.status = 'published'),
      'rosters_upcoming', (select count(*) from schedules s where s.org_id = o.id and s.status not in ('draft', 'cancelled') and s.starts_at >= now()),
      'users', (select count(*) from org_members m where m.org_id = o.id),
      'fin', case when v_fin then jsonb_build_object(
          'income', coalesce((select sum(f.amount) from fin_entries f where f.org_id = o.id and f.kind = 'income' and f.status = 'settled' and f.paid_at >= v_from), 0),
          'expense', coalesce((select sum(f.amount) from fin_entries f where f.org_id = o.id and f.kind = 'expense' and f.status = 'settled' and f.paid_at >= v_from), 0),
          'open_expense', coalesce((select sum(f.amount) from fin_entries f where f.org_id = o.id and f.kind = 'expense' and f.status = 'open'), 0)) else null end) u
    from public.org_subtree(p_org) t join organizations o on o.id = t.id) q;
  if v_fin then perform public.mod_log(p_org, 'institucional', 'consolidated', p_org, 'view_fin', null, null); end if;
  return jsonb_build_object('org_id', p_org, 'fin_allowed', v_fin, 'month_from', v_from, 'generated_at', now(), 'units', v_units,
    'totals', (select jsonb_build_object('units', jsonb_array_length(v_units),
        'people', coalesce(sum((x->>'people')::int), 0), 'members', coalesce(sum((x->>'members')::int), 0), 'cells', coalesce(sum((x->>'cells')::int), 0),
        'events_upcoming', coalesce(sum((x->>'events_upcoming')::int), 0), 'events_30d', coalesce(sum((x->>'events_30d')::int), 0), 'programs', coalesce(sum((x->>'programs')::int), 0),
        'rosters_upcoming', coalesce(sum((x->>'rosters_upcoming')::int), 0), 'users', coalesce(sum((x->>'users')::int), 0),
        'income', case when v_fin then coalesce(sum((x#>>'{fin,income}')::numeric), 0) end, 'expense', case when v_fin then coalesce(sum((x#>>'{fin,expense}')::numeric), 0) end)
      from jsonb_array_elements(v_units) x));
end $$;

-- historico das mudancas de estrutura e de acesso (quem ve: quem estrutura a unidade)
create or replace function public.org_inst_history(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.org_scope_has(p_org, 'structure') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'entity', a.entity, 'action', a.action, 'detail', a.detail) order by a.created_at desc)
    from (select * from mod_audit where org_id = p_org and module = 'institucional' order by created_at desc limit 100) a), '[]'::jsonb);
end $$;

revoke execute on function public.inst_access(uuid), public.org_tree(uuid), public.org_unit_create(uuid, text, text, text), public.org_unit_link(uuid, uuid, text), public.org_unit_unlink(uuid),
  public.org_unit_set_kind(uuid, text), public.org_scope_list(uuid), public.org_scope_set(uuid, uuid, text, text[]), public.org_scope_remove(uuid), public.org_consolidated(uuid), public.org_inst_history(uuid),
  public.org_invite_create(uuid, text), public.org_invite_list(uuid), public.org_invite_revoke(uuid), public.org_invite_accept(uuid, text) from public, anon;
grant execute on function public.inst_access(uuid), public.org_tree(uuid), public.org_unit_create(uuid, text, text, text), public.org_unit_link(uuid, uuid, text), public.org_unit_unlink(uuid),
  public.org_unit_set_kind(uuid, text), public.org_scope_list(uuid), public.org_scope_set(uuid, uuid, text, text[]), public.org_scope_remove(uuid), public.org_consolidated(uuid), public.org_inst_history(uuid),
  public.org_invite_create(uuid, text), public.org_invite_list(uuid), public.org_invite_revoke(uuid), public.org_invite_accept(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Para desfazer: dropar as funcoes org_*/inst_*, o gatilho org_parent_guard_trg, as tabelas org_scope_grants e org_invites e as colunas parent_id/unit_kind
-- (as igrejas e todos os seus dados permanecem; so a estrutura e perdida).
-- ---------------------------------------------------------------------
-- Verificacao (deve retornar true):
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'parent_id')
   and to_regclass('public.org_scope_grants') is not null
   and exists (select 1 from pg_trigger where tgname = 'org_parent_guard_trg')
   and (select count(*) from public.organizations where parent_id is not null) >= 0 as multiplas_igrejas_ok;
