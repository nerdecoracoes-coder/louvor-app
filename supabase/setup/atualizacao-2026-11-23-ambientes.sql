-- =====================================================================
-- Ambientes, redes de supervisão, funções e permissões (23/11/2026)
--  SOMOS Um (comunidade) · SOMOS Servos (times) · SOMOS Chamados (liderança)
--  * 100% aditivo: nada é apagado, renomeado ou recriado; o Louvor e os demais times seguem como estão.
--  * Vínculos de time continuam em team_members (is_leader = líder do ministério) e org_members (admin/member/guest).
--  * Novo: redes (grupos de times sob um pastor supervisor), concessões de função com ações permitidas
--    (supervisor de rede e liderança geral) e o perfil de desenvolvedor valendo no SERVIDOR.
--  * As funções de permissão já usadas pelas políticas de acesso (RLS) passam a reconhecer esses papéis.
-- =====================================================================

-- ---------------------------------------------------------------- desenvolvedor (servidor)
-- profiles.is_developer só pode ser ligado pelo SQL Editor (gatilho profiles_guard_developer).
create or replace function public.is_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_developer from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.is_developer() from public, anon;
grant execute on function public.is_developer() to authenticated;

-- ---------------------------------------------------------------- redes e concessões
create table if not exists public.church_networks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists church_networks_org_name on public.church_networks (org_id, lower(name));

create table if not exists public.network_teams (
  network_id uuid not null references public.church_networks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (network_id, team_id)
);
create index if not exists network_teams_team on public.network_teams (team_id);

-- Quem exerce qual função, em qual área e com quais ações:
--   network_supervisor = pastor/supervisor de uma rede   (network_id obrigatório)
--   general_leader     = liderança geral da igreja       (sem rede; o título é livre: Pastor presidente, Bispo...)
create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null check (role_key in ('network_supervisor','general_leader')),
  network_id uuid references public.church_networks(id) on delete cascade,
  title text check (title is null or length(trim(title)) between 1 and 60),
  actions text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((role_key = 'network_supervisor' and network_id is not null) or (role_key = 'general_leader' and network_id is null)),
  check (actions <@ array['view','create','edit','delete','approve','manage','administer']::text[])
);
create unique index if not exists access_grants_supervisor on public.access_grants (org_id, user_id, network_id) where role_key = 'network_supervisor';
create unique index if not exists access_grants_general on public.access_grants (org_id, user_id) where role_key = 'general_leader';
create index if not exists access_grants_user on public.access_grants (user_id);

-- ---------------------------------------------------------------- matriz de ações por função
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer']::text[]
$$;
create or replace function public.role_actions(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'team_member'        then array['view']
    when 'team_leader'        then array['view','create','edit','delete','approve','manage']
    when 'network_supervisor' then array['view','approve','manage']
    when 'general_leader'     then array['view','create','edit','approve','manage','administer']
    else '{}' end::text[]
$$;

-- concessão cobre o time? (só por rede/liderança geral; não conta administrador, líder nem integrante)
create or replace function public.grant_covers_team(p_team uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from access_grants g join teams t on t.org_id = g.org_id and t.id = p_team
    where g.user_id = auth.uid() and p_action = any(g.actions)
      and (g.role_key = 'general_leader'
           or (g.role_key = 'network_supervisor' and exists (select 1 from network_teams nt where nt.network_id = g.network_id and nt.team_id = t.id))))
$$;

-- permissão de uma ação sobre um time: desenvolvedor, administrador, líder, integrante (só ver) ou concessão
create or replace function public.has_perm(p_team uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from teams where id = p_team;
  if v_org is null then return false; end if;
  if public.is_developer() then return true; end if;
  if exists (select 1 from org_members where org_id = v_org and user_id = auth.uid() and role = 'admin') then return true; end if;
  if exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and is_leader)
     and p_action = any (public.role_actions('team_leader')) then return true; end if;
  if p_action = 'view' and exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
       and (access_until is null or access_until >= (now() at time zone 'America/Sao_Paulo')::date)) then return true; end if;
  return public.grant_covers_team(p_team, p_action);
end $$;

-- permissão no nível da igreja (rede, liderança, configurações)
create or replace function public.has_org_perm(p_org uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_developer()
      or exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or exists (select 1 from access_grants where org_id = p_org and user_id = auth.uid() and role_key = 'general_leader' and p_action = any(actions))
$$;
revoke execute on function public.grant_covers_team(uuid, text), public.has_perm(uuid, text), public.has_org_perm(uuid, text) from public, anon;
grant execute on function public.grant_covers_team(uuid, text), public.has_perm(uuid, text), public.has_org_perm(uuid, text) to authenticated;

-- ---------------------------------------------------------------- funções de permissão existentes (mesmo comportamento + novos papéis)
create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or public.is_developer()
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
      or public.is_developer()
      or exists (select 1 from access_grants where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.in_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
      or public.is_developer()
$$;

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
                 and (access_until is null or access_until >= (now() at time zone 'America/Sao_Paulo')::date))
      or public.is_developer()
      or public.grant_covers_team(p_team, 'view')
$$;

create or replace function public.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams t
    where t.id = p_team
      and (exists (select 1 from org_members m where m.org_id = t.org_id and m.user_id = auth.uid() and m.role = 'admin')
           or exists (select 1 from team_members tm where tm.team_id = t.id and tm.user_id = auth.uid() and tm.is_leader)))
   or public.is_developer() or public.grant_covers_team(p_team, 'manage')
$$;

create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
      and (a.access_until is null or a.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
  or public.is_developer()
  or exists (select 1 from team_members b where b.user_id = p_user and public.grant_covers_team(b.team_id, 'view'))
$$;

-- ---------------------------------------------------------------- políticas das tabelas novas
alter table public.church_networks enable row level security;
alter table public.network_teams  enable row level security;
alter table public.access_grants  enable row level security;
revoke all on public.church_networks, public.network_teams, public.access_grants from anon;
revoke insert, update, delete on public.church_networks, public.network_teams, public.access_grants from authenticated;   -- escrita só pelas funções abaixo

drop policy if exists networks_select on public.church_networks;
create policy networks_select on public.church_networks for select to authenticated using (public.is_org_member(org_id));
drop policy if exists network_teams_select on public.network_teams;
create policy network_teams_select on public.network_teams for select to authenticated using (public.is_org_member(org_id));
drop policy if exists grants_select on public.access_grants;
create policy grants_select on public.access_grants for select to authenticated
  using (user_id = auth.uid() or public.has_org_perm(org_id, 'administer'));

-- ---------------------------------------------------------------- gestão (somente servidor decide)
-- ações que o chamador pode repassar: administrador/desenvolvedor = todas; liderança geral = as suas
create or replace function public.caller_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when public.is_developer() or exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin') then public.all_actions()
    else coalesce((select actions from access_grants where org_id = p_org and user_id = auth.uid() and role_key = 'general_leader'), '{}'::text[]) end
$$;

create or replace function public.network_save(p_org uuid, p_id uuid, p_name text, p_teams uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not public.has_org_perm(p_org, 'administer') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if exists (select 1 from unnest(coalesce(p_teams, '{}')) t where not exists (select 1 from teams where id = t and org_id = p_org)) then raise exception 'invalid_team'; end if;
  if v_id is null then
    insert into church_networks (org_id, name, sort) values (p_org, trim(p_name), coalesce((select max(sort) + 1 from church_networks where org_id = p_org), 0)) returning id into v_id;
  else
    update church_networks set name = trim(p_name) where id = v_id and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
  end if;
  delete from network_teams where network_id = v_id and not (team_id = any (coalesce(p_teams, '{}')));
  insert into network_teams (network_id, team_id, org_id) select v_id, t, p_org from unnest(coalesce(p_teams, '{}')) t on conflict do nothing;
  return v_id;
end $$;

create or replace function public.network_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from church_networks where id = p_id;
  if v_org is null then return; end if;
  if not public.has_org_perm(v_org, 'administer') then raise exception 'forbidden'; end if;
  delete from church_networks where id = p_id;   -- vínculos e supervisões da rede saem junto; os times não são tocados
end $$;

create or replace function public.grant_set(p_org uuid, p_user uuid, p_role text, p_network uuid, p_title text, p_actions text[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actions text[]; v_id uuid;
begin
  if not public.has_org_perm(p_org, 'administer') then raise exception 'forbidden'; end if;
  if p_role not in ('network_supervisor','general_leader') then raise exception 'invalid_role'; end if;
  -- só administrador/desenvolvedor nomeia liderança geral
  if p_role = 'general_leader' and not (public.is_developer() or public.is_org_admin(p_org)) then raise exception 'forbidden'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = p_user and role <> 'guest') then raise exception 'not_a_member'; end if;
  if p_role = 'network_supervisor' and not exists (select 1 from church_networks where id = p_network and org_id = p_org) then raise exception 'invalid_network'; end if;
  v_actions := coalesce(p_actions, public.role_actions(p_role));
  if not (v_actions <@ public.caller_actions(p_org)) then raise exception 'cannot_grant_more_than_you_have'; end if;
  if p_role = 'general_leader' then
    insert into access_grants (org_id, user_id, role_key, title, actions, created_by) values (p_org, p_user, p_role, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id) where role_key = 'general_leader' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  else
    insert into access_grants (org_id, user_id, role_key, network_id, title, actions, created_by) values (p_org, p_user, p_role, p_network, nullif(trim(coalesce(p_title, '')), ''), v_actions, auth.uid())
    on conflict (org_id, user_id, network_id) where role_key = 'network_supervisor' do update set title = excluded.title, actions = excluded.actions returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.grant_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g access_grants;
begin
  select * into g from access_grants where id = p_id;
  if g.id is null then return; end if;
  if not public.has_org_perm(g.org_id, 'administer') then raise exception 'forbidden'; end if;
  if g.role_key = 'general_leader' and not (public.is_developer() or public.is_org_admin(g.org_id)) then raise exception 'forbidden'; end if;
  delete from access_grants where id = p_id;
end $$;

-- o que a pessoa é, e onde, na igreja (base da navegação entre ambientes)
create or replace function public.my_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dev boolean := public.is_developer(); v_admin boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_admin := exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role = 'admin');
  return jsonb_build_object(
    'developer', v_dev,
    'admin', v_admin,
    'member', exists (select 1 from org_members where org_id = p_org and user_id = v_uid and role <> 'guest'),
    'general_leader', (select jsonb_build_object('title', g.title, 'actions', g.actions) from access_grants g where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'general_leader'),
    'networks', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'title', g.title, 'actions', g.actions) order by n.sort, n.name)
                          from access_grants g join church_networks n on n.id = g.network_id where g.org_id = p_org and g.user_id = v_uid and g.role_key = 'network_supervisor'), '[]'::jsonb),
    'leader_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid and tm.is_leader), '[]'::jsonb),
    'member_of', coalesce((select jsonb_agg(tm.team_id) from team_members tm where tm.org_id = p_org and tm.user_id = v_uid
                           and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date)), '[]'::jsonb));
end $$;

-- todas as igrejas, só para o desenvolvedor (testar os diferentes ambientes)
create or replace function public.dev_orgs() returns setof public.organizations
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then raise exception 'forbidden'; end if;
  return query select * from organizations order by name;
end $$;

revoke execute on function public.caller_actions(uuid), public.network_save(uuid, uuid, text, uuid[]), public.network_delete(uuid),
  public.grant_set(uuid, uuid, text, uuid, text, text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs() from public, anon;
grant execute on function public.caller_actions(uuid), public.network_save(uuid, uuid, text, uuid[]), public.network_delete(uuid),
  public.grant_set(uuid, uuid, text, uuid, text, text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs() to authenticated;

-- verificação:
-- select to_regclass('public.church_networks') is not null as redes, to_regclass('public.access_grants') is not null as concessoes,
--   to_regprocedure('public.has_perm(uuid,text)') is not null as permissao, to_regprocedure('public.my_access(uuid)') is not null as acesso;
-- conferir o desenvolvedor:
-- select p.full_name, u.email, p.is_developer from public.profiles p join auth.users u on u.id = p.id where p.is_developer;

-- REVERSÃO (se um dia precisar): as funções de permissão voltam às versões de 20261103000001 e 20261104000002 (reexecute esses
-- trechos) e depois: drop table public.access_grants, public.network_teams, public.church_networks;
-- drop function public.is_developer(), public.has_perm(uuid,text), public.has_org_perm(uuid,text), public.grant_covers_team(uuid,text),
--   public.role_actions(text), public.all_actions(), public.caller_actions(uuid), public.network_save(uuid,uuid,text,uuid[]),
--   public.network_delete(uuid), public.grant_set(uuid,uuid,text,uuid,text,text[]), public.grant_remove(uuid), public.my_access(uuid), public.dev_orgs();
