-- =====================================================================
-- SOMOS — Expansão, Fase 1: Células, Programações e Escalas
--  * Infraestrutura comum dos novos módulos: permissões por módulo (mod_perm), auditoria única (mod_audit);
--  * Células: cadastro, liderança, participantes com histórico, reuniões e frequência, supervisão configurável, relatórios;
--  * Programações: cadastro, recorrência com exceções, ordem de atividades configurável, histórico;
--  * Escalas gerais (NÃO substituem as do Ministério de Louvor: só leem schedule_assignments para avisar conflito).
--  Tudo é acessado por funções (as tabelas ficam fechadas); permissão e escopo são sempre conferidos no servidor.
--  Participar de célula, escala ou programação nunca concede acesso administrativo.
-- =====================================================================

-- ---------------------------------------------------------------- permissões
create or replace function public.legacy_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit','people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin','people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators','people_contacts_view','people_contacts_assigned','people_contacts_manage','people_contacts_assign','people_contacts_confidential','people_contacts_categories','people_contacts_reopen','people_contacts_cancel','people_contacts_admin','people_reports_dashboard','people_reports_membership','people_reports_demographics','people_reports_family','people_reports_ministry','people_reports_individual','people_reports_export','people_reports_export_lists','people_reports_church','people_reports_own','people_reports_admin','people_segments_view','people_segments_create','people_segments_edit','people_segments_delete','people_groups_view','people_groups_create','people_groups_members','people_segments_functions','people_segments_export','people_segments_use','people_wallet_view','people_wallet_issue','people_wallet_batch','people_wallet_suspend','people_wallet_reactivate','people_wallet_revoke','people_wallet_token','people_wallet_config','people_wallet_validate']::text[]
$$;
create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve']::text[]
$$;
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select public.legacy_actions() || public.module_actions()
$$;
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (actions <@ public.all_actions());

-- permissão por módulo: administrador da igreja, ou concessão explícita. O desenvolvedor NÃO entra por atalho (perfil técnico).
create or replace function public.mod_perm(p_org uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and p_action = any (g.actions)))
$$;
create or replace function public.mod_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
$$;
create or replace function public.mod_person(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where org_id = p_org and user_id = auth.uid() limit 1
$$;
create or replace function public.mod_pname(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(social_name), ''), full_name) from people where id = p_person
$$;

-- auditoria única dos novos módulos (nada de exclusão silenciosa)
create table if not exists public.mod_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  module text not null,
  entity text not null,
  entity_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text check (reason is null or length(reason) <= 300),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mod_audit_entity on public.mod_audit (org_id, module, entity, entity_id, created_at desc);
alter table public.mod_audit enable row level security;
revoke all on public.mod_audit from anon, authenticated;
create or replace function public.mod_log(p_org uuid, p_module text, p_entity text, p_id uuid, p_action text, p_reason text default null, p_detail jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into mod_audit (org_id, module, entity, entity_id, user_id, action, reason, detail) values (p_org, p_module, p_entity, p_id, auth.uid(), p_action, left(p_reason, 300), p_detail)
$$;
create or replace function public.mod_history(p_org uuid, p_module text, p_entity text, p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'reason', a.reason, 'detail', a.detail, 'at', a.created_at,
           'by', (select coalesce(nullif(trim(p.social_name), ''), p.full_name) from people p where p.org_id = p_org and p.user_id = a.user_id limit 1)) order by a.id desc), '[]'::jsonb)
    from (select * from mod_audit where org_id = p_org and module = p_module and entity = p_entity and entity_id = p_id order by id desc limit 200) a
$$;
revoke execute on function public.mod_perm(uuid, text), public.mod_member(uuid), public.mod_person(uuid), public.mod_pname(uuid),
  public.mod_log(uuid, text, text, uuid, text, text, jsonb), public.mod_history(uuid, text, text, uuid) from public, anon;
grant execute on function public.mod_perm(uuid, text), public.mod_member(uuid), public.mod_person(uuid), public.mod_pname(uuid) to authenticated;
revoke execute on function public.mod_log(uuid, text, text, uuid, text, text, jsonb), public.mod_history(uuid, text, text, uuid) from authenticated;

-- ================================================================ CÉLULAS
-- Estrutura de supervisão configurável: cada nó tem título livre ("Supervisor", "Coordenador de área"...) e um nó pai opcional.
create table if not exists public.cell_supervisors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  title text check (title is null or length(title) <= 60),
  parent_id uuid references public.cell_supervisors(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists cell_supervisors_person on public.cell_supervisors (org_id, person_id);
create table if not exists public.cells (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text check (description is null or length(description) <= 600),
  category text check (category is null or length(category) <= 40),
  address text check (address is null or length(address) <= 200),
  meeting_link text check (meeting_link is null or length(meeting_link) <= 300),
  weekday smallint check (weekday between 0 and 6),
  meet_time time,
  frequency text not null default 'weekly' check (frequency in ('weekly','biweekly','monthly','custom')),
  capacity integer check (capacity is null or capacity > 0),
  modality text not null default 'in_person' check (modality in ('in_person','online','hybrid')),
  status text not null default 'active' check (status in ('active','inactive')),
  supervisor_id uuid references public.cell_supervisors(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cells_name on public.cells (org_id, lower(name));
create table if not exists public.cell_members (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  role text not null default 'member' check (role in ('leader','co_leader','host','aux','member')),
  status text not null default 'active' check (status in ('active','left')),
  joined_at date not null default current_date,
  left_at date,
  left_reason text check (left_reason is null or length(left_reason) <= 200),
  transferred_from uuid references public.cells(id) on delete set null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists cell_members_active on public.cell_members (org_id, person_id) where status = 'active';
create index if not exists cell_members_cell on public.cell_members (cell_id, status);
create table if not exists public.cell_meetings (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  meeting_date date not null,
  status text not null default 'held' check (status in ('held','cancelled')),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  responsible_person_id uuid references public.people(id) on delete set null,
  present_count integer not null default 0 check (present_count >= 0),
  visitors_count integer not null default 0 check (visitors_count >= 0),
  members_snapshot integer not null default 0 check (members_snapshot >= 0),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cell_id, meeting_date)
);
create table if not exists public.cell_attendance (
  meeting_id uuid not null references public.cell_meetings(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  present boolean not null default true,
  primary key (meeting_id, person_id)
);
create table if not exists public.cell_visitors (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.cell_meetings(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  person_id uuid references public.people(id) on delete set null
);
alter table public.cell_supervisors enable row level security; alter table public.cells enable row level security; alter table public.cell_members enable row level security;
alter table public.cell_meetings enable row level security; alter table public.cell_attendance enable row level security; alter table public.cell_visitors enable row level security;
revoke all on public.cell_supervisors, public.cells, public.cell_members, public.cell_meetings, public.cell_attendance, public.cell_visitors from anon, authenticated;

-- nós de supervisão do usuário (ele mesmo e todos abaixo)
create or replace function public.cell_my_sup_nodes(p_org uuid) returns table(id uuid)
language sql stable security definer set search_path = public as $$
  with recursive mine as (
    select s.id from cell_supervisors s join people pe on pe.id = s.person_id where s.org_id = p_org and s.active and pe.user_id = auth.uid()
    union
    select c.id from cell_supervisors c join mine m on c.parent_id = m.id where c.active)
  select id from mine
$$;
-- escopo: permissão da igreja toda OU liderança da própria célula OU supervisão da célula. Participar não basta.
create or replace function public.cell_can(p_cell uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c cells;
begin
  if auth.uid() is null then return false; end if;
  select * into c from cells where id = p_cell;
  if c.id is null then return false; end if;
  if public.mod_perm(c.org_id, p_action) then return true; end if;
  if p_action in ('cells_view','cells_members','cells_meetings','cells_reports') then
    if exists (select 1 from cell_members m join people pe on pe.id = m.person_id
                where m.cell_id = p_cell and m.status = 'active' and pe.user_id = auth.uid()
                  and (m.role in ('leader','co_leader') or (m.role = 'aux' and p_action in ('cells_view','cells_meetings')))) then return true; end if;
    if c.supervisor_id is not null and c.supervisor_id in (select id from public.cell_my_sup_nodes(c.org_id)) then return true; end if;
  end if;
  return false;
end $$;
revoke execute on function public.cell_my_sup_nodes(uuid), public.cell_can(uuid, text) from public, anon;
grant execute on function public.cell_can(uuid, text) to authenticated;

create or replace function public.cell_json(p_cell uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'category', c.category, 'address', c.address, 'meeting_link', c.meeting_link,
    'weekday', c.weekday, 'meet_time', c.meet_time, 'frequency', c.frequency, 'capacity', c.capacity, 'modality', c.modality, 'status', c.status,
    'supervisor_id', c.supervisor_id,
    'supervisor_name', (select public.mod_pname(s.person_id) from cell_supervisors s where s.id = c.supervisor_id),
    'leaders', coalesce((select jsonb_agg(jsonb_build_object('person_id', m.person_id, 'name', public.mod_pname(m.person_id), 'role', m.role) order by m.role, public.mod_pname(m.person_id))
                         from cell_members m where m.cell_id = c.id and m.status = 'active' and m.role in ('leader','co_leader')), '[]'::jsonb),
    'members', (select count(*) from cell_members m where m.cell_id = c.id and m.status = 'active'),
    'last_meeting', (select max(meeting_date) from cell_meetings mt where mt.cell_id = c.id and mt.status = 'held'))
  from cells c where c.id = p_cell
$$;
revoke execute on function public.cell_json(uuid) from public, anon, authenticated;

create or replace function public.cell_list(p_org uuid, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(public.cell_json(c.id) order by c.status, lower(c.name))
                     from cells c where c.org_id = p_org and public.cell_can(c.id, 'cells_view')
                      and (p_q is null or trim(p_q) = '' or c.name ilike '%' || trim(p_q) || '%')), '[]'::jsonb);
end $$;

create or replace function public.cell_save(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := trim(coalesce(p->>'name', '')); v_sup uuid := nullif(p->>'supervisor_id', '')::uuid; v_old cells;
begin
  if v_id is null then
    if not public.mod_perm(p_org, 'cells_manage') then raise exception 'forbidden'; end if;
  else
    select * into v_old from cells where id = v_id and org_id = p_org;
    if v_old.id is null then raise exception 'not_found'; end if;
    if not public.cell_can(v_id, 'cells_manage') then raise exception 'forbidden'; end if;
  end if;
  if v_name = '' then raise exception 'name_required'; end if;
  if v_sup is not null and not exists (select 1 from cell_supervisors where id = v_sup and org_id = p_org) then raise exception 'invalid_supervisor'; end if;
  if exists (select 1 from cells where org_id = p_org and lower(name) = lower(v_name) and id is distinct from v_id) then raise exception 'duplicate_name'; end if;
  if v_id is null then
    insert into cells (org_id, name, description, category, address, meeting_link, weekday, meet_time, frequency, capacity, modality, supervisor_id, created_by)
    values (p_org, v_name, nullif(trim(p->>'description'), ''), nullif(trim(p->>'category'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'meeting_link'), ''),
            nullif(p->>'weekday', '')::smallint, nullif(p->>'meet_time', '')::time, coalesce(nullif(p->>'frequency', ''), 'weekly'), nullif(p->>'capacity', '')::int,
            coalesce(nullif(p->>'modality', ''), 'in_person'), v_sup, auth.uid()) returning id into v_id;
    perform public.mod_log(p_org, 'cells', 'cell', v_id, 'create', null, jsonb_build_object('name', v_name));
  else
    if nullif(p->>'capacity', '') is not null and (p->>'capacity')::int < (select count(*) from cell_members where cell_id = v_id and status = 'active') then raise exception 'capacity_below_members'; end if;
    update cells set name = v_name, description = nullif(trim(p->>'description'), ''), category = nullif(trim(p->>'category'), ''), address = nullif(trim(p->>'address'), ''),
      meeting_link = nullif(trim(p->>'meeting_link'), ''), weekday = nullif(p->>'weekday', '')::smallint, meet_time = nullif(p->>'meet_time', '')::time,
      frequency = coalesce(nullif(p->>'frequency', ''), 'weekly'), capacity = nullif(p->>'capacity', '')::int, modality = coalesce(nullif(p->>'modality', ''), 'in_person'),
      supervisor_id = v_sup, updated_at = now() where id = v_id;
    perform public.mod_log(p_org, 'cells', 'cell', v_id, 'edit', null, jsonb_build_object('before', to_jsonb(v_old) - 'created_by', 'name', v_name));
  end if;
  return v_id;
end $$;

create or replace function public.cell_set_status(p_cell uuid, p_active boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c cells;
begin
  select * into c from cells where id = p_cell;
  if c.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(p_cell, 'cells_manage') then raise exception 'forbidden'; end if;
  if not p_active and coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update cells set status = case when p_active then 'active' else 'inactive' end, updated_at = now() where id = p_cell;
  perform public.mod_log(c.org_id, 'cells', 'cell', p_cell, case when p_active then 'activate' else 'deactivate' end, p_reason);
end $$;

-- participantes ---------------------------------------------------------
create or replace function public.cell_member_add(p_cell uuid, p_person uuid, p_role text default 'member') returns uuid
language plpgsql security definer set search_path = public as $$
declare c cells; pe people; v_id uuid;
begin
  select * into c from cells where id = p_cell;
  if c.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(p_cell, 'cells_members') then raise exception 'forbidden'; end if;
  -- só quem tem permissão ampla de gestão nomeia liderança; o líder da célula cuida dos participantes
  if p_role not in ('leader','co_leader','host','aux','member') then raise exception 'invalid_role'; end if;
  if p_role <> 'member' and not public.mod_perm(c.org_id, 'cells_manage') then raise exception 'forbidden'; end if;
  select * into pe from people where id = p_person and org_id = c.org_id;
  if pe.id is null then raise exception 'person_not_found'; end if;
  if pe.status in ('rejected','pending') then raise exception 'person_not_active'; end if;
  if c.status <> 'active' then raise exception 'cell_inactive'; end if;
  if exists (select 1 from cell_members where org_id = c.org_id and person_id = p_person and status = 'active') then raise exception 'already_in_cell'; end if;
  if c.capacity is not null and (select count(*) from cell_members where cell_id = p_cell and status = 'active') >= c.capacity then raise exception 'cell_full'; end if;
  insert into cell_members (cell_id, org_id, person_id, role, added_by) values (p_cell, c.org_id, p_person, p_role, auth.uid()) returning id into v_id;
  perform public.mod_log(c.org_id, 'cells', 'cell', p_cell, 'member_add', null, jsonb_build_object('person_id', p_person, 'name', pe.full_name, 'role', p_role));
  return v_id;
end $$;

create or replace function public.cell_member_set_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare m cell_members;
begin
  select * into m from cell_members where id = p_member and status = 'active';
  if m.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(m.org_id, 'cells_manage') then raise exception 'forbidden'; end if;
  if p_role not in ('leader','co_leader','host','aux','member') then raise exception 'invalid_role'; end if;
  update cell_members set role = p_role where id = p_member;
  perform public.mod_log(m.org_id, 'cells', 'cell', m.cell_id, 'member_role', null, jsonb_build_object('person_id', m.person_id, 'name', public.mod_pname(m.person_id), 'from', m.role, 'to', p_role));
end $$;

create or replace function public.cell_member_remove(p_member uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m cell_members;
begin
  select * into m from cell_members where id = p_member and status = 'active';
  if m.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(m.cell_id, 'cells_members') then raise exception 'forbidden'; end if;
  if m.role <> 'member' and not public.mod_perm(m.org_id, 'cells_manage') then raise exception 'forbidden'; end if;
  update cell_members set status = 'left', left_at = current_date, left_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200) where id = p_member;
  perform public.mod_log(m.org_id, 'cells', 'cell', m.cell_id, 'member_remove', p_reason, jsonb_build_object('person_id', m.person_id, 'name', public.mod_pname(m.person_id)));
end $$;

create or replace function public.cell_transfer(p_person uuid, p_to uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m cell_members; t cells; v_id uuid;
begin
  select * into t from cells where id = p_to;
  if t.id is null then raise exception 'not_found'; end if;
  select * into m from cell_members where person_id = p_person and org_id = t.org_id and status = 'active';
  if m.id is null then raise exception 'no_active_link'; end if;
  if m.cell_id = p_to then raise exception 'same_cell'; end if;
  if m.role <> 'member' then raise exception 'leader_cannot_transfer'; end if;
  -- quem transfere precisa poder gerir participantes nas duas células
  if not (public.cell_can(m.cell_id, 'cells_members') and public.cell_can(p_to, 'cells_members')) then raise exception 'forbidden'; end if;
  if t.status <> 'active' then raise exception 'cell_inactive'; end if;
  if t.capacity is not null and (select count(*) from cell_members where cell_id = p_to and status = 'active') >= t.capacity then raise exception 'cell_full'; end if;
  update cell_members set status = 'left', left_at = current_date, left_reason = left('Transferência' || coalesce(': ' || nullif(trim(p_reason), ''), ''), 200) where id = m.id;
  insert into cell_members (cell_id, org_id, person_id, role, transferred_from, added_by) values (p_to, t.org_id, p_person, 'member', m.cell_id, auth.uid()) returning id into v_id;
  perform public.mod_log(t.org_id, 'cells', 'cell', m.cell_id, 'transfer_out', p_reason, jsonb_build_object('person_id', p_person, 'name', public.mod_pname(p_person), 'to', p_to));
  perform public.mod_log(t.org_id, 'cells', 'cell', p_to, 'transfer_in', p_reason, jsonb_build_object('person_id', p_person, 'name', public.mod_pname(p_person), 'from', m.cell_id));
  return v_id;
end $$;

-- pessoas ativas (membros e frequentadores) sem vínculo ativo com célula: só para quem vê a igreja toda
create or replace function public.cell_unlinked(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mod_perm(p_org, 'cells_view') or public.mod_perm(p_org, 'cells_members')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', pe.id, 'name', coalesce(nullif(trim(pe.social_name), ''), pe.full_name), 'classification', pe.classification) order by lower(pe.full_name))
                     from people pe where pe.org_id = p_org and pe.status = 'active' and pe.classification in ('member','attender')
                      and not exists (select 1 from cell_members m where m.person_id = pe.id and m.status = 'active')), '[]'::jsonb);
end $$;

-- detalhe: célula, participantes ativos, histórico de participação, reuniões recentes, histórico de alterações
create or replace function public.cell_get(p_cell uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c cells;
begin
  select * into c from cells where id = p_cell;
  if c.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(p_cell, 'cells_view') then raise exception 'forbidden'; end if;
  return jsonb_build_object('cell', public.cell_json(p_cell),
    'can', jsonb_build_object('manage', public.cell_can(p_cell, 'cells_manage'), 'members', public.cell_can(p_cell, 'cells_members'), 'meetings', public.cell_can(p_cell, 'cells_meetings'), 'reports', public.cell_can(p_cell, 'cells_reports')),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'person_id', m.person_id, 'name', public.mod_pname(m.person_id), 'role', m.role, 'joined_at', m.joined_at) order by case m.role when 'leader' then 0 when 'co_leader' then 1 when 'host' then 2 when 'aux' then 3 else 4 end, lower(public.mod_pname(m.person_id)))
                           from cell_members m where m.cell_id = p_cell and m.status = 'active'), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'person_id', m.person_id, 'name', public.mod_pname(m.person_id), 'role', m.role, 'joined_at', m.joined_at, 'left_at', m.left_at, 'reason', m.left_reason) order by m.left_at desc nulls last)
                       from cell_members m where m.cell_id = p_cell and m.status = 'left'), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'date', t.meeting_date, 'status', t.status, 'present', t.present_count, 'visitors', t.visitors_count, 'responsible', public.mod_pname(t.responsible_person_id)) order by t.meeting_date desc)
                          from (select * from cell_meetings where cell_id = p_cell order by meeting_date desc limit 60) t), '[]'::jsonb),
    'history', public.mod_history(c.org_id, 'cells', 'cell', p_cell));
end $$;

-- histórico de participação de uma pessoa (todas as células)
create or replace function public.cell_person_history(p_org uuid, p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mod_perm(p_org, 'cells_view') or public.mod_perm(p_org, 'cells_members')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('cell_id', m.cell_id, 'cell', c.name, 'role', m.role, 'status', m.status, 'joined_at', m.joined_at, 'left_at', m.left_at, 'reason', m.left_reason) order by m.joined_at desc, m.created_at desc)
                     from cell_members m join cells c on c.id = m.cell_id where m.org_id = p_org and m.person_id = p_person), '[]'::jsonb);
end $$;

-- reuniões -------------------------------------------------------------
create or replace function public.cell_meeting_save(p_cell uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c cells; v_id uuid := nullif(p->>'id', '')::uuid; v_date date := nullif(p->>'meeting_date', '')::date; v_status text := coalesce(nullif(p->>'status', ''), 'held');
  v_resp uuid := nullif(p->>'responsible_person_id', '')::uuid; v_att jsonb := coalesce(p->'attendance', '[]'::jsonb); v_vis jsonb := coalesce(p->'visitors', '[]'::jsonb);
  v_present int; v_vcount int; v_snap int; r jsonb; v_manual boolean := (p ? 'present_count') and jsonb_array_length(v_att) = 0; v_old cell_meetings;
begin
  select * into c from cells where id = p_cell;
  if c.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(p_cell, 'cells_meetings') then raise exception 'forbidden'; end if;
  if v_date is null then raise exception 'date_required'; end if;
  if v_date > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'future_date'; end if;
  if v_status not in ('held','cancelled') then raise exception 'invalid_status'; end if;
  if v_status = 'cancelled' and coalesce(trim(p->>'cancel_reason'), '') = '' then raise exception 'reason_required'; end if;
  if c.status <> 'active' and v_id is null then raise exception 'cell_inactive'; end if;
  if v_resp is not null and not exists (select 1 from people where id = v_resp and org_id = c.org_id) then raise exception 'person_not_found'; end if;
  if v_id is not null then
    select * into v_old from cell_meetings where id = v_id and cell_id = p_cell;
    if v_old.id is null then raise exception 'not_found'; end if;
  end if;
  if exists (select 1 from cell_meetings where cell_id = p_cell and meeting_date = v_date and id is distinct from v_id) then raise exception 'meeting_exists'; end if;
  -- presenças só de pessoas que fazem ou fizeram parte desta célula
  for r in select * from jsonb_array_elements(v_att) loop
    if not exists (select 1 from cell_members where cell_id = p_cell and person_id = (r->>'person_id')::uuid) then raise exception 'not_a_member'; end if;
  end loop;
  for r in select * from jsonb_array_elements(v_vis) loop
    if length(trim(coalesce(r->>'name', ''))) = 0 then raise exception 'visitor_name_required'; end if;
    if nullif(r->>'person_id', '') is not null and not exists (select 1 from people where id = (r->>'person_id')::uuid and org_id = c.org_id) then raise exception 'person_not_found'; end if;
  end loop;
  v_present := case when v_status = 'cancelled' then 0 when v_manual then greatest(0, (p->>'present_count')::int)
                    else (select count(*) from jsonb_array_elements(v_att) a where coalesce((a->>'present')::boolean, true)) end;
  v_vcount := case when v_status = 'cancelled' then 0 else jsonb_array_length(v_vis) end;
  v_snap := (select count(*) from cell_members where cell_id = p_cell and status = 'active');
  if v_id is null then
    insert into cell_meetings (cell_id, org_id, meeting_date, status, cancel_reason, responsible_person_id, present_count, visitors_count, members_snapshot, notes, created_by)
    values (p_cell, c.org_id, v_date, v_status, nullif(trim(p->>'cancel_reason'), ''), v_resp, v_present, v_vcount, v_snap, nullif(trim(p->>'notes'), ''), auth.uid()) returning id into v_id;
    perform public.mod_log(c.org_id, 'cells', 'cell', p_cell, 'meeting_create', null, jsonb_build_object('meeting', v_id, 'date', v_date, 'status', v_status));
  else
    update cell_meetings set meeting_date = v_date, status = v_status, cancel_reason = nullif(trim(p->>'cancel_reason'), ''), responsible_person_id = v_resp, present_count = v_present,
      visitors_count = v_vcount, notes = nullif(trim(p->>'notes'), ''), updated_at = now() where id = v_id;
    delete from cell_attendance where meeting_id = v_id; delete from cell_visitors where meeting_id = v_id;
    perform public.mod_log(c.org_id, 'cells', 'cell', p_cell, 'meeting_edit', null, jsonb_build_object('meeting', v_id, 'before', jsonb_build_object('date', v_old.meeting_date, 'status', v_old.status, 'present', v_old.present_count, 'visitors', v_old.visitors_count)));
  end if;
  if v_status = 'held' then
    insert into cell_attendance (meeting_id, person_id, present)
      select v_id, (a->>'person_id')::uuid, coalesce((a->>'present')::boolean, true) from jsonb_array_elements(v_att) a
      on conflict (meeting_id, person_id) do update set present = excluded.present;
    insert into cell_visitors (meeting_id, org_id, name, person_id)
      select v_id, c.org_id, left(trim(v->>'name'), 120), nullif(v->>'person_id', '')::uuid from jsonb_array_elements(v_vis) v;
  end if;
  return v_id;
end $$;

create or replace function public.cell_meeting_get(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t cell_meetings;
begin
  select * into t from cell_meetings where id = p_meeting;
  if t.id is null then raise exception 'not_found'; end if;
  if not public.cell_can(t.cell_id, 'cells_view') then raise exception 'forbidden'; end if;
  return jsonb_build_object('id', t.id, 'cell_id', t.cell_id, 'date', t.meeting_date, 'status', t.status, 'cancel_reason', t.cancel_reason, 'responsible_person_id', t.responsible_person_id,
    'responsible', public.mod_pname(t.responsible_person_id), 'present', t.present_count, 'visitors_count', t.visitors_count, 'members_snapshot', t.members_snapshot, 'notes', t.notes,
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id), 'present', a.present) order by lower(public.mod_pname(a.person_id))) from cell_attendance a where a.meeting_id = t.id), '[]'::jsonb),
    'visitors', coalesce((select jsonb_agg(jsonb_build_object('name', v.name, 'person_id', v.person_id)) from cell_visitors v where v.meeting_id = t.id), '[]'::jsonb));
end $$;

-- supervisão -----------------------------------------------------------
create or replace function public.cell_sup_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mod_perm(p_org, 'cells_view') or public.mod_perm(p_org, 'cells_supervision') or public.mod_perm(p_org, 'cells_manage')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'person_id', s.person_id, 'name', public.mod_pname(s.person_id), 'title', s.title, 'parent_id', s.parent_id, 'active', s.active,
           'cells', (select count(*) from cells c where c.supervisor_id = s.id and c.status = 'active')) order by lower(public.mod_pname(s.person_id))) from cell_supervisors s where s.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.cell_sup_save(p_org uuid, p_id uuid, p_person uuid, p_title text, p_parent uuid default null, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_loop uuid;
begin
  if not public.mod_perm(p_org, 'cells_supervision') then raise exception 'forbidden'; end if;
  if not exists (select 1 from people where id = p_person and org_id = p_org) then raise exception 'person_not_found'; end if;
  if p_parent is not null then
    if not exists (select 1 from cell_supervisors where id = p_parent and org_id = p_org) then raise exception 'invalid_parent'; end if;
    if p_parent = p_id then raise exception 'invalid_parent'; end if;
    -- impede ciclos: o pai não pode descender do próprio nó
    if p_id is not null then
      with recursive d as (select id from cell_supervisors where parent_id = p_id union select c.id from cell_supervisors c join d on c.parent_id = d.id)
      select id into v_loop from d where id = p_parent limit 1;
      if v_loop is not null then raise exception 'invalid_parent'; end if;
    end if;
  end if;
  if v_id is null then
    insert into cell_supervisors (org_id, person_id, title, parent_id, active, created_by) values (p_org, p_person, nullif(trim(coalesce(p_title, '')), ''), p_parent, p_active, auth.uid())
    on conflict (org_id, person_id) do update set title = excluded.title, parent_id = excluded.parent_id, active = excluded.active returning id into v_id;
  else
    update cell_supervisors set person_id = p_person, title = nullif(trim(coalesce(p_title, '')), ''), parent_id = p_parent, active = p_active where id = v_id and org_id = p_org;
  end if;
  perform public.mod_log(p_org, 'cells', 'supervisor', v_id, 'save', null, jsonb_build_object('person_id', p_person, 'title', p_title, 'active', p_active));
  return v_id;
end $$;

-- relatórios -----------------------------------------------------------
-- Números apenas descritivos: nada aqui avalia "saúde" de uma célula.
create or replace function public.cell_report(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_scope uuid[]; v_church boolean := public.mod_perm(p_org, 'cells_reports'); v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1830 then raise exception 'invalid_period'; end if;
  select coalesce(array_agg(c.id), '{}') into v_scope from cells c where c.org_id = p_org and public.cell_can(c.id, 'cells_reports');
  if coalesce(array_length(v_scope, 1), 0) = 0 then raise exception 'forbidden'; end if;
  v_res := jsonb_build_object(
    'scope', case when v_church then 'church' else 'own' end,
    'cells_total', (select count(*) from cells where id = any (v_scope)),
    'cells_active', (select count(*) from cells where id = any (v_scope) and status = 'active'),
    'cells_inactive', (select count(*) from cells where id = any (v_scope) and status = 'inactive'),
    'participants', (select count(*) from cell_members where cell_id = any (v_scope) and status = 'active'),
    'unlinked', case when v_church then (select count(*) from people pe where pe.org_id = p_org and pe.status = 'active' and pe.classification in ('member','attender')
                                          and not exists (select 1 from cell_members m where m.person_id = pe.id and m.status = 'active')) end,
    'meetings_held', (select count(*) from cell_meetings where cell_id = any (v_scope) and status = 'held' and meeting_date between p_from and p_to),
    'meetings_cancelled', (select count(*) from cell_meetings where cell_id = any (v_scope) and status = 'cancelled' and meeting_date between p_from and p_to),
    'present_total', (select coalesce(sum(present_count), 0) from cell_meetings where cell_id = any (v_scope) and status = 'held' and meeting_date between p_from and p_to),
    'visitors_total', (select coalesce(sum(visitors_count), 0) from cell_meetings where cell_id = any (v_scope) and status = 'held' and meeting_date between p_from and p_to),
    'attendance_avg', (select round(avg(present_count)::numeric, 1) from cell_meetings where cell_id = any (v_scope) and status = 'held' and meeting_date between p_from and p_to),
    'attendance_rate', (select round(100.0 * sum(present_count) / nullif(sum(members_snapshot), 0), 1) from cell_meetings where cell_id = any (v_scope) and status = 'held' and meeting_date between p_from and p_to),
    'new_members', (select count(*) from cell_members where cell_id = any (v_scope) and joined_at between p_from and p_to and transferred_from is null),
    'without_meetings', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name)) from cells c where c.id = any (v_scope) and c.status = 'active'
        and not exists (select 1 from cell_meetings t where t.cell_id = c.id and t.status = 'held' and t.meeting_date between p_from and p_to)), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'meetings', (select count(*) from cell_meetings t where t.cell_id = any (v_scope) and t.status = 'held' and date_trunc('month', t.meeting_date) = m),
        'present', (select coalesce(sum(present_count), 0) from cell_meetings t where t.cell_id = any (v_scope) and t.status = 'held' and date_trunc('month', t.meeting_date) = m),
        'visitors', (select coalesce(sum(visitors_count), 0) from cell_meetings t where t.cell_id = any (v_scope) and t.status = 'held' and date_trunc('month', t.meeting_date) = m),
        'new_members', (select count(*) from cell_members x where x.cell_id = any (v_scope) and x.transferred_from is null and date_trunc('month', x.joined_at) = m)) order by m)
        from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m), '[]'::jsonb),
    'per_cell', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'members', (select count(*) from cell_members x where x.cell_id = c.id and x.status = 'active'),
        'meetings', (select count(*) from cell_meetings t where t.cell_id = c.id and t.status = 'held' and t.meeting_date between p_from and p_to),
        'avg_present', (select round(avg(present_count)::numeric, 1) from cell_meetings t where t.cell_id = c.id and t.status = 'held' and t.meeting_date between p_from and p_to),
        'visitors', (select coalesce(sum(visitors_count), 0) from cell_meetings t where t.cell_id = c.id and t.status = 'held' and t.meeting_date between p_from and p_to),
        'last_meeting', (select max(meeting_date) from cell_meetings t where t.cell_id = c.id and t.status = 'held')) order by lower(c.name))
        from cells c where c.id = any (v_scope)), '[]'::jsonb),
    'per_supervisor', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', public.mod_pname(s.person_id), 'title', s.title,
        'cells', (select count(*) from cells c where c.supervisor_id = s.id and c.id = any (v_scope) and c.status = 'active'),
        'members', (select count(*) from cell_members x join cells c on c.id = x.cell_id where c.supervisor_id = s.id and c.id = any (v_scope) and x.status = 'active'),
        'meetings', (select count(*) from cell_meetings t join cells c on c.id = t.cell_id where c.supervisor_id = s.id and c.id = any (v_scope) and t.status = 'held' and t.meeting_date between p_from and p_to),
        'avg_present', (select round(avg(t.present_count)::numeric, 1) from cell_meetings t join cells c on c.id = t.cell_id where c.supervisor_id = s.id and c.id = any (v_scope) and t.status = 'held' and t.meeting_date between p_from and p_to),
        'visitors', (select coalesce(sum(t.visitors_count), 0) from cell_meetings t join cells c on c.id = t.cell_id where c.supervisor_id = s.id and c.id = any (v_scope) and t.status = 'held' and t.meeting_date between p_from and p_to),
        'without_meetings', (select count(*) from cells c where c.supervisor_id = s.id and c.id = any (v_scope) and c.status = 'active'
            and not exists (select 1 from cell_meetings t where t.cell_id = c.id and t.status = 'held' and t.meeting_date between p_from and p_to))) order by lower(public.mod_pname(s.person_id)))
        from cell_supervisors s where s.org_id = p_org and s.active and (v_church or exists (select 1 from cells c where c.supervisor_id = s.id and c.id = any (v_scope)))), '[]'::jsonb));
  return v_res;
end $$;

revoke execute on function public.cell_list(uuid, text), public.cell_save(uuid, uuid, jsonb), public.cell_set_status(uuid, boolean, text), public.cell_member_add(uuid, uuid, text),
  public.cell_member_set_role(uuid, text), public.cell_member_remove(uuid, text), public.cell_transfer(uuid, uuid, text), public.cell_unlinked(uuid), public.cell_get(uuid),
  public.cell_person_history(uuid, uuid), public.cell_meeting_save(uuid, jsonb), public.cell_meeting_get(uuid), public.cell_sup_list(uuid), public.cell_sup_save(uuid, uuid, uuid, text, uuid, boolean),
  public.cell_report(uuid, date, date) from public, anon;
grant execute on function public.cell_list(uuid, text), public.cell_save(uuid, uuid, jsonb), public.cell_set_status(uuid, boolean, text), public.cell_member_add(uuid, uuid, text),
  public.cell_member_set_role(uuid, text), public.cell_member_remove(uuid, text), public.cell_transfer(uuid, uuid, text), public.cell_unlinked(uuid), public.cell_get(uuid),
  public.cell_person_history(uuid, uuid), public.cell_meeting_save(uuid, jsonb), public.cell_meeting_get(uuid), public.cell_sup_list(uuid), public.cell_sup_save(uuid, uuid, uuid, text, uuid, boolean),
  public.cell_report(uuid, date, date) to authenticated;

-- ================================================================ PROGRAMAÇÕES
-- Programações da igreja (cultos, reuniões, vigílias...) com recorrência, exceções e ordem de atividades.
-- A agenda simples já existente (church_events) continua como está; esta estrutura a complementa para o que se repete.
create table if not exists public.prog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  category text not null default 'culto' check (category in ('culto','reuniao','estudo','vigilia','oracao','especial','conferencia','institucional')),
  location text check (location is null or length(location) <= 160),
  responsible_person_id uuid references public.people(id) on delete set null,
  visibility text not null default 'members' check (visibility in ('public','members','leaders')),
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  start_date date not null,
  starts_time time not null,
  ends_time time,
  recurrence jsonb not null default '{"freq":"none"}'::jsonb,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_time is null or ends_time > starts_time)
);
create index if not exists prog_items_org on public.prog_items (org_id, status, start_date);
create table if not exists public.prog_exceptions (
  id uuid primary key default gen_random_uuid(),
  prog_id uuid not null references public.prog_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  occ_date date not null,
  kind text not null check (kind in ('cancel','modify')),
  starts_time time, ends_time time,
  location text check (location is null or length(location) <= 160),
  note text check (note is null or length(note) <= 300),
  reason text check (reason is null or length(reason) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null
);
create unique index if not exists prog_exc_active on public.prog_exceptions (prog_id, occ_date) where voided_at is null;
create table if not exists public.prog_agenda_items (
  id uuid primary key default gen_random_uuid(),
  prog_id uuid not null references public.prog_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  occ_date date,                       -- null = ordem padrão da programação; data = ordem só daquela ocorrência
  position integer not null,
  title text not null check (length(trim(title)) between 1 and 120),
  planned_time time,
  duration_min integer check (duration_min is null or duration_min between 0 and 600),
  responsible_person_id uuid references public.people(id) on delete set null,
  notes text check (notes is null or length(notes) <= 500)
);
create index if not exists prog_agenda_prog on public.prog_agenda_items (prog_id, occ_date, position);
alter table public.prog_items enable row level security; alter table public.prog_exceptions enable row level security; alter table public.prog_agenda_items enable row level security;
revoke all on public.prog_items, public.prog_exceptions, public.prog_agenda_items from anon, authenticated;

-- datas em que a programação acontece dentro de um intervalo
create or replace function public.prog_expand(p public.prog_items, p_from date, p_to date) returns table(occ date)
language plpgsql stable set search_path = public as $$
declare f text := coalesce(p.recurrence->>'freq', 'none'); d date; v_until date := nullif(p.recurrence->>'until', '')::date; v_lim date; v_dows int[];
begin
  if p_to - p_from > 400 then raise exception 'range_too_long'; end if;
  if f = 'none' then if p.start_date between p_from and p_to then occ := p.start_date; return next; end if; return; end if;
  if f = 'dates' then
    for d in select x::date from jsonb_array_elements_text(coalesce(p.recurrence->'dates', '[]'::jsonb)) x loop
      if d between p_from and p_to then occ := d; return next; end if;
    end loop; return;
  end if;
  v_lim := least(p_to, coalesce(v_until, p_to));
  if p.start_date > v_lim then return; end if;
  v_dows := array(select jsonb_array_elements_text(coalesce(p.recurrence->'weekdays', '[]'::jsonb))::int);
  for d in select g::date from generate_series(greatest(p.start_date, p_from), v_lim, interval '1 day') g loop
    if f = 'daily'
       or (f = 'weekly' and extract(dow from d) = extract(dow from p.start_date))
       or (f = 'weekdays' and extract(dow from d)::int = any (v_dows))
       or (f = 'biweekly' and (d - p.start_date) % 14 = 0)
       or (f = 'monthly' and (extract(day from d) = extract(day from p.start_date)
            or (extract(day from p.start_date) > extract(day from (date_trunc('month', d) + interval '1 month - 1 day')) and d = (date_trunc('month', d) + interval '1 month - 1 day')::date)))
    then occ := d; return next; end if;
  end loop;
end $$;
revoke execute on function public.prog_expand(public.prog_items, date, date) from public, anon, authenticated;

create or replace function public.prog_leader(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants where org_id = p_org and user_id = auth.uid())
    or exists (select 1 from team_members where org_id = p_org and user_id = auth.uid() and is_leader))
$$;
create or replace function public.prog_mgr(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.mod_perm(p_org, 'prog_view') or public.mod_perm(p_org, 'prog_manage') or public.mod_perm(p_org, 'prog_publish') or public.mod_perm(p_org, 'prog_run') $$;
revoke execute on function public.prog_leader(uuid), public.prog_mgr(uuid) from public, anon;

create or replace function public.prog_occurrences(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mgr boolean; v_member boolean; v_leader boolean; v_guest boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_mgr := public.prog_mgr(p_org);
  v_member := public.mod_member(p_org);
  v_guest := exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'guest');
  if not (v_member or v_guest) then raise exception 'forbidden'; end if;
  v_leader := public.prog_leader(p_org);
  return coalesce((select jsonb_agg(o order by o->>'date', o->>'starts_time') from (
    select jsonb_build_object('prog_id', p.id, 'name', p.name, 'category', p.category, 'date', x.occ,
      'starts_time', coalesce(e.starts_time, p.starts_time), 'ends_time', case when e.starts_time is not null then e.ends_time else coalesce(e.ends_time, p.ends_time) end,
      'location', coalesce(e.location, p.location), 'status', case when e.kind = 'cancel' then 'cancelled' else 'scheduled' end,
      'modified', e.kind = 'modify', 'note', e.note, 'program_status', p.status, 'visibility', p.visibility,
      'responsible', public.mod_pname(p.responsible_person_id), 'description', p.description) as o
    from prog_items p
    cross join lateral public.prog_expand(p, p_from, p_to) x
    left join prog_exceptions e on e.prog_id = p.id and e.occ_date = x.occ and e.voided_at is null
    where p.org_id = p_org
      and (v_mgr or (p.status = 'published' and (p.visibility = 'public' or (p.visibility = 'members' and v_member) or (p.visibility = 'leaders' and v_leader))))) s), '[]'::jsonb);
end $$;

create or replace function public.prog_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.prog_mgr(p_org) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'category', p.category, 'status', p.status, 'visibility', p.visibility, 'start_date', p.start_date,
     'starts_time', p.starts_time, 'ends_time', p.ends_time, 'location', p.location, 'recurrence', p.recurrence, 'responsible', public.mod_pname(p.responsible_person_id))
     order by case p.status when 'published' then 0 when 'draft' then 1 else 2 end, lower(p.name)) from prog_items p where p.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.prog_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p prog_items;
begin
  select * into p from prog_items where id = p_id;
  if p.id is null then raise exception 'not_found'; end if;
  if not public.prog_mgr(p.org_id) then raise exception 'forbidden'; end if;
  return jsonb_build_object('program', to_jsonb(p) - 'created_by' || jsonb_build_object('responsible', public.mod_pname(p.responsible_person_id)),
    'can', jsonb_build_object('manage', public.mod_perm(p.org_id, 'prog_manage'), 'publish', public.mod_perm(p.org_id, 'prog_publish'), 'run', public.mod_perm(p.org_id, 'prog_run') or public.mod_perm(p.org_id, 'prog_manage')),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.occ_date, 'kind', e.kind, 'starts_time', e.starts_time, 'ends_time', e.ends_time, 'location', e.location,
        'note', e.note, 'reason', e.reason, 'voided_at', e.voided_at, 'created_at', e.created_at) order by e.occ_date desc, e.created_at desc) from prog_exceptions e where e.prog_id = p_id), '[]'::jsonb),
    'agenda', public.prog_agenda_json(p_id, null),
    'history', public.mod_history(p.org_id, 'prog', 'program', p_id));
end $$;

create or replace function public.prog_agenda_json(p_id uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', a.position, 'title', a.title, 'planned_time', a.planned_time, 'duration_min', a.duration_min,
      'responsible_person_id', a.responsible_person_id, 'responsible', public.mod_pname(a.responsible_person_id), 'notes', a.notes) order by a.position), '[]'::jsonb)
  from prog_agenda_items a where a.prog_id = p_id and a.occ_date is not distinct from p_date
$$;
revoke execute on function public.prog_agenda_json(uuid, date) from public, anon, authenticated;

create or replace function public.prog_save(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := trim(coalesce(p->>'name', '')); v_rec jsonb := coalesce(p->'recurrence', '{"freq":"none"}'::jsonb); v_f text; v_date date := nullif(p->>'start_date', '')::date;
  v_st time := nullif(p->>'starts_time', '')::time; v_en time := nullif(p->>'ends_time', '')::time; v_resp uuid := nullif(p->>'responsible_person_id', '')::uuid; v_old prog_items; d text; v_dates jsonb;
begin
  if not public.mod_perm(p_org, 'prog_manage') then raise exception 'forbidden'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  v_f := coalesce(v_rec->>'freq', 'none');
  if v_f not in ('none','daily','weekly','biweekly','monthly','weekdays','dates') then raise exception 'invalid_recurrence'; end if;
  if v_f = 'dates' then
    select jsonb_agg(distinct x order by x) into v_dates from jsonb_array_elements_text(coalesce(v_rec->'dates', '[]'::jsonb)) x;
    if v_dates is null then raise exception 'dates_required'; end if;
    for d in select jsonb_array_elements_text(v_dates) loop perform d::date; end loop;
    v_date := (v_dates->>0)::date;
    v_rec := jsonb_build_object('freq', 'dates', 'dates', v_dates);
  else
    if v_date is null then raise exception 'date_required'; end if;
    if v_f = 'weekdays' and jsonb_array_length(coalesce(v_rec->'weekdays', '[]'::jsonb)) = 0 then raise exception 'weekdays_required'; end if;
    v_rec := jsonb_strip_nulls(jsonb_build_object('freq', v_f, 'weekdays', case when v_f = 'weekdays' then v_rec->'weekdays' end, 'until', nullif(v_rec->>'until', '')));
    if v_rec ? 'until' and (v_rec->>'until')::date < v_date then raise exception 'invalid_until'; end if;
  end if;
  if v_st is null then raise exception 'time_required'; end if;
  if v_en is not null and v_en <= v_st then raise exception 'invalid_time'; end if;
  if v_resp is not null and not exists (select 1 from people where id = v_resp and org_id = p_org) then raise exception 'person_not_found'; end if;
  if v_id is null then
    insert into prog_items (org_id, name, description, category, location, responsible_person_id, visibility, start_date, starts_time, ends_time, recurrence, notes, created_by)
    values (p_org, v_name, nullif(trim(p->>'description'), ''), coalesce(nullif(p->>'category', ''), 'culto'), nullif(trim(p->>'location'), ''), v_resp, coalesce(nullif(p->>'visibility', ''), 'members'),
            v_date, v_st, v_en, v_rec, nullif(trim(p->>'notes'), ''), auth.uid()) returning id into v_id;
    perform public.mod_log(p_org, 'prog', 'program', v_id, 'create', null, jsonb_build_object('name', v_name));
  else
    select * into v_old from prog_items where id = v_id and org_id = p_org;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status = 'cancelled' then raise exception 'program_cancelled'; end if;
    update prog_items set name = v_name, description = nullif(trim(p->>'description'), ''), category = coalesce(nullif(p->>'category', ''), 'culto'), location = nullif(trim(p->>'location'), ''),
      responsible_person_id = v_resp, visibility = coalesce(nullif(p->>'visibility', ''), 'members'), start_date = v_date, starts_time = v_st, ends_time = v_en, recurrence = v_rec,
      notes = nullif(trim(p->>'notes'), ''), updated_at = now() where id = v_id;
    perform public.mod_log(p_org, 'prog', 'program', v_id, 'edit', null, jsonb_build_object('before', to_jsonb(v_old) - 'created_by' - 'description' - 'notes'));
  end if;
  return v_id;
end $$;

create or replace function public.prog_set_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p prog_items;
begin
  select * into p from prog_items where id = p_id;
  if p.id is null then raise exception 'not_found'; end if;
  if p_status not in ('draft','published','cancelled') then raise exception 'invalid_status'; end if;
  if not (public.mod_perm(p.org_id, 'prog_publish') or (p_status = 'cancelled' and public.mod_perm(p.org_id, 'prog_manage'))) then raise exception 'forbidden'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if p.status = 'cancelled' and p_status = 'published' then raise exception 'program_cancelled'; end if;
  update prog_items set status = p_status, updated_at = now() where id = p_id;
  perform public.mod_log(p.org_id, 'prog', 'program', p_id, case p_status when 'published' then 'publish' when 'draft' then 'unpublish' else 'cancel' end, p_reason, jsonb_build_object('from', p.status));
end $$;

create or replace function public.prog_exception_set(p_id uuid, p_date date, p_kind text, p jsonb default '{}'::jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr prog_items; v_id uuid; v_st time := nullif(p->>'starts_time', '')::time; v_en time := nullif(p->>'ends_time', '')::time;
begin
  select * into pr from prog_items where id = p_id;
  if pr.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(pr.org_id, 'prog_manage') then raise exception 'forbidden'; end if;
  if p_kind not in ('cancel','modify') then raise exception 'invalid_kind'; end if;
  if not exists (select 1 from public.prog_expand(pr, p_date, p_date)) then raise exception 'not_an_occurrence'; end if;
  if p_kind = 'cancel' and coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if v_en is not null and v_st is not null and v_en <= v_st then raise exception 'invalid_time'; end if;
  update prog_exceptions set voided_at = now(), voided_by = auth.uid() where prog_id = p_id and occ_date = p_date and voided_at is null;
  insert into prog_exceptions (prog_id, org_id, occ_date, kind, starts_time, ends_time, location, note, reason, created_by)
  values (p_id, pr.org_id, p_date, p_kind, v_st, v_en, nullif(trim(p->>'location'), ''), nullif(left(trim(coalesce(p->>'note', '')), 300), ''), left(p_reason, 300), auth.uid()) returning id into v_id;
  perform public.mod_log(pr.org_id, 'prog', 'program', p_id, 'exception_' || p_kind, p_reason, jsonb_build_object('date', p_date));
  return v_id;
end $$;
create or replace function public.prog_exception_clear(p_id uuid, p_date date, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr prog_items;
begin
  select * into pr from prog_items where id = p_id;
  if pr.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(pr.org_id, 'prog_manage') then raise exception 'forbidden'; end if;
  update prog_exceptions set voided_at = now(), voided_by = auth.uid() where prog_id = p_id and occ_date = p_date and voided_at is null;
  perform public.mod_log(pr.org_id, 'prog', 'program', p_id, 'exception_clear', p_reason, jsonb_build_object('date', p_date));
end $$;

-- ordem de atividades: configurável, sem formato fixo; cada alteração guarda o estado anterior
create or replace function public.prog_agenda_save(p_id uuid, p_date date, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pr prog_items; r jsonb; i int := 0; v_before jsonb;
begin
  select * into pr from prog_items where id = p_id;
  if pr.id is null then raise exception 'not_found'; end if;
  if not (public.mod_perm(pr.org_id, 'prog_run') or public.mod_perm(pr.org_id, 'prog_manage')) then raise exception 'forbidden'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 60 then raise exception 'invalid_items'; end if;
  if p_date is not null and not exists (select 1 from public.prog_expand(pr, p_date, p_date)) then raise exception 'not_an_occurrence'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if length(trim(coalesce(r->>'title', ''))) = 0 then raise exception 'title_required'; end if;
    if nullif(r->>'responsible_person_id', '') is not null and not exists (select 1 from people where id = (r->>'responsible_person_id')::uuid and org_id = pr.org_id) then raise exception 'person_not_found'; end if;
  end loop;
  v_before := public.prog_agenda_json(p_id, p_date);
  delete from prog_agenda_items where prog_id = p_id and occ_date is not distinct from p_date;
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    i := i + 1;
    insert into prog_agenda_items (prog_id, org_id, occ_date, position, title, planned_time, duration_min, responsible_person_id, notes)
    values (p_id, pr.org_id, p_date, i, left(trim(r->>'title'), 120), nullif(r->>'planned_time', '')::time, nullif(r->>'duration_min', '')::int,
            nullif(r->>'responsible_person_id', '')::uuid, nullif(left(trim(coalesce(r->>'notes', '')), 500), ''));
  end loop;
  perform public.mod_log(pr.org_id, 'prog', 'program', p_id, 'agenda_save', null, jsonb_build_object('date', p_date, 'before', v_before, 'count', i));
end $$;

-- ordem de uma ocorrência: a da data, se existir; senão a padrão. Quem está escalado nela também enxerga.
create or replace function public.prog_agenda_get(p_id uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr prog_items; v_own jsonb; v_ok boolean;
begin
  select * into pr from prog_items where id = p_id;
  if pr.id is null then raise exception 'not_found'; end if;
  v_ok := public.prog_mgr(pr.org_id) or exists (select 1 from rosters r join roster_assignments a on a.roster_id = r.id join people pe on pe.id = a.person_id
          where r.prog_id = p_id and r.status not in ('draft','cancelled') and a.status in ('invited','confirmed','sub_requested') and pe.user_id = auth.uid() and (p_date is null or r.occ_date = p_date));
  if not v_ok then raise exception 'forbidden'; end if;
  v_own := public.prog_agenda_json(p_id, p_date);
  return jsonb_build_object('date', p_date, 'specific', p_date is not null and jsonb_array_length(v_own) > 0, 'items', case when p_date is not null and jsonb_array_length(v_own) > 0 then v_own else public.prog_agenda_json(p_id, null) end);
end $$;

revoke execute on function public.prog_occurrences(uuid, date, date), public.prog_list(uuid), public.prog_get(uuid), public.prog_save(uuid, uuid, jsonb), public.prog_set_status(uuid, text, text),
  public.prog_exception_set(uuid, date, text, jsonb, text), public.prog_exception_clear(uuid, date, text), public.prog_agenda_save(uuid, date, jsonb), public.prog_agenda_get(uuid, date) from public, anon;
grant execute on function public.prog_occurrences(uuid, date, date), public.prog_list(uuid), public.prog_get(uuid), public.prog_save(uuid, uuid, jsonb), public.prog_set_status(uuid, text, text),
  public.prog_exception_set(uuid, date, text, jsonb, text), public.prog_exception_clear(uuid, date, text), public.prog_agenda_save(uuid, date, jsonb), public.prog_agenda_get(uuid, date) to authenticated;

-- ================================================================ ESCALAS GERAIS
-- Não tocam nas escalas do Ministério de Louvor (schedules/schedule_assignments): estas só são LIDAS para avisar conflito de horário.
create table if not exists public.rosters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  prog_id uuid references public.prog_items(id) on delete set null,
  occ_date date,
  title text not null check (length(trim(title)) between 1 and 120),
  activity text check (activity is null or length(activity) <= 80),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','awaiting','confirmed','partial','completed','cancelled')),
  notes text check (notes is null or length(notes) <= 1000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists rosters_org on public.rosters (org_id, starts_at);
create table if not exists public.roster_assignments (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  function_label text check (function_label is null or length(function_label) <= 60),
  status text not null default 'invited' check (status in ('invited','confirmed','declined','sub_requested','replaced','removed')),
  responded_at timestamptz,
  reason text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists roster_assign_active on public.roster_assignments (roster_id, person_id) where status not in ('replaced','removed');
create index if not exists roster_assign_person on public.roster_assignments (person_id, status);
create table if not exists public.roster_subs (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters(id) on delete cascade,
  assignment_id uuid not null references public.roster_assignments(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  substitute_person_id uuid references public.people(id) on delete set null,
  reason text check (reason is null or length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  created_at timestamptz not null default now()
);
alter table public.rosters enable row level security; alter table public.roster_assignments enable row level security; alter table public.roster_subs enable row level security;
revoke all on public.rosters, public.roster_assignments, public.roster_subs from anon, authenticated;

create or replace function public.roster_mgr(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.mod_perm(p_org, 'roster_view') or public.mod_perm(p_org, 'roster_manage') or public.mod_perm(p_org, 'roster_approve') $$;
create or replace function public.roster_recalc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rosters; n int; c int;
begin
  select * into r from rosters where id = p_id;
  if r.id is null or r.status in ('draft','completed','cancelled') then return; end if;
  select count(*) filter (where status in ('invited','confirmed','declined','sub_requested')), count(*) filter (where status = 'confirmed') into n, c from roster_assignments where roster_id = p_id;
  update rosters set status = case when n = 0 then 'published' when c = n then 'confirmed' when c > 0 then 'partial' else 'awaiting' end, updated_at = now() where id = p_id;
end $$;
create or replace function public.roster_notify(p_assignment uuid, p_kind text, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare a roster_assignments; r rosters; v_user uuid;
begin
  select * into a from roster_assignments where id = p_assignment; select * into r from rosters where id = a.roster_id;
  select user_id into v_user from people where id = a.person_id;
  if v_user is not null then
    perform public.notify_user(v_user, r.org_id, p_kind, p_title, r.title || ' · ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || coalesce(' · ' || a.function_label, ''), '#/minhas-escalas', jsonb_build_object('roster', r.id));
  end if;
end $$;
revoke execute on function public.roster_mgr(uuid), public.roster_recalc(uuid), public.roster_notify(uuid, text, text) from public, anon, authenticated;

-- conflitos: duas escalas no mesmo horário, indisponibilidade informada e escala do Louvor (somente leitura)
create or replace function public.roster_conflicts(p_org uuid, p_starts timestamptz, p_ends timestamptz, p_persons uuid[], p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e timestamptz := coalesce(p_ends, p_starts + interval '2 hours');
begin
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id), 'kind', 'overlap', 'detail', r.title || ' · ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')) x
      from roster_assignments a join rosters r on r.id = a.roster_id
     where a.org_id = p_org and a.person_id = any (p_persons) and a.status in ('invited','confirmed','sub_requested') and r.status in ('published','awaiting','partial','confirmed')
       and r.id is distinct from p_exclude and r.starts_at < e and coalesce(r.ends_at, r.starts_at + interval '2 hours') > p_starts
    union all
    select jsonb_build_object('person_id', pe.id, 'name', public.mod_pname(pe.id), 'kind', 'unavailable', 'detail', coalesce(nullif(u.note, ''), 'Indisponível no período'))
      from unavailability u join people pe on pe.user_id = u.user_id and pe.org_id = u.org_id
     where u.org_id = p_org and pe.id = any (p_persons)
       and ((u.start_date + coalesce(u.start_time, time '00:00'))::timestamp at time zone 'America/Sao_Paulo') < e
       and ((u.end_date + coalesce(u.end_time, time '23:59:59'))::timestamp at time zone 'America/Sao_Paulo') > p_starts
    union all
    select jsonb_build_object('person_id', pe.id, 'name', public.mod_pname(pe.id), 'kind', 'louvor', 'detail', 'Escala do Louvor: ' || s.title)
      from schedule_assignments sa join schedules s on s.id = sa.schedule_id join people pe on pe.user_id = sa.user_id and pe.org_id = s.org_id
     where s.org_id = p_org and pe.id = any (p_persons) and s.status = 'published' and s.starts_at < e and coalesce(s.ends_at, s.starts_at + interval '3 hours') > p_starts) q), '[]'::jsonb);
end $$;
revoke execute on function public.roster_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid) from public, anon, authenticated;

create or replace function public.roster_check(p_org uuid, p_starts timestamptz, p_ends timestamptz, p_persons uuid[], p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mod_perm(p_org, 'roster_manage') then raise exception 'forbidden'; end if;
  return public.roster_conflicts(p_org, p_starts, p_ends, p_persons, p_exclude);
end $$;

create or replace function public.roster_save(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_title text := trim(coalesce(p->>'title', '')); v_st timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_en timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_prog uuid := nullif(p->>'prog_id', '')::uuid; r jsonb; v_old rosters; v_assign jsonb := coalesce(p->'assignments', '[]'::jsonb); v_keep uuid[] := '{}'; v_pid uuid; v_aid uuid; a roster_assignments;
begin
  if not public.mod_perm(p_org, 'roster_manage') then raise exception 'forbidden'; end if;
  if v_title = '' then raise exception 'name_required'; end if;
  if v_st is null then raise exception 'date_required'; end if;
  if v_en is not null and v_en <= v_st then raise exception 'invalid_time'; end if;
  if v_prog is not null and not exists (select 1 from prog_items where id = v_prog and org_id = p_org) then raise exception 'invalid_program'; end if;
  if jsonb_typeof(v_assign) <> 'array' or jsonb_array_length(v_assign) > 100 then raise exception 'invalid_items'; end if;
  for r in select * from jsonb_array_elements(v_assign) loop
    v_pid := (r->>'person_id')::uuid;
    if not exists (select 1 from people where id = v_pid and org_id = p_org and status = 'active') then raise exception 'person_not_active'; end if;
    if v_pid = any (v_keep) then raise exception 'duplicate_person'; end if;
    v_keep := array_append(v_keep, v_pid);
  end loop;
  if v_id is null then
    insert into rosters (org_id, prog_id, occ_date, title, activity, starts_at, ends_at, notes, created_by)
    values (p_org, v_prog, nullif(p->>'occ_date', '')::date, v_title, nullif(trim(p->>'activity'), ''), v_st, v_en, nullif(trim(p->>'notes'), ''), auth.uid()) returning id into v_id;
    perform public.mod_log(p_org, 'roster', 'roster', v_id, 'create', null, jsonb_build_object('title', v_title));
  else
    select * into v_old from rosters where id = v_id and org_id = p_org;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status in ('completed','cancelled') then raise exception 'roster_closed'; end if;
    update rosters set prog_id = v_prog, occ_date = nullif(p->>'occ_date', '')::date, title = v_title, activity = nullif(trim(p->>'activity'), ''), starts_at = v_st, ends_at = v_en,
      notes = nullif(trim(p->>'notes'), ''), updated_at = now() where id = v_id;
    perform public.mod_log(p_org, 'roster', 'roster', v_id, 'edit', null, jsonb_build_object('before', jsonb_build_object('title', v_old.title, 'starts_at', v_old.starts_at, 'ends_at', v_old.ends_at)));
  end if;
  -- sincroniza pessoas: quem saiu fica registrado como removido; quem entrou só é avisado se a escala já foi publicada
  for a in select * from roster_assignments where roster_id = v_id and status not in ('replaced','removed') and not (person_id = any (v_keep)) loop
    update roster_assignments set status = 'removed', responded_at = now() where id = a.id;
    perform public.mod_log(p_org, 'roster', 'roster', v_id, 'person_removed', null, jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id)));
    if (select status from rosters where id = v_id) <> 'draft' then perform public.roster_notify(a.id, 'roster_removed', 'Você saiu de uma escala'); end if;
  end loop;
  for r in select * from jsonb_array_elements(v_assign) loop
    v_pid := (r->>'person_id')::uuid;
    select id into v_aid from roster_assignments where roster_id = v_id and person_id = v_pid and status not in ('replaced','removed');
    if v_aid is null then
      insert into roster_assignments (roster_id, org_id, person_id, function_label) values (v_id, p_org, v_pid, nullif(left(trim(coalesce(r->>'function', '')), 60), '')) returning id into v_aid;
      perform public.mod_log(p_org, 'roster', 'roster', v_id, 'person_added', null, jsonb_build_object('person_id', v_pid, 'name', public.mod_pname(v_pid), 'function', r->>'function'));
      if (select status from rosters where id = v_id) <> 'draft' then perform public.roster_notify(v_aid, 'roster_invite', 'Você foi escalado'); end if;
    else
      update roster_assignments set function_label = nullif(left(trim(coalesce(r->>'function', '')), 60), '') where id = v_aid;
    end if;
  end loop;
  perform public.roster_recalc(v_id);
  return v_id;
end $$;

create or replace function public.roster_publish(p_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rosters; v_persons uuid[]; v_conf jsonb; a roster_assignments;
begin
  select * into r from rosters where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(r.org_id, 'roster_manage') then raise exception 'forbidden'; end if;
  if r.status <> 'draft' then raise exception 'not_draft'; end if;
  select array_agg(person_id) into v_persons from roster_assignments where roster_id = p_id and status not in ('replaced','removed');
  if v_persons is null then raise exception 'no_people'; end if;
  v_conf := public.roster_conflicts(r.org_id, r.starts_at, r.ends_at, v_persons, p_id);
  if jsonb_array_length(v_conf) > 0 and not coalesce(p_force, false) then return jsonb_build_object('ok', false, 'conflicts', v_conf); end if;
  update rosters set status = 'published', published_at = now(), updated_at = now() where id = p_id;
  for a in select * from roster_assignments where roster_id = p_id and status = 'invited' loop perform public.roster_notify(a.id, 'roster_invite', 'Você foi escalado'); end loop;
  perform public.roster_recalc(p_id);
  perform public.mod_log(r.org_id, 'roster', 'roster', p_id, 'publish', null, jsonb_build_object('forced', coalesce(p_force, false) and jsonb_array_length(v_conf) > 0, 'conflicts', v_conf));
  return jsonb_build_object('ok', true, 'conflicts', v_conf);
end $$;

create or replace function public.roster_respond(p_assignment uuid, p_answer text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a roster_assignments; r rosters; pe people;
begin
  select * into a from roster_assignments where id = p_assignment;
  if a.id is null then raise exception 'not_found'; end if;
  select * into pe from people where id = a.person_id;
  if pe.user_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  select * into r from rosters where id = a.roster_id;
  if r.status not in ('published','awaiting','partial','confirmed') then raise exception 'roster_closed'; end if;
  if a.status not in ('invited','confirmed','declined') then raise exception 'cannot_respond'; end if;
  if p_answer not in ('confirm','decline') then raise exception 'invalid_answer'; end if;
  update roster_assignments set status = case p_answer when 'confirm' then 'confirmed' else 'declined' end, responded_at = now(), reason = left(nullif(trim(coalesce(p_reason, '')), ''), 300) where id = p_assignment;
  perform public.roster_recalc(r.id);
  perform public.mod_log(r.org_id, 'roster', 'roster', r.id, case p_answer when 'confirm' then 'confirmed' else 'declined' end, p_reason, jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id)));
  if r.created_by is not null and r.created_by <> auth.uid() then
    perform public.notify_user(r.created_by, r.org_id, 'roster_response', public.mod_pname(a.person_id) || case p_answer when 'confirm' then ' confirmou presença' else ' recusou a escala' end,
      r.title || ' · ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#/escalas', jsonb_build_object('roster', r.id));
  end if;
end $$;

create or replace function public.roster_sub_request(p_assignment uuid, p_substitute uuid default null, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a roster_assignments; r rosters; pe people; v_id uuid;
begin
  select * into a from roster_assignments where id = p_assignment;
  if a.id is null then raise exception 'not_found'; end if;
  select * into pe from people where id = a.person_id;
  if pe.user_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  select * into r from rosters where id = a.roster_id;
  if r.status not in ('published','awaiting','partial','confirmed') then raise exception 'roster_closed'; end if;
  if a.status not in ('invited','confirmed') then raise exception 'cannot_respond'; end if;
  if p_substitute is not null and (p_substitute = a.person_id or not exists (select 1 from people where id = p_substitute and org_id = r.org_id and status = 'active')) then raise exception 'invalid_substitute'; end if;
  update roster_assignments set status = 'sub_requested', responded_at = now(), reason = left(nullif(trim(coalesce(p_reason, '')), ''), 300) where id = p_assignment;
  insert into roster_subs (roster_id, assignment_id, org_id, requested_by, substitute_person_id, reason) values (r.id, a.id, r.org_id, auth.uid(), p_substitute, left(nullif(trim(coalesce(p_reason, '')), ''), 300)) returning id into v_id;
  perform public.roster_recalc(r.id);
  perform public.mod_log(r.org_id, 'roster', 'roster', r.id, 'sub_requested', p_reason, jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id), 'substitute', p_substitute));
  if r.created_by is not null then
    perform public.notify_user(r.created_by, r.org_id, 'roster_sub', public.mod_pname(a.person_id) || ' pediu substituição', r.title || ' · ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#/escalas', jsonb_build_object('roster', r.id));
  end if;
  return v_id;
end $$;

create or replace function public.roster_sub_decide(p_sub uuid, p_approve boolean, p_substitute uuid default null, p_note text default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s roster_subs; a roster_assignments; r rosters; v_sub uuid; v_conf jsonb; v_new uuid;
begin
  select * into s from roster_subs where id = p_sub;
  if s.id is null then raise exception 'not_found'; end if;
  if not (public.mod_perm(s.org_id, 'roster_approve') or public.mod_perm(s.org_id, 'roster_manage')) then raise exception 'forbidden'; end if;
  if s.status <> 'pending' then raise exception 'already_decided'; end if;
  select * into a from roster_assignments where id = s.assignment_id; select * into r from rosters where id = s.roster_id;
  if r.status in ('completed','cancelled') then raise exception 'roster_closed'; end if;
  if p_approve then
    v_sub := coalesce(p_substitute, s.substitute_person_id);
    if v_sub is null then raise exception 'substitute_required'; end if;
    if v_sub = a.person_id or not exists (select 1 from people where id = v_sub and org_id = r.org_id and status = 'active') then raise exception 'invalid_substitute'; end if;
    if exists (select 1 from roster_assignments where roster_id = r.id and person_id = v_sub and status not in ('replaced','removed')) then raise exception 'duplicate_person'; end if;
    v_conf := public.roster_conflicts(r.org_id, r.starts_at, r.ends_at, array[v_sub], r.id);
    if jsonb_array_length(v_conf) > 0 and not coalesce(p_force, false) then return jsonb_build_object('ok', false, 'conflicts', v_conf); end if;
    update roster_assignments set status = 'replaced' where id = a.id;
    insert into roster_assignments (roster_id, org_id, person_id, function_label) values (r.id, r.org_id, v_sub, a.function_label) returning id into v_new;
    update roster_subs set status = 'approved', substitute_person_id = v_sub, decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 300) where id = p_sub;
    perform public.roster_notify(v_new, 'roster_invite', 'Você foi escalado');
  else
    update roster_subs set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 300) where id = p_sub;
    update roster_assignments set status = 'invited', responded_at = null where id = a.id;
    perform public.roster_notify(a.id, 'roster_sub_denied', 'Substituição não aprovada');
  end if;
  perform public.roster_recalc(r.id);
  perform public.mod_log(r.org_id, 'roster', 'roster', r.id, case when p_approve then 'sub_approved' else 'sub_rejected' end, p_note, jsonb_build_object('person_id', a.person_id, 'name', public.mod_pname(a.person_id), 'substitute', v_sub));
  return jsonb_build_object('ok', true, 'conflicts', coalesce(v_conf, '[]'::jsonb));
end $$;

create or replace function public.roster_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r rosters; a roster_assignments;
begin
  select * into r from rosters where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(r.org_id, 'roster_manage') then raise exception 'forbidden'; end if;
  if r.status in ('completed','cancelled') then raise exception 'roster_closed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update rosters set status = 'cancelled', cancel_reason = left(trim(p_reason), 300), updated_at = now() where id = p_id;
  if r.status <> 'draft' then for a in select * from roster_assignments where roster_id = p_id and status in ('invited','confirmed','sub_requested') loop perform public.roster_notify(a.id, 'roster_cancelled', 'Escala cancelada'); end loop; end if;
  perform public.mod_log(r.org_id, 'roster', 'roster', p_id, 'cancel', p_reason);
end $$;
create or replace function public.roster_complete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rosters;
begin
  select * into r from rosters where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.mod_perm(r.org_id, 'roster_manage') then raise exception 'forbidden'; end if;
  if r.status not in ('published','awaiting','partial','confirmed') then raise exception 'roster_closed'; end if;
  if r.starts_at > now() then raise exception 'not_started'; end if;
  update rosters set status = 'completed', updated_at = now() where id = p_id;
  perform public.mod_log(r.org_id, 'roster', 'roster', p_id, 'complete');
end $$;

create or replace function public.roster_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'activity', r.activity, 'prog_id', r.prog_id, 'occ_date', r.occ_date, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'status', r.status, 'notes', r.notes,
    'cancel_reason', r.cancel_reason, 'total', (select count(*) from roster_assignments a where a.roster_id = r.id and a.status in ('invited','confirmed','declined','sub_requested')),
    'confirmed', (select count(*) from roster_assignments a where a.roster_id = r.id and a.status = 'confirmed'),
    'declined', (select count(*) from roster_assignments a where a.roster_id = r.id and a.status = 'declined'))
  from rosters r where r.id = p_id
$$;
revoke execute on function public.roster_json(uuid) from public, anon, authenticated;

create or replace function public.roster_list(p_org uuid, p_from date, p_to date, p_mine boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mgr boolean; v_me uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_to - p_from > 400 then raise exception 'range_too_long'; end if;
  v_mgr := public.roster_mgr(p_org) and not coalesce(p_mine, false);
  v_me := public.mod_person(p_org);
  return coalesce((select jsonb_agg(public.roster_json(r.id) || jsonb_build_object('mine', (select a.id from roster_assignments a where a.roster_id = r.id and a.person_id = v_me and a.status in ('invited','confirmed','declined','sub_requested') limit 1),
      'my_status', (select a.status from roster_assignments a where a.roster_id = r.id and a.person_id = v_me and a.status in ('invited','confirmed','declined','sub_requested') limit 1),
      'my_function', (select a.function_label from roster_assignments a where a.roster_id = r.id and a.person_id = v_me and a.status in ('invited','confirmed','declined','sub_requested') limit 1)) order by r.starts_at)
      from rosters r where r.org_id = p_org and (r.starts_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (v_mgr or (r.status <> 'draft' and exists (select 1 from roster_assignments a where a.roster_id = r.id and a.person_id = v_me and a.status in ('invited','confirmed','declined','sub_requested'))))), '[]'::jsonb);
end $$;

create or replace function public.roster_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r rosters; v_mgr boolean; v_me uuid; v_mine boolean;
begin
  select * into r from rosters where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  v_mgr := public.roster_mgr(r.org_id); v_me := public.mod_person(r.org_id);
  v_mine := r.status <> 'draft' and exists (select 1 from roster_assignments a where a.roster_id = p_id and a.person_id = v_me and a.status in ('invited','confirmed','declined','sub_requested'));
  if not (v_mgr or v_mine) then raise exception 'forbidden'; end if;
  return jsonb_build_object('roster', public.roster_json(p_id),
    'can', jsonb_build_object('manage', public.mod_perm(r.org_id, 'roster_manage'), 'approve', public.mod_perm(r.org_id, 'roster_approve') or public.mod_perm(r.org_id, 'roster_manage')),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'person_id', a.person_id, 'name', public.mod_pname(a.person_id), 'function', a.function_label, 'status', a.status, 'responded_at', a.responded_at,
        'reason', case when v_mgr or a.person_id = v_me then a.reason end, 'mine', a.person_id = v_me) order by lower(public.mod_pname(a.person_id)))
        from roster_assignments a where a.roster_id = p_id and a.status not in ('replaced','removed') and (v_mgr or r.status <> 'draft')), '[]'::jsonb),
    'subs', case when v_mgr then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'assignment_id', s.assignment_id, 'person', public.mod_pname(a.person_id), 'substitute_person_id', s.substitute_person_id, 'substitute', public.mod_pname(s.substitute_person_id),
        'reason', s.reason, 'status', s.status, 'note', s.decision_note, 'created_at', s.created_at) order by s.created_at desc) from roster_subs s join roster_assignments a on a.id = s.assignment_id where s.roster_id = p_id), '[]'::jsonb) end,
    'conflicts', case when v_mgr and r.status in ('draft','published','awaiting','partial','confirmed')
        then public.roster_conflicts(r.org_id, r.starts_at, r.ends_at, array(select person_id from roster_assignments where roster_id = p_id and status not in ('replaced','removed')), p_id) end,
    'history', case when v_mgr then public.mod_history(r.org_id, 'roster', 'roster', p_id) end);
end $$;

revoke execute on function public.roster_check(uuid, timestamptz, timestamptz, uuid[], uuid), public.roster_save(uuid, uuid, jsonb), public.roster_publish(uuid, boolean), public.roster_respond(uuid, text, text),
  public.roster_sub_request(uuid, uuid, text), public.roster_sub_decide(uuid, boolean, uuid, text, boolean), public.roster_cancel(uuid, text), public.roster_complete(uuid),
  public.roster_list(uuid, date, date, boolean), public.roster_get(uuid) from public, anon;
grant execute on function public.roster_check(uuid, timestamptz, timestamptz, uuid[], uuid), public.roster_save(uuid, uuid, jsonb), public.roster_publish(uuid, boolean), public.roster_respond(uuid, text, text),
  public.roster_sub_request(uuid, uuid, text), public.roster_sub_decide(uuid, boolean, uuid, text, boolean), public.roster_cancel(uuid, text), public.roster_complete(uuid),
  public.roster_list(uuid, date, date, boolean), public.roster_get(uuid) to authenticated;


-- ---------------------------------------------------------------- o que o usuário pode fazer nos novos módulos (a interface esconde o resto; o servidor confere de novo em cada função)
create or replace function public.my_modules(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_acts text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_acts := case when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then public.module_actions()
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a where g.org_id = p_org and g.user_id = auth.uid() and a = any (public.module_actions())), '{}'::text[]) end;
  return jsonb_build_object('actions', to_jsonb(v_acts),
    'cell_scope', exists (select 1 from cell_members m join people pe on pe.id = m.person_id where m.org_id = p_org and m.status = 'active' and pe.user_id = auth.uid() and m.role in ('leader','co_leader','aux'))
                  or exists (select 1 from public.cell_my_sup_nodes(p_org)));
end $$;
-- busca de pessoas para montar células, escalas e programações: só nome e classificação, só para quem trabalha nesses módulos, mínimo de 2 letras
create or replace function public.mod_people_search(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := public.my_modules(p_org); q text := trim(coalesce(p_q, ''));
begin
  if jsonb_array_length(v->'actions') = 0 and not (v->>'cell_scope')::boolean then raise exception 'forbidden'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.n, 'classification', x.classification) order by lower(x.n))
    from (select pe.id, coalesce(nullif(trim(pe.social_name), ''), pe.full_name) n, pe.classification from people pe
           where pe.org_id = p_org and pe.status = 'active' and (pe.full_name ilike '%' || q || '%' or pe.social_name ilike '%' || q || '%') order by pe.full_name limit 20) x), '[]'::jsonb);
end $$;
revoke execute on function public.my_modules(uuid), public.mod_people_search(uuid, text) from public, anon;
grant execute on function public.my_modules(uuid), public.mod_people_search(uuid, text) to authenticated;

-- ---------------------------------------------------------------- verificação (rode depois de aplicar; deve retornar true)
--   select to_regclass('public.cells') is not null and to_regclass('public.prog_items') is not null and to_regclass('public.rosters') is not null
--      and to_regprocedure('public.cell_report(uuid,date,date)') is not null and to_regprocedure('public.roster_publish(uuid,boolean)') is not null
--      and 'cells_manage' = any (public.all_actions()) and 'people_wallet_issue' = any (public.all_actions()) as ok;
-- REVERSÃO: drop table public.roster_subs, public.roster_assignments, public.rosters, public.prog_agenda_items, public.prog_exceptions, public.prog_items,
--   public.cell_visitors, public.cell_attendance, public.cell_meetings, public.cell_members, public.cells, public.cell_supervisors cascade; (as funções cell_/prog_/roster_ podem ser removidas em seguida)
