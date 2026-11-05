-- =====================================================================
-- Ministério Infantil: crianças, check-in e saída. Diáconos: registro de visitantes (05/11/2026).
-- Recursos novos de time: criancas, visitantes. Funções extras dos Diáconos.
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio']::text[]
    when 'multimidia' then array['checklist','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

-- times que já existem ganham os recursos novos do tipo
update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['criancas']) x order by 1) where team_type = 'infantil';
update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['visitantes']) x order by 1) where team_type = 'diaconal';

-- funções dos Diáconos: portaria, ofertório e introdução (além das que já existem)
create or replace function public.ensure_type_roles(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  names := case p_type
    when 'multimidia' then array['Direção','Projeção','Transmissão/Corte','Câmera 2','Câmera 3','Iluminação']
    when 'diaconal' then array['Coordenação','Portaria','Ofertório','Introdução','Santa Ceia','Estacionamento','Segurança','Apoio ao altar','Visitantes']
    when 'infantil' then array['Coordenação','Professor(a)','Auxiliar','Recepção / Check-in','Berçário','Louvor infantil']
    else null end;
  if names is null or exists (select 1 from music_roles where org_id = p_org and team_type = p_type) then return; end if;
  insert into music_roles (org_id, name, sort, team_type)
  select p_org, n, i, p_type from unnest(names) with ordinality as t(n, i)
  on conflict do nothing;
end $$;
revoke execute on function public.ensure_type_roles(uuid, text) from public, anon, authenticated;

insert into public.music_roles (org_id, name, sort, team_type)
select distinct t.org_id, n.name, n.sort, 'diaconal' from public.teams t,
  (values ('Portaria', 20), ('Ofertório', 21), ('Introdução', 22)) as n(name, sort)
 where t.team_type = 'diaconal'
on conflict do nothing;

-- ---------------------------------------------------------------- crianças
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  birth_date date,
  guardian_name text,
  guardian_phone text,
  allergies text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists children_team on public.children (team_id, name);

create table if not exists public.child_checkins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  code text not null,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references auth.users(id) on delete set null,
  picked_by text,
  code_ok boolean
);
create index if not exists child_checkins_team on public.child_checkins (team_id, checked_in_at desc);
create unique index if not exists child_checkins_open on public.child_checkins (child_id) where checked_out_at is null;

-- ---------------------------------------------------------------- visitantes
create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text,
  visited_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  first_time boolean not null default true,
  how_known text,
  notes text,
  status text not null default 'novo' check (status in ('novo','contatado','integrado')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists visitors_team on public.visitors (team_id, visited_on desc);

alter table public.children enable row level security;
alter table public.child_checkins enable row level security;
alter table public.visitors enable row level security;
revoke all on public.children, public.child_checkins, public.visitors from anon;

drop policy if exists ch_select on public.children; drop policy if exists ch_write on public.children; drop policy if exists ch_delete on public.children;
create policy ch_select on public.children for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy ch_write on public.children for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'criancas'));

drop policy if exists cc_select on public.child_checkins; drop policy if exists cc_write on public.child_checkins;
create policy cc_select on public.child_checkins for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy cc_write on public.child_checkins for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'criancas')
    and exists (select 1 from public.children c where c.id = child_id and c.team_id = child_checkins.team_id));

drop policy if exists vi_select on public.visitors; drop policy if exists vi_write on public.visitors;
create policy vi_select on public.visitors for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy vi_write on public.visitors for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'visitantes'));
