-- =====================================================================
-- SOMOS — Fase 4B: Cuidado com Pessoas (pedidos de oração, intercessão e atendimento pastoral).
--  * Área de proteção reforçada. Tudo fechado na tabela (nem o administrador lê direto); o acesso é por funções que conferem a permissão e registram quem abriu o quê (care_access).
--  * Permissões novas (só administrador ou concessão; liderança/integrante de time e desenvolvedor NÃO ganham acesso):
--      care_prayer (receber, distribuir e acompanhar pedidos de oração), care_pastoral (solicitações e registro dos atendimentos), care_manage (grupos de intercessão, regras, relatório e trilha de acessos).
--  * Pedido de oração: a pessoa escolhe entre "só a liderança autorizada" ou "um grupo de intercessão"; pode ser anônimo se a igreja permitir (a identidade nunca é devolvida a ninguém).
--    Pedidos nunca ficam disponíveis para toda a igreja, e notificações não carregam o conteúdo.
--  * Solicitação de atendimento (o que a pessoa pede) é separada do registro do atendimento realizado; observações restritas só o autor lê.
--  * Nada é usado em relatórios gerais ou segmentações: estas tabelas não são lidas por nenhuma função de relatório/segmentação. O relatório próprio só tem contagens.
--  * Reaproveita: notificações internas (sem conteúdo sensível), auditoria única (mod_audit, sem texto dos pedidos), fichas de pessoas (opcional, só por id).
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin',
               'fin_view','fin_entry','fin_approve','fin_manage','fin_donors',
               'comm_manage','comm_publish','comm_sermons','care_prayer','care_pastoral','care_manage']::text[]
$$;

create table if not exists public.care_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  allow_anonymous boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.prayer_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists prayer_groups_name on public.prayer_groups (org_id, lower(name));
create table if not exists public.prayer_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.prayer_groups(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_leader boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index if not exists prayer_group_members_user on public.prayer_group_members (user_id);
create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  category text check (category is null or length(category) <= 40),
  privacy text not null default 'leadership' check (privacy in ('leadership','group')),
  group_id uuid references public.prayer_groups(id) on delete set null,
  anonymous boolean not null default false,
  wants_followup boolean not null default false,
  status text not null default 'received' check (status in ('received','in_prayer','followup','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check (privacy <> 'group' or group_id is not null)
);
create index if not exists prayer_requests_org on public.prayer_requests (org_id, status, created_at desc);
create index if not exists prayer_requests_owner on public.prayer_requests (requester_id, created_at desc);
create table if not exists public.prayer_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.prayer_requests(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','status','assigned','note','shared','praying','closed_by_requester')),
  note text check (note is null or length(note) <= 300),
  to_requester boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists prayer_events_req on public.prayer_events (request_id, id);
create table if not exists public.pastoral_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (topic in ('counsel','visit','family','grief','spiritual','other')),
  body text check (body is null or length(body) <= 1000),
  preferred text check (preferred is null or length(preferred) <= 200),
  status text not null default 'requested' check (status in ('requested','scheduled','done','cancelled','referred')),
  responsible uuid references auth.users(id) on delete set null,
  scheduled_at timestamptz,
  referral_note text check (referral_note is null or length(referral_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastoral_requests_org on public.pastoral_requests (org_id, status, created_at desc);
create table if not exists public.pastoral_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid references public.pastoral_requests(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  held_at timestamptz not null,
  held_by uuid not null references auth.users(id) on delete set null,
  summary text check (summary is null or length(summary) <= 2000),
  restricted_note text check (restricted_note is null or length(restricted_note) <= 4000),
  followup_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastoral_sessions_org on public.pastoral_sessions (org_id, held_at desc);
create table if not exists public.care_access (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  entity text not null check (entity in ('prayer','pastoral_request','pastoral_session')),
  entity_id uuid,
  action text not null check (action in ('read','list')),
  at timestamptz not null default now()
);
create index if not exists care_access_org on public.care_access (org_id, at desc);

do $$ declare t text; begin
  foreach t in array array['care_settings','prayer_groups','prayer_group_members','prayer_requests','prayer_events','pastoral_requests','pastoral_sessions','care_access'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- auxiliares
create or replace function public.care_staff(p_org uuid, p_actions text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.actions && p_actions))
$$;
create or replace function public.care_need(p_org uuid, p_actions text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.care_staff(p_org, p_actions) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.care_member(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.care_uname(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(trim(social_name), ''), full_name) from people where org_id = p_org and user_id = p_user order by created_at limit 1),
                  (select coalesce(nullif(trim(full_name), ''), 'Pessoa') from profiles where id = p_user))
$$;
create or replace function public.care_in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from prayer_group_members m where m.group_id = p_group and m.user_id = auth.uid())
$$;
create or replace function public.care_log(p_org uuid, p_entity text, p_id uuid, p_action text) returns void
language sql security definer set search_path = public as $$
  insert into care_access (org_id, actor, entity, entity_id, action) values (p_org, auth.uid(), p_entity, p_id, p_action)
$$;
-- avisa quem cuida do assunto, sem conteúdo (só que existe algo novo)
create or replace function public.care_notify(p_org uuid, p_action text, p_group uuid, p_kind text, p_title text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct x from (
      select user_id x from org_members where org_id = p_org and role = 'admin'
      union select user_id from access_grants where org_id = p_org and p_action = any (actions)
      union select user_id from prayer_group_members where p_group is not null and group_id = p_group) y
    where x is not null and x is distinct from auth.uid() loop
    perform public.notify_user(u, p_org, p_kind, p_title, null, p_link, null);
  end loop;
end $$;
revoke execute on function public.care_staff(uuid, text[]), public.care_need(uuid, text[]), public.care_member(uuid), public.care_uname(uuid, uuid), public.care_in_group(uuid),
  public.care_log(uuid, text, uuid, text), public.care_notify(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- visão geral e regras
create or replace function public.care_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_member(p_org);
  return jsonb_build_object(
    'allow_anonymous', coalesce((select allow_anonymous from care_settings where org_id = p_org), false),
    'can', jsonb_build_object('prayer', public.care_staff(p_org, array['care_prayer']), 'pastoral', public.care_staff(p_org, array['care_pastoral']), 'manage', public.care_staff(p_org, array['care_manage'])),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description) order by g.name) from prayer_groups g where g.org_id = p_org and g.active), '[]'::jsonb),
    'in_group', exists (select 1 from prayer_group_members m where m.org_id = p_org and m.user_id = auth.uid()));
end $$;

create or replace function public.care_settings_save(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.care_need(p_org, array['care_manage']);
  insert into care_settings (org_id, allow_anonymous, updated_by, updated_at) values (p_org, coalesce((p->>'allow_anonymous')::boolean, false), auth.uid(), now())
    on conflict (org_id) do update set allow_anonymous = excluded.allow_anonymous, updated_by = auth.uid(), updated_at = now();
  perform public.mod_log(p_org, 'care', 'settings', p_org, 'update', null, jsonb_build_object('allow_anonymous', coalesce((p->>'allow_anonymous')::boolean, false)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- grupos de intercessão
create or replace function public.care_group_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id uuid := p_id;
begin
  perform public.care_need(p_org, array['care_manage']);
  if length(v_name) not between 1 and 80 then raise exception 'name_required'; end if;
  begin
    if p_id is null then insert into prayer_groups (org_id, name, description, active) values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), coalesce((p->>'active')::boolean, true)) returning id into v_id;
    else update prayer_groups set name = v_name, description = nullif(trim(coalesce(p->>'description', '')), ''), active = coalesce((p->>'active')::boolean, true) where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  exception when unique_violation then raise exception 'name_taken'; end;
  perform public.mod_log(p_org, 'care', 'group', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.care_group_member_set(p_group uuid, p_user uuid, p_in boolean, p_leader boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g prayer_groups;
begin
  select * into g from prayer_groups where id = p_group; if g.id is null then raise exception 'not_found'; end if;
  perform public.care_need(g.org_id, array['care_manage']);
  if coalesce(p_in, true) then
    if not exists (select 1 from org_members where org_id = g.org_id and user_id = p_user and role <> 'guest') then raise exception 'care_invalid_member'; end if;
    insert into prayer_group_members (group_id, org_id, user_id, is_leader, added_by) values (p_group, g.org_id, p_user, coalesce(p_leader, false), auth.uid())
      on conflict (group_id, user_id) do update set is_leader = excluded.is_leader;
  else delete from prayer_group_members where group_id = p_group and user_id = p_user; end if;
  perform public.mod_log(g.org_id, 'care', 'group', p_group, case when coalesce(p_in, true) then 'member_add' else 'member_remove' end, null, jsonb_build_object('user', p_user));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.care_group_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_need(p_org, array['care_manage']);
  return jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'active', g.active,
        'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', public.care_uname(p_org, m.user_id), 'is_leader', m.is_leader) order by public.care_uname(p_org, m.user_id)) from prayer_group_members m where m.group_id = g.id), '[]'::jsonb))
        order by g.active desc, g.name) from prayer_groups g where g.org_id = p_org), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.care_uname(p_org, o.user_id)) order by public.care_uname(p_org, o.user_id)) from org_members o where o.org_id = p_org and o.role <> 'guest'), '[]'::jsonb),
    'authorized', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.u, 'name', public.care_uname(p_org, x.u))) from (
        select user_id u from org_members where org_id = p_org and role = 'admin' union select user_id from access_grants where org_id = p_org and actions && array['care_prayer','care_pastoral','care_manage']) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- pedidos de oração
create or replace function public.prayer_request_create(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_body text := trim(coalesce(p->>'body', '')); v_priv text := coalesce(nullif(p->>'privacy', ''), 'leadership'); v_grp uuid := nullif(p->>'group_id', '')::uuid; v_anon boolean := coalesce((p->>'anonymous')::boolean, false); v_id uuid;
begin
  perform public.care_member(p_org);
  if length(v_body) not between 1 and 2000 then raise exception 'care_body_required'; end if;
  if v_priv not in ('leadership','group') then raise exception 'care_invalid_privacy'; end if;
  if v_priv = 'group' and not exists (select 1 from prayer_groups where id = v_grp and org_id = p_org and active) then raise exception 'care_invalid_group'; end if;
  if v_priv = 'leadership' then v_grp := null; end if;
  if v_anon and not coalesce((select allow_anonymous from care_settings where org_id = p_org), false) then raise exception 'care_anonymous_off'; end if;
  if (select count(*) from prayer_requests where org_id = p_org and requester_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then raise exception 'care_rate_limit'; end if;
  insert into prayer_requests (org_id, requester_id, body, category, privacy, group_id, anonymous, wants_followup)
  values (p_org, auth.uid(), v_body, nullif(left(trim(coalesce(p->>'category', '')), 40), ''), v_priv, v_grp, v_anon, coalesce((p->>'wants_followup')::boolean, false)) returning id into v_id;
  insert into prayer_events (request_id, org_id, actor, action, to_requester) values (v_id, p_org, case when v_anon then null else auth.uid() end, 'created', true);
  perform public.mod_log(p_org, 'care', 'prayer', v_id, 'create', null, jsonb_build_object('privacy', v_priv));
  perform public.care_notify(p_org, 'care_prayer', v_grp, 'care_prayer_new', 'Novo pedido de oração recebido', '#/cuidado-gestao');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.prayer_my_requests(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_member(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'category', r.category, 'privacy', r.privacy, 'group', (select name from prayer_groups where id = r.group_id), 'anonymous', r.anonymous,
      'wants_followup', r.wants_followup, 'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at) order by e.id) from prayer_events e where e.request_id = r.id and e.to_requester and e.action in ('created','status','closed_by_requester')), '[]'::jsonb)) order by r.created_at desc)
    from prayer_requests r where r.org_id = p_org and r.requester_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.prayer_my_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r prayer_requests;
begin
  select * into r from prayer_requests where id = p_id and requester_id = auth.uid() for update; if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'closed' then raise exception 'care_already_closed'; end if;
  update prayer_requests set status = 'closed', closed_at = now(), updated_at = now() where id = p_id;
  insert into prayer_events (request_id, org_id, actor, action, to_requester) values (p_id, r.org_id, case when r.anonymous then null else auth.uid() end, 'closed_by_requester', true);
  perform public.mod_log(r.org_id, 'care', 'prayer', p_id, 'closed_by_requester', null, null);
  return jsonb_build_object('ok', true);
end $$;

-- caixa de entrada da liderança autorizada (todos os pedidos da igreja; anônimo nunca mostra a pessoa)
create or replace function public.prayer_inbox(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_st text := nullif(p_filter->>'status', ''); v_as text := nullif(p_filter->>'assigned', ''); v_open boolean := coalesce((p_filter->>'open')::boolean, false);
begin
  perform public.care_need(p_org, array['care_prayer']);
  perform public.care_log(p_org, 'prayer', null, 'list');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'category', r.category, 'privacy', r.privacy, 'group_id', r.group_id, 'group', (select name from prayer_groups where id = r.group_id),
      'anonymous', r.anonymous, 'requester', case when r.anonymous then null else public.care_uname(p_org, r.requester_id) end, 'wants_followup', r.wants_followup, 'status', r.status,
      'assigned_to', r.assigned_to, 'assigned', public.care_uname(p_org, r.assigned_to), 'mine', r.assigned_to = auth.uid(), 'created_at', r.created_at, 'updated_at', r.updated_at) order by r.created_at desc)
    from prayer_requests r where r.org_id = p_org and (v_st is null or r.status = v_st) and (not v_open or r.status <> 'closed')
      and (v_as is null or (v_as = 'me' and r.assigned_to = auth.uid()) or (v_as = 'none' and r.assigned_to is null))), '[]'::jsonb);
end $$;

-- pedidos compartilhados com os grupos de que a pessoa participa
create or replace function public.prayer_group_inbox(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.care_member(p_org);
  if not exists (select 1 from prayer_group_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  perform public.care_log(p_org, 'prayer', null, 'list');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'category', r.category, 'group', g.name, 'anonymous', r.anonymous,
      'requester', case when r.anonymous then null else public.care_uname(p_org, r.requester_id) end, 'status', r.status, 'created_at', r.created_at,
      'prayers', (select count(*) from prayer_events e where e.request_id = r.id and e.action = 'praying'), 'prayed_by_me', exists (select 1 from prayer_events e where e.request_id = r.id and e.action = 'praying' and e.actor = auth.uid())) order by r.created_at desc)
    from prayer_requests r join prayer_groups g on g.id = r.group_id
    where r.org_id = p_org and r.privacy = 'group' and r.status <> 'closed' and exists (select 1 from prayer_group_members m where m.group_id = r.group_id and m.user_id = auth.uid())), '[]'::jsonb);
end $$;

create or replace function public.prayer_request_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r prayer_requests; v_staff boolean; v_grp boolean; v_own boolean;
begin
  select * into r from prayer_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  v_own := r.requester_id = auth.uid(); v_staff := public.care_staff(r.org_id, array['care_prayer']); v_grp := r.privacy = 'group' and public.care_in_group(r.group_id);
  if not (v_own or v_staff or v_grp) then raise exception 'forbidden'; end if;
  if not v_own then perform public.care_log(r.org_id, 'prayer', p_id, 'read'); end if;
  return jsonb_build_object('request', jsonb_build_object('id', r.id, 'body', r.body, 'category', r.category, 'privacy', r.privacy, 'group_id', r.group_id, 'group', (select name from prayer_groups where id = r.group_id),
      'anonymous', r.anonymous, 'requester', case when v_own then 'Você' when r.anonymous then null else public.care_uname(r.org_id, r.requester_id) end, 'wants_followup', r.wants_followup, 'status', r.status,
      'assigned_to', case when v_staff then r.assigned_to end, 'assigned', case when v_staff then public.care_uname(r.org_id, r.assigned_to) end, 'created_at', r.created_at, 'updated_at', r.updated_at),
    'mine', v_own, 'staff', v_staff, 'group_member', v_grp,
    'events', case when v_staff then coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'note', e.note, 'at', e.created_at, 'by', case when e.actor is null then null else public.care_uname(r.org_id, e.actor) end) order by e.id)
                                              from prayer_events e where e.request_id = r.id), '[]'::jsonb)
                else coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at) order by e.id) from prayer_events e where e.request_id = r.id and e.to_requester and v_own), '[]'::jsonb) end,
    'prayers', (select count(*) from prayer_events e where e.request_id = r.id and e.action = 'praying'),
    'authorized', case when v_staff then coalesce((select jsonb_agg(jsonb_build_object('user_id', x.u, 'name', public.care_uname(r.org_id, x.u))) from (
        select user_id u from org_members where org_id = r.org_id and role = 'admin' union select user_id from access_grants where org_id = r.org_id and 'care_prayer' = any (actions)
        union select user_id from prayer_group_members where r.privacy = 'group' and group_id = r.group_id) x), '[]'::jsonb) end);
end $$;

-- liderança autorizada: situação, responsável e anotação interna. Pedido só da liderança só pode ter responsável da liderança autorizada.
create or replace function public.prayer_request_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r prayer_requests; v_st text := nullif(p->>'status', ''); v_as uuid := nullif(p->>'assigned_to', '')::uuid; v_note text := nullif(trim(coalesce(p->>'note', '')), ''); v_ok boolean; v_changed boolean := false;
begin
  select * into r from prayer_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  perform public.care_need(r.org_id, array['care_prayer']);
  if v_st is not null and v_st not in ('received','in_prayer','followup','closed') then raise exception 'care_invalid_status'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'care_note_long'; end if;
  if p ? 'assigned_to' and v_as is not null then
    v_ok := exists (select 1 from org_members where org_id = r.org_id and user_id = v_as and role = 'admin') or exists (select 1 from access_grants g where g.org_id = r.org_id and g.user_id = v_as and 'care_prayer' = any (g.actions))
         or (r.privacy = 'group' and exists (select 1 from prayer_group_members m where m.group_id = r.group_id and m.user_id = v_as));
    if not v_ok then raise exception 'care_invalid_assignee'; end if;
  end if;
  if p ? 'assigned_to' and v_as is distinct from r.assigned_to then
    update prayer_requests set assigned_to = v_as, updated_at = now() where id = p_id;
    insert into prayer_events (request_id, org_id, actor, action) values (p_id, r.org_id, auth.uid(), 'assigned');
    if v_as is not null and v_as is distinct from auth.uid() then perform public.notify_user(v_as, r.org_id, 'care_prayer_assigned', 'Você recebeu um pedido de oração para acompanhar', null, '#/cuidado-gestao', null); end if;
    v_changed := true;
  end if;
  if v_st is not null and v_st <> r.status then
    update prayer_requests set status = v_st, updated_at = now(), closed_at = case when v_st = 'closed' then now() else null end where id = p_id;
    insert into prayer_events (request_id, org_id, actor, action, to_requester) values (p_id, r.org_id, auth.uid(), 'status', true);
    perform public.notify_user(r.requester_id, r.org_id, 'care_prayer_update', 'Seu pedido de oração foi atualizado', case v_st when 'in_prayer' then 'Estamos orando por você.' when 'followup' then 'Alguém vai acompanhar você.' when 'closed' then 'Seu pedido foi encerrado.' else null end, '#/cuidado', null);
    v_changed := true;
  end if;
  if v_note is not null then insert into prayer_events (request_id, org_id, actor, action, note) values (p_id, r.org_id, auth.uid(), 'note', v_note); v_changed := true; end if;
  if v_changed then perform public.mod_log(r.org_id, 'care', 'prayer', p_id, 'update', null, jsonb_build_object('status', coalesce(v_st, r.status))); end if;
  return jsonb_build_object('ok', true);
end $$;

-- quem está no grupo (ou a liderança) registra que está orando; não muda a situação
create or replace function public.prayer_request_pray(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r prayer_requests;
begin
  select * into r from prayer_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  if not (public.care_staff(r.org_id, array['care_prayer']) or (r.privacy = 'group' and public.care_in_group(r.group_id))) then raise exception 'forbidden'; end if;
  if r.status = 'closed' then raise exception 'care_already_closed'; end if;
  if not exists (select 1 from prayer_events where request_id = p_id and action = 'praying' and actor = auth.uid()) then
    insert into prayer_events (request_id, org_id, actor, action) values (p_id, r.org_id, auth.uid(), 'praying');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- atendimento pastoral: solicitação (o que a pessoa pede)
create or replace function public.pastoral_request_create(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_topic text := coalesce(nullif(p->>'topic', ''), 'other'); v_id uuid;
begin
  perform public.care_member(p_org);
  if v_topic not in ('counsel','visit','family','grief','spiritual','other') then raise exception 'care_invalid_topic'; end if;
  if length(coalesce(p->>'body', '')) > 1000 or length(coalesce(p->>'preferred', '')) > 200 then raise exception 'care_body_long'; end if;
  if (select count(*) from pastoral_requests where org_id = p_org and requester_id = auth.uid() and status in ('requested','scheduled')) >= 3 then raise exception 'care_rate_limit'; end if;
  insert into pastoral_requests (org_id, requester_id, topic, body, preferred) values (p_org, auth.uid(), v_topic, nullif(trim(coalesce(p->>'body', '')), ''), nullif(trim(coalesce(p->>'preferred', '')), '')) returning id into v_id;
  perform public.mod_log(p_org, 'care', 'pastoral_request', v_id, 'create', null, jsonb_build_object('topic', v_topic));
  perform public.care_notify(p_org, 'care_pastoral', null, 'care_pastoral_new', 'Nova solicitação de atendimento', '#/cuidado-gestao');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.pastoral_my_requests(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_member(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'topic', r.topic, 'body', r.body, 'preferred', r.preferred, 'status', r.status, 'scheduled_at', case when r.status = 'scheduled' then r.scheduled_at end,
      'responsible', case when r.status = 'scheduled' then public.care_uname(p_org, r.responsible) end, 'created_at', r.created_at) order by r.created_at desc)
    from pastoral_requests r where r.org_id = p_org and r.requester_id = auth.uid()), '[]'::jsonb);
end $$;
create or replace function public.pastoral_my_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r pastoral_requests;
begin
  select * into r from pastoral_requests where id = p_id and requester_id = auth.uid() for update; if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('requested','scheduled') then raise exception 'care_not_open'; end if;
  update pastoral_requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public.mod_log(r.org_id, 'care', 'pastoral_request', p_id, 'cancel_by_requester', null, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pastoral_inbox(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_st text := nullif(p_filter->>'status', '');
begin
  perform public.care_need(p_org, array['care_pastoral']);
  perform public.care_log(p_org, 'pastoral_request', null, 'list');
  return jsonb_build_object(
    'authorized', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.u, 'name', public.care_uname(p_org, x.u))) from (
        select user_id u from org_members where org_id = p_org and role = 'admin' union select user_id from access_grants where org_id = p_org and 'care_pastoral' = any (actions)) x), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'topic', r.topic, 'status', r.status, 'requester', public.care_uname(p_org, r.requester_id), 'responsible_id', r.responsible,
        'responsible', public.care_uname(p_org, r.responsible), 'scheduled_at', r.scheduled_at, 'created_at', r.created_at, 'mine', r.responsible = auth.uid()) order by (r.status = 'requested') desc, r.created_at desc)
      from pastoral_requests r where r.org_id = p_org and (v_st is null or r.status = v_st)), '[]'::jsonb));
end $$;

create or replace function public.pastoral_request_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r pastoral_requests; v_own boolean; v_staff boolean;
begin
  select * into r from pastoral_requests where id = p_id; if r.id is null then raise exception 'not_found'; end if;
  v_own := r.requester_id = auth.uid(); v_staff := public.care_staff(r.org_id, array['care_pastoral']);
  if not (v_own or v_staff) then raise exception 'forbidden'; end if;
  if not v_own then perform public.care_log(r.org_id, 'pastoral_request', p_id, 'read'); end if;
  return jsonb_build_object('request', jsonb_build_object('id', r.id, 'topic', r.topic, 'body', r.body, 'preferred', r.preferred, 'status', r.status, 'requester', public.care_uname(r.org_id, r.requester_id),
      'responsible_id', r.responsible, 'responsible', public.care_uname(r.org_id, r.responsible), 'scheduled_at', r.scheduled_at, 'referral_note', case when v_staff then r.referral_note end, 'created_at', r.created_at),
    'staff', v_staff, 'mine', v_own,
    'history', case when v_staff then public.mod_history(r.org_id, 'care', 'pastoral_request', r.id) else '[]'::jsonb end);
end $$;

create or replace function public.pastoral_request_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r pastoral_requests; v_st text := nullif(p->>'status', ''); v_resp uuid := nullif(p->>'responsible', '')::uuid; v_when timestamptz := nullif(p->>'scheduled_at', '')::timestamptz; v_ref text := nullif(trim(coalesce(p->>'referral_note', '')), '');
begin
  select * into r from pastoral_requests where id = p_id for update; if r.id is null then raise exception 'not_found'; end if;
  perform public.care_need(r.org_id, array['care_pastoral']);
  if v_st is not null and v_st not in ('requested','scheduled','cancelled','referred') then raise exception 'care_invalid_status'; end if;
  if r.status in ('done','cancelled') then raise exception 'care_not_open'; end if;
  if v_resp is not null and not (exists (select 1 from org_members where org_id = r.org_id and user_id = v_resp and role = 'admin') or exists (select 1 from access_grants g where g.org_id = r.org_id and g.user_id = v_resp and 'care_pastoral' = any (g.actions))) then raise exception 'care_invalid_assignee'; end if;
  if v_st = 'scheduled' and (coalesce(v_resp, r.responsible) is null or v_when is null) then raise exception 'care_schedule_required'; end if;
  if v_st = 'referred' and v_ref is null then raise exception 'care_referral_required'; end if;
  if v_ref is not null and length(v_ref) > 300 then raise exception 'care_note_long'; end if;
  update pastoral_requests set status = coalesce(v_st, status), responsible = coalesce(v_resp, responsible), scheduled_at = coalesce(v_when, scheduled_at), referral_note = coalesce(v_ref, referral_note), updated_at = now() where id = p_id;
  perform public.mod_log(r.org_id, 'care', 'pastoral_request', p_id, coalesce(v_st, 'update'), null, null);
  if v_st in ('scheduled','referred','cancelled') and r.requester_id is distinct from auth.uid() then
    perform public.notify_user(r.requester_id, r.org_id, 'care_pastoral_update', 'Sua solicitação de atendimento foi atualizada', 'Veja os detalhes em Cuidado.', '#/cuidado', null);
  end if;
  if v_resp is not null and v_resp is distinct from r.responsible and v_resp is distinct from auth.uid() then perform public.notify_user(v_resp, r.org_id, 'care_pastoral_assigned', 'Você recebeu um atendimento para acompanhar', null, '#/cuidado-gestao', null); end if;
  return jsonb_build_object('ok', true);
end $$;

-- registro do atendimento realizado (separado da solicitação). Observação restrita: só o autor lê.
create or replace function public.pastoral_session_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pastoral_sessions; v_req uuid := nullif(p->>'request_id', '')::uuid; v_person uuid := nullif(p->>'person_id', '')::uuid; v_at timestamptz := nullif(p->>'held_at', '')::timestamptz; v_id uuid := p_id; q pastoral_requests;
begin
  perform public.care_need(p_org, array['care_pastoral']);
  if v_at is null then raise exception 'care_date_required'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'care_future_date'; end if;
  if length(coalesce(p->>'summary', '')) > 2000 or length(coalesce(p->>'restricted_note', '')) > 4000 then raise exception 'care_body_long'; end if;
  if v_person is not null and not exists (select 1 from people where id = v_person and org_id = p_org) then raise exception 'care_invalid_person'; end if;
  if v_req is not null then
    select * into q from pastoral_requests where id = v_req and org_id = p_org for update; if q.id is null then raise exception 'not_found'; end if;
  end if;
  if p_id is null then
    insert into pastoral_sessions (org_id, request_id, person_id, held_at, held_by, summary, restricted_note, followup_on)
    values (p_org, v_req, v_person, v_at, auth.uid(), nullif(trim(coalesce(p->>'summary', '')), ''), nullif(trim(coalesce(p->>'restricted_note', '')), ''), nullif(p->>'followup_on', '')::date) returning id into v_id;
    if v_req is not null and q.status in ('requested','scheduled') then update pastoral_requests set status = 'done', updated_at = now() where id = v_req; end if;
  else
    select * into s from pastoral_sessions where id = p_id and org_id = p_org for update; if s.id is null then raise exception 'not_found'; end if;
    if s.held_by is distinct from auth.uid() then raise exception 'forbidden'; end if;
    update pastoral_sessions set held_at = v_at, person_id = v_person, summary = nullif(trim(coalesce(p->>'summary', '')), ''), restricted_note = nullif(trim(coalesce(p->>'restricted_note', '')), ''), followup_on = nullif(p->>'followup_on', '')::date, updated_at = now() where id = p_id;
  end if;
  perform public.mod_log(p_org, 'care', 'pastoral_session', v_id, case when p_id is null then 'create' else 'update' end, null, null);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.pastoral_session_list(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_req uuid := nullif(p_filter->>'request_id', '')::uuid; v_person uuid := nullif(p_filter->>'person_id', '')::uuid;
begin
  perform public.care_need(p_org, array['care_pastoral']);
  perform public.care_log(p_org, 'pastoral_session', null, 'list');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'request_id', s.request_id, 'person_id', s.person_id, 'person', public.mod_pname(s.person_id), 'held_at', s.held_at, 'held_by', public.care_uname(p_org, s.held_by),
      'mine', s.held_by = auth.uid(), 'summary', s.summary, 'followup_on', s.followup_on, 'has_restricted', s.restricted_note is not null,
      'restricted_note', case when s.held_by = auth.uid() then s.restricted_note end) order by s.held_at desc)
    from pastoral_sessions s where s.org_id = p_org and (v_req is null or s.request_id = v_req) and (v_person is null or s.person_id = v_person)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- relatório (só contagens) e trilha de acessos
create or replace function public.care_report(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_need(p_org, array['care_manage']);
  return jsonb_build_object(
    'prayer', (select jsonb_build_object('total', count(*), 'received', count(*) filter (where status = 'received'), 'in_prayer', count(*) filter (where status = 'in_prayer'), 'followup', count(*) filter (where status = 'followup'), 'closed', count(*) filter (where status = 'closed'),
        'unassigned_open', count(*) filter (where status <> 'closed' and assigned_to is null), 'last_30_days', count(*) filter (where created_at > now() - interval '30 days')) from prayer_requests where org_id = p_org),
    'pastoral', (select jsonb_build_object('requested', count(*) filter (where status = 'requested'), 'scheduled', count(*) filter (where status = 'scheduled'), 'done', count(*) filter (where status = 'done'), 'referred', count(*) filter (where status = 'referred'),
        'cancelled', count(*) filter (where status = 'cancelled')) from pastoral_requests where org_id = p_org),
    'sessions', (select jsonb_build_object('last_30_days', count(*) filter (where held_at > now() - interval '30 days'), 'last_90_days', count(*) filter (where held_at > now() - interval '90 days')) from pastoral_sessions where org_id = p_org),
    'groups', (select count(*) from prayer_groups where org_id = p_org and active));
end $$;
create or replace function public.care_access_log(p_org uuid, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.care_need(p_org, array['care_manage']);
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'actor', public.care_uname(p_org, a.actor), 'entity', a.entity, 'action', a.action) order by a.id desc)
    from (select * from care_access where org_id = p_org order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) a), '[]'::jsonb);
end $$;

revoke execute on function public.care_overview(uuid), public.care_settings_save(uuid, jsonb), public.care_group_save(uuid, uuid, jsonb), public.care_group_member_set(uuid, uuid, boolean, boolean), public.care_group_list(uuid),
  public.prayer_request_create(uuid, jsonb), public.prayer_my_requests(uuid), public.prayer_my_close(uuid), public.prayer_inbox(uuid, jsonb), public.prayer_group_inbox(uuid), public.prayer_request_get(uuid),
  public.prayer_request_update(uuid, jsonb), public.prayer_request_pray(uuid), public.pastoral_request_create(uuid, jsonb), public.pastoral_my_requests(uuid), public.pastoral_my_cancel(uuid),
  public.pastoral_inbox(uuid, jsonb), public.pastoral_request_get(uuid), public.pastoral_request_update(uuid, jsonb), public.pastoral_session_save(uuid, uuid, jsonb), public.pastoral_session_list(uuid, jsonb),
  public.care_report(uuid), public.care_access_log(uuid, int) from public, anon;
grant execute on function public.care_overview(uuid), public.care_settings_save(uuid, jsonb), public.care_group_save(uuid, uuid, jsonb), public.care_group_member_set(uuid, uuid, boolean, boolean), public.care_group_list(uuid),
  public.prayer_request_create(uuid, jsonb), public.prayer_my_requests(uuid), public.prayer_my_close(uuid), public.prayer_inbox(uuid, jsonb), public.prayer_group_inbox(uuid), public.prayer_request_get(uuid),
  public.prayer_request_update(uuid, jsonb), public.prayer_request_pray(uuid), public.pastoral_request_create(uuid, jsonb), public.pastoral_my_requests(uuid), public.pastoral_my_cancel(uuid),
  public.pastoral_inbox(uuid, jsonb), public.pastoral_request_get(uuid), public.pastoral_request_update(uuid, jsonb), public.pastoral_session_save(uuid, uuid, jsonb), public.pastoral_session_list(uuid, jsonb),
  public.care_report(uuid), public.care_access_log(uuid, int) to authenticated;

-- ---------------------------------------------------------------- menu: item "Pedidos do meu grupo" só para quem participa de um grupo de intercessão
create or replace function public.my_menu(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_dec boolean; v_scales boolean; v_welcome boolean; v_ev boolean; v_tk boolean; v_sm boolean; v_ic boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  v_ids := array(select id from people where org_id = p_org and user_id = auth.uid());
  -- a decisão é consultada na estrutura permanente (registros não anulados), nunca só pela classificação
  v_dec := exists (select 1 from faith_decisions d where d.org_id = p_org and d.voided_at is null and (d.person_id = any (v_ids) or d.self_user = auth.uid()));
  v_scales := exists (select 1 from team_members m where m.org_id = p_org and m.user_id = auth.uid())
    or exists (select 1 from roster_assignments a join rosters r on r.id = a.roster_id where a.person_id = any (v_ids) and a.status in ('invited','confirmed','declined','sub_requested')
                and r.status not in ('draft') and r.starts_at > now() - interval '30 days');
  v_welcome := exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or public.has_people_perm(p_org, 'people_welcome')
    or exists (select 1 from team_members m where m.org_id = p_org and m.user_id = auth.uid() and public.team_has_feature(m.team_id, 'visitantes'));
  v_ev := exists (select 1 from ev_events e where e.org_id = p_org and e.status = 'published' and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and public.ev_eligible(e, pe));
  v_tk := exists (select 1 from ev_registrations g join ev_events e on e.id = g.event_id where g.org_id = p_org and g.user_id = auth.uid() and g.status in ('confirmed','waitlist') and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() - interval '7 days');
  v_sm := exists (select 1 from sermons s where s.org_id = p_org and s.status = 'published' and (s.audience = 'all' or (pe.id is not null and pe.classification = s.audience)));
  v_ic := exists (select 1 from prayer_group_members g where g.org_id = p_org and g.user_id = auth.uid());
  return jsonb_build_object(
    'sermons', v_sm, 'intercession', v_ic, 'events', v_ev, 'tickets', v_tk,
    'classification', pe.classification,
    'has_decision', v_dec,
    'decision', (not v_dec and (pe.id is null or pe.classification <> 'member')) or coalesce(pe.menu_decision, false),
    'journeys', exists (select 1 from journey_participants x where x.person_id = any (v_ids) and x.status <> 'cancelled')
                or exists (select 1 from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and pe.id is not null
                           and (j.eligible_classes is null or pe.classification = any (j.eligible_classes))
                           and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_ids) and x.status <> 'cancelled')),
    'scales', v_scales,
    'rosters', v_scales,
    'welcome', v_welcome,
    'media', public.can_request_media(p_org),
    'leader', exists (select 1 from team_members m where m.org_id = p_org and m.user_id = auth.uid() and m.is_leader));
end $$;

-- ---------------------------------------------------------------------
-- Para desfazer: drop das funções care_*, prayer_*, pastoral_* e das tabelas care_settings, prayer_*, pastoral_*, care_access (apaga os pedidos e registros!);
-- module_actions e my_menu voltam às versões da migração de comunicação.
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select 'care_manage' = any (public.module_actions()) and to_regclass('public.prayer_requests') is not null and to_regclass('public.pastoral_sessions') is not null
   and exists (select 1 from pg_proc where proname = 'prayer_request_update') and exists (select 1 from pg_proc where proname = 'pastoral_session_save') as cuidado_ok;
