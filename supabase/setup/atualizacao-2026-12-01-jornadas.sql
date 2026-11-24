-- =====================================================================
-- SOMOS Recurso 08: Jornadas (acompanhamento da caminhada)
-- Jornada > Etapas > Atividades, montadas pela própria igreja (nada fixo). Participação é um registro à parte da ficha:
--  * não altera classificação, não cria conta, não cria vínculo com time/ministério e não é "avaliação espiritual" (o percentual só conta atividades obrigatórias);
--  * a estrutura pode mudar sem apagar progresso: atividades usadas são "removidas" (ocultas), nunca apagadas; jornada arquivada preserva participantes e histórico;
--  * responsáveis (geral, por etapa, por atividade, por participante) precisam da permissão de acompanhar e só enxergam o que lhes cabe;
--  * eventos reaproveitam church_events; conteúdo usa link/arquivo/texto (sem biblioteca paralela); nada entra em jornada sozinho por aceitar Jesus ou virar membro;
--  * notificações configuráveis por jornada, sem lembretes automáticos; a pessoa pode silenciar a própria jornada;
--  * tudo validado no banco; histórico administrativo em journey_log e eventos na linha do tempo da pessoa (sem nada pastoral).
-- =====================================================================

-- ---------------------------------------------------------------- permissões novas
alter table public.access_grants drop constraint if exists access_grants_actions_check;
alter table public.access_grants add constraint access_grants_actions_check check (
  actions <@ array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                   'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                   'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']::text[]);
create or replace function public.all_actions() returns text[] language sql immutable as $$
  select array['view','create','edit','delete','approve','manage','administer','people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
               'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
               'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']::text[]
$$;
create or replace function public.people_actions(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
      then array['people_view','people_edit','people_approve','people_import','people_welcome','people_care','people_timeline_add','people_timeline_edit',
                 'people_converts_view','people_converts_register','people_converts_edit','people_converts_link','people_converts_assign','people_converts_followup','people_converts_indicators','people_converts_admin',
                 'people_journeys_admin','people_journeys_participants','people_journeys_follow','people_journeys_approve','people_journeys_indicators']
    else coalesce((select array_agg(distinct a) from access_grants g, unnest(g.actions) a
                   where g.org_id = p_org and g.user_id = auth.uid() and a like 'people\_%'), '{}'::text[]) end
$$;
create or replace function public.jr_can(p_org uuid, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select ('people_journeys_' || p_mode) = any (public.people_actions(p_org))
$$;
create or replace function public.jr_users(p_org uuid, p_mode text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select om.user_id from org_members om where om.org_id = p_org and om.role = 'admin'
  union
  select g.user_id from access_grants g where g.org_id = p_org and ('people_journeys_' || p_mode) = any (g.actions)
$$;
revoke execute on function public.jr_can(uuid, text), public.jr_users(uuid, text) from public, anon;
grant execute on function public.jr_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  image_url text check (image_url is null or length(image_url) <= 600),
  objective text check (objective is null or length(objective) <= 500),
  audience text check (audience is null or length(audience) <= 300),
  owner_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('public','private')),
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  step_mode text not null default 'sequential' check (step_mode in ('sequential','free','conditional')),
  enroll_voluntary boolean not null default false,
  eligible_classes text[] check (eligible_classes is null or eligible_classes <@ array['member','attender','visitor','none']::text[]),
  auto_finish boolean not null default true,
  for_converts boolean not null default false,
  auto_rule jsonb,
  notify jsonb not null default '{"invite":true,"enroll":true,"step_open":true,"assign":true,"approve":true,"step_done":true,"done":true,"responsible":true}'::jsonb,
  version int not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists journeys_org on public.journeys (org_id, status);

create table if not exists public.journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 500),
  position int not null default 0,
  responsible_id uuid references auth.users(id) on delete set null,
  completion_rule text not null default 'all_required' check (completion_rule in ('all_required','manual')),
  requires uuid[] not null default '{}',
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists journey_steps_j on public.journey_steps (journey_id, position);

create table if not exists public.journey_activities (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.journey_steps(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 1000),
  kind text not null default 'text' check (kind in ('text','video','file','link','reading','quiz','task','meeting','event','accompanied')),
  instructions text check (instructions is null or length(instructions) <= 1000),
  content_url text check (content_url is null or (length(content_url) <= 600 and content_url ~* '^https?://')),
  content_text text check (content_text is null or length(content_text) <= 4000),
  event_id uuid references public.church_events(id) on delete set null,
  responsible_id uuid references auth.users(id) on delete set null,
  completion_mode text not null default 'self' check (completion_mode in ('self','responsible','auto','approval')),
  required boolean not null default true,
  position int not null default 0,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists journey_acts_step on public.journey_activities (step_id, position);

create table if not exists public.journey_participants (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','active','paused','completed','cancelled')),
  responsible_id uuid references auth.users(id) on delete set null,
  source text not null default 'admin' check (source in ('admin','self','rule','convert')),
  decision_id uuid references public.faith_decisions(id) on delete set null,
  notify boolean not null default true,
  started_on date,
  completed_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason in ('declined','left','staff')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists journey_participants_unique on public.journey_participants (journey_id, person_id) where status <> 'cancelled';
create index if not exists journey_participants_person on public.journey_participants (person_id);

create table if not exists public.journey_completions (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.journey_participants(id) on delete cascade,
  activity_id uuid not null references public.journey_activities(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('done','pending_approval')),
  source text not null check (source in ('self','responsible','auto','approval')),
  answer text check (answer is null or length(answer) <= 2000),
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (participant_id, activity_id)
);
create table if not exists public.journey_step_progress (
  participant_id uuid not null references public.journey_participants(id) on delete cascade,
  step_id uuid not null references public.journey_steps(id) on delete cascade,
  completed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  primary key (participant_id, step_id)
);
create table if not exists public.journey_log (
  id bigint generated always as identity primary key,
  journey_id uuid not null,
  participant_id uuid,
  org_id uuid not null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists journey_log_j on public.journey_log (journey_id, at desc);
create index if not exists journey_log_p on public.journey_log (participant_id, at desc);

alter table public.journeys enable row level security;
alter table public.journey_steps enable row level security;
alter table public.journey_activities enable row level security;
alter table public.journey_participants enable row level security;
alter table public.journey_completions enable row level security;
alter table public.journey_step_progress enable row level security;
alter table public.journey_log enable row level security;
revoke all on public.journeys, public.journey_steps, public.journey_activities, public.journey_participants, public.journey_completions, public.journey_step_progress, public.journey_log from anon, authenticated;

insert into public.history_categories (org_id, key, label, manual, sort) values (null, 'jornada', 'Jornadas', false, 47)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ---------------------------------------------------------------- utilitários internos
create or replace function public.jr_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.jr_log(p_journey uuid, p_pid uuid, p_org uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into journey_log (journey_id, participant_id, org_id, actor, action, detail) values (p_journey, p_pid, p_org, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb))
$$;
-- notificação configurável por jornada; nunca para quem agiu; a pessoa pode silenciar a própria jornada. Sem lembretes automáticos.
create or replace function public.jr_notify(p_journey uuid, p_key text, p_user uuid, p_title text, p_link text, p_muted boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare j journeys;
begin
  if p_user is null or p_user is not distinct from auth.uid() or coalesce(p_muted, false) then return; end if;
  select * into j from journeys where id = p_journey;
  if j.id is null or coalesce((j.notify->>p_key)::boolean, false) is not true then return; end if;
  perform public.notify_user(p_user, j.org_id, 'journey', p_title, null, p_link, null);
end $$;
-- evento na linha do tempo da pessoa (nome da jornada só quando é pública e não é de convertidos)
create or replace function public.jr_history(p_pid uuid, p_title text, p_desc text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; v_name text;
begin
  select * into pt from journey_participants where id = p_pid; select * into j from journeys where id = pt.journey_id;
  if pt.id is null or j.id is null then return; end if;
  v_name := case when j.visibility = 'public' and not j.for_converts then j.name end;
  insert into person_history (org_id, person_id, actor, kind, field, old_value, new_value, note, category, title, description, restricted, occurred_on, origin, op_id, op_key, meta)
  values (pt.org_id, pt.person_id, auth.uid(), 'journey', null, null, null, null, 'jornada', p_title, case when v_name is not null then v_name || coalesce(' · ' || p_desc, '') else p_desc end, false,
          public.jr_today(), 'auto', txid_current()::text, 'jr:' || p_key, jsonb_build_object('journey_id', j.id, 'participant_id', p_pid))
  on conflict (person_id, op_key) where op_key is not null do nothing;
end $$;
create or replace function public.jr_person_user(p_person uuid) returns uuid language sql stable security definer set search_path = public as $$ select user_id from people where id = p_person $$;

-- estado das etapas de uma participação (a regra única que o servidor usa para tudo)
create or replace function public.jr_steps(p_pid uuid)
returns table (step_id uuid, pos int, name text, req_total int, req_done int, total int, done int, complete boolean, unlocked boolean, confirmed boolean)
language sql stable security definer set search_path = public as $$
  with pt as (select * from journey_participants where id = p_pid),
  j as (select jj.* from journeys jj join pt on pt.journey_id = jj.id),
  s as (
    select st.*,
      (select count(*) from journey_activities a where a.step_id = st.id and a.removed_at is null and a.required)::int as rt,
      (select count(*) from journey_activities a join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid and c.status = 'done' where a.step_id = st.id and a.removed_at is null and a.required)::int as rd,
      (select count(*) from journey_activities a where a.step_id = st.id and a.removed_at is null)::int as t,
      (select count(*) from journey_activities a join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid and c.status = 'done' where a.step_id = st.id and a.removed_at is null)::int as d,
      exists (select 1 from journey_step_progress sp where sp.participant_id = p_pid and sp.step_id = st.id and sp.confirmed_at is not null) as conf
    from journey_steps st where st.journey_id = (select journey_id from pt) and st.removed_at is null),
  c as (select s.*, (s.rd = s.rt and (s.completion_rule = 'all_required' or s.conf)) as comp from s)
  select c.id, c.position, c.name, c.rt, c.rd, c.t, c.d, c.comp,
    case (select step_mode from j)
      when 'free' then true
      when 'sequential' then not exists (select 1 from c p where p.position < c.position and not p.comp)
      else not exists (select 1 from c p where p.id = any (c.requires) and not p.comp) end,
    c.conf
  from c order by c.position, c.created_at
$$;
create or replace function public.jr_pct(p_pid uuid) returns int language sql stable security definer set search_path = public as $$
  select case when coalesce(sum(req_total), 0) = 0 then 0 else round(100.0 * sum(req_done) / sum(req_total))::int end from public.jr_steps(p_pid)
$$;
-- nível de quem acompanha: staff (administra/gerencia participantes), manager (responsável geral ou da pessoa), step (responsável de etapa/atividade) ou nulo
create or replace function public.jr_level(p_pid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then return null; end if;
  select * into j from journeys where id = pt.journey_id;
  if public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants') then return 'staff'; end if;
  if not public.jr_can(pt.org_id, 'follow') then return null; end if;
  if j.owner_id = auth.uid() or pt.responsible_id = auth.uid() then return 'manager'; end if;
  if exists (select 1 from journey_steps where journey_id = j.id and removed_at is null and responsible_id = auth.uid())
     or exists (select 1 from journey_activities where journey_id = j.id and removed_at is null and responsible_id = auth.uid()) then return 'step'; end if;
  return null;
end $$;
create or replace function public.jr_is_self(p_pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from journey_participants pt join people p on p.id = pt.person_id where pt.id = p_pid and p.user_id = auth.uid())
$$;

-- fecha etapas, abre as seguintes e conclui a jornada quando tudo o que é obrigatório foi feito
create or replace function public.jr_recalc(p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; r record; v_before uuid[]; v_req int; v_all boolean; v_link text; v_pu uuid; v_resp uuid; v_opened boolean := false;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or pt.status <> 'active' then return; end if;
  select * into j from journeys where id = pt.journey_id;
  v_pu := public.jr_person_user(pt.person_id); v_resp := coalesce(pt.responsible_id, j.owner_id); v_link := '#/jornadas/' || p_pid;
  select coalesce(array_agg(step_id) filter (where unlocked), '{}') into v_before from public.jr_steps(p_pid);
  for r in select * from public.jr_steps(p_pid) loop
    if r.complete and r.total > 0 and not exists (select 1 from journey_step_progress where participant_id = p_pid and step_id = r.step_id) then
      insert into journey_step_progress (participant_id, step_id) values (p_pid, r.step_id) on conflict do nothing;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'step_done', jsonb_build_object('step_id', r.step_id, 'name', r.name));
      perform public.jr_history(p_pid, 'Etapa concluída', r.name, 'step:' || p_pid || ':' || r.step_id);
      perform public.jr_notify(j.id, 'step_done', v_resp, 'Uma etapa da jornada foi concluída', '#/gestao-jornadas/' || j.id);
    elsif not r.complete and exists (select 1 from journey_step_progress where participant_id = p_pid and step_id = r.step_id) then
      delete from journey_step_progress where participant_id = p_pid and step_id = r.step_id;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'step_reopen', jsonb_build_object('step_id', r.step_id, 'name', r.name));
    end if;
  end loop;
  for r in select * from public.jr_steps(p_pid) where unlocked and not (step_id = any (v_before)) loop
    v_opened := true;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'step_open', jsonb_build_object('step_id', r.step_id, 'name', r.name));
    perform public.jr_notify(j.id, 'step_open', v_pu, 'Uma nova etapa da sua jornada está disponível', v_link, not pt.notify);
  end loop;
  if j.auto_finish then
    select coalesce(sum(req_total), 0), coalesce(bool_and(complete), false) into v_req, v_all from public.jr_steps(p_pid);
    if v_req > 0 and v_all then
      update journey_participants set status = 'completed', completed_at = now(), updated_at = now() where id = p_pid;
      perform public.jr_log(j.id, p_pid, pt.org_id, 'complete', jsonb_build_object('auto', true));
      perform public.jr_history(p_pid, 'Jornada concluída', null, 'done:' || p_pid);
      perform public.jr_notify(j.id, 'done', v_pu, 'Você concluiu uma jornada. Parabéns!', v_link, not pt.notify);
      perform public.jr_notify(j.id, 'done', v_resp, 'Uma pessoa concluiu a jornada', '#/gestao-jornadas/' || j.id);
    end if;
  end if;
  if v_opened then perform public.jr_auto_sync(p_pid); end if;
end $$;
create or replace function public.jr_recalc_all(p_journey uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from journey_participants where journey_id = p_journey and status = 'active' loop perform public.jr_recalc(r.id); end loop;
end $$;
-- atividades "automáticas" (evento já realizado) são concluídas pelo servidor, sem ninguém marcar
create or replace function public.jr_auto_sync(p_pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; n int;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or pt.status <> 'active' then return; end if;
  insert into journey_completions (participant_id, activity_id, org_id, status, source, done_at)
  select p_pid, a.id, pt.org_id, 'done', 'auto', now() from journey_activities a join journey_steps s on s.id = a.step_id join church_events e on e.id = a.event_id
   where a.journey_id = pt.journey_id and a.removed_at is null and s.removed_at is null and a.completion_mode = 'auto' and e.starts_at <= now()
     and e.starts_at >= coalesce(pt.started_on, pt.created_at::date)::timestamptz
     and exists (select 1 from public.jr_steps(p_pid) x where x.step_id = a.step_id and x.unlocked)
     and not exists (select 1 from journey_completions c where c.participant_id = p_pid and c.activity_id = a.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform public.jr_recalc(p_pid); end if;
end $$;
create or replace function public.jr_current(p_pid uuid) returns table (step_id uuid, name text) language sql stable security definer set search_path = public as $$
  select step_id, name from public.jr_steps(p_pid) where unlocked and not complete order by pos limit 1
$$;
revoke execute on function public.jr_today(), public.jr_log(uuid, uuid, uuid, text, jsonb), public.jr_notify(uuid, text, uuid, text, text, boolean), public.jr_history(uuid, text, text, text),
  public.jr_person_user(uuid), public.jr_steps(uuid), public.jr_pct(uuid), public.jr_level(uuid), public.jr_is_self(uuid), public.jr_recalc(uuid), public.jr_recalc_all(uuid), public.jr_auto_sync(uuid), public.jr_current(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- construtor: jornada
create or replace function public.jr_check_follower(p_org uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is not null and not (p_user in (select public.jr_users(p_org, 'follow'))) then raise exception 'invalid_responsible'; end if;
end $$;
create or replace function public.jr_bump(p_journey uuid, p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  select version into v from journeys where id = p_journey for update;
  if p_version is not null and p_version <> v then raise exception 'version_conflict'; end if;
  update journeys set version = version + 1, updated_at = now() where id = p_journey;
end $$;
revoke execute on function public.jr_check_follower(uuid, uuid), public.jr_bump(uuid, int) from public, anon, authenticated;

create or replace function public.journey_save(p_org uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_id uuid; v_name text; v_vis text; v_mode text; v_owner uuid; v_team uuid; v_cls text[]; v_notify jsonb; v_img text; k text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.jr_can(p_org, 'admin') then raise exception 'forbidden'; end if;
  if p_id is not null then
    select * into j from journeys where id = p_id and org_id = p_org; if j.id is null then raise exception 'not_found'; end if;
    if j.status = 'archived' then raise exception 'journey_archived'; end if;
    if p_version is not null and p_version <> j.version then raise exception 'version_conflict'; end if;
  end if;
  v_name := trim(coalesce(p->>'name', j.name, ''));
  if length(v_name) < 1 then raise exception 'name_required'; end if;
  if length(v_name) > 120 then raise exception 'name_too_long'; end if;
  v_vis := coalesce(nullif(p->>'visibility', ''), j.visibility, 'private'); if v_vis not in ('public','private') then raise exception 'invalid_visibility'; end if;
  v_mode := coalesce(nullif(p->>'step_mode', ''), j.step_mode, 'sequential'); if v_mode not in ('sequential','free','conditional') then raise exception 'invalid_step_mode'; end if;
  v_owner := case when p ? 'owner_id' then nullif(p->>'owner_id', '')::uuid else j.owner_id end; perform public.jr_check_follower(p_org, v_owner);
  v_team := case when p ? 'team_id' then nullif(p->>'team_id', '')::uuid else j.team_id end;
  if v_team is not null and not exists (select 1 from teams where id = v_team and org_id = p_org) then raise exception 'invalid_team'; end if;
  v_cls := case when p ? 'eligible_classes' then (select array_agg(x) from jsonb_array_elements_text(coalesce(p->'eligible_classes', '[]'::jsonb)) x) else j.eligible_classes end;
  if v_cls is not null and (cardinality(v_cls) = 0) then v_cls := null; end if;
  if v_cls is not null and not (v_cls <@ array['member','attender','visitor','none']::text[]) then raise exception 'invalid_classification'; end if;
  v_img := case when p ? 'image_url' then nullif(trim(coalesce(p->>'image_url', '')), '') else j.image_url end;
  if v_img is not null and v_img !~* '^https?://' then raise exception 'invalid_url'; end if;
  v_notify := coalesce(j.notify, '{"invite":true,"enroll":true,"step_open":true,"assign":true,"approve":true,"step_done":true,"done":true,"responsible":true}'::jsonb);
  if p ? 'notify' then
    for k in select jsonb_object_keys(p->'notify') loop
      if k not in ('invite','enroll','step_open','assign','approve','step_done','done','responsible') then raise exception 'invalid_notify'; end if;
      v_notify := v_notify || jsonb_build_object(k, coalesce((p->'notify'->>k)::boolean, false));
    end loop;
  end if;
  if p_id is null then
    insert into journeys (org_id, name, description, image_url, objective, audience, owner_id, team_id, visibility, step_mode, enroll_voluntary, eligible_classes, auto_finish, for_converts, auto_rule, notify, created_by)
    values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_img, nullif(trim(coalesce(p->>'objective', '')), ''), nullif(trim(coalesce(p->>'audience', '')), ''), v_owner, v_team, v_vis, v_mode,
            coalesce((p->>'enroll_voluntary')::boolean, false), v_cls, coalesce((p->>'auto_finish')::boolean, true), coalesce((p->>'for_converts')::boolean, false),
            case when p ? 'auto_rule' then p->'auto_rule' end, v_notify, auth.uid())
    returning id into v_id;
    perform public.jr_log(v_id, null, p_org, 'create', jsonb_build_object('name', v_name));
    return jsonb_build_object('saved', true, 'id', v_id, 'version', 1);
  end if;
  update journeys set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, image_url = v_img,
         objective = case when p ? 'objective' then nullif(trim(coalesce(p->>'objective', '')), '') else objective end, audience = case when p ? 'audience' then nullif(trim(coalesce(p->>'audience', '')), '') else audience end,
         owner_id = v_owner, team_id = v_team, visibility = v_vis, step_mode = v_mode, enroll_voluntary = coalesce((p->>'enroll_voluntary')::boolean, enroll_voluntary), eligible_classes = v_cls,
         auto_finish = coalesce((p->>'auto_finish')::boolean, auto_finish), for_converts = coalesce((p->>'for_converts')::boolean, for_converts),
         auto_rule = case when p ? 'auto_rule' then p->'auto_rule' else auto_rule end, notify = v_notify, version = version + 1, updated_at = now()
   where id = p_id;
  if v_owner is distinct from j.owner_id then
    perform public.jr_log(p_id, null, p_org, 'owner', jsonb_build_object('from', j.owner_id, 'to', v_owner));
    perform public.jr_notify(p_id, 'responsible', v_owner, 'Você foi designado(a) responsável por uma jornada', '#/gestao-jornadas/' || p_id);
  end if;
  perform public.jr_log(p_id, null, p_org, 'update', jsonb_build_object('name', v_name));
  if v_mode is distinct from j.step_mode then perform public.jr_recalc_all(p_id); end if;
  return jsonb_build_object('saved', true, 'id', p_id, 'version', j.version + 1);
end $$;

create or replace function public.journey_set_status(p_id uuid, p_status text, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if p_status not in ('draft','active','paused','archived') then raise exception 'invalid_status'; end if;
  if p_version is not null and p_version <> j.version then raise exception 'version_conflict'; end if;
  if p_status = j.status then return jsonb_build_object('ok', true, 'changed', false); end if;
  if p_status = 'active' and not exists (select 1 from journey_activities a join journey_steps s on s.id = a.step_id where a.journey_id = p_id and a.removed_at is null and s.removed_at is null) then raise exception 'journey_empty'; end if;
  if p_status = 'draft' and exists (select 1 from journey_participants where journey_id = p_id and status in ('active','paused','completed')) then raise exception 'has_participants'; end if;
  update journeys set status = p_status, archived_at = case when p_status = 'archived' then now() else null end, version = version + 1, updated_at = now() where id = p_id;
  perform public.jr_log(p_id, null, j.org_id, 'status', jsonb_build_object('from', j.status, 'to', p_status));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.journey_duplicate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_new uuid; s record; v_sid uuid; v_map jsonb := '{}'::jsonb; r record;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  insert into journeys (org_id, name, description, image_url, objective, audience, owner_id, team_id, visibility, status, step_mode, enroll_voluntary, eligible_classes, auto_finish, for_converts, auto_rule, notify, created_by)
  values (j.org_id, left('Cópia de ' || j.name, 120), j.description, j.image_url, j.objective, j.audience, j.owner_id, j.team_id, j.visibility, 'draft', j.step_mode, j.enroll_voluntary, j.eligible_classes, j.auto_finish, j.for_converts, j.auto_rule, j.notify, auth.uid())
  returning id into v_new;
  for s in select * from journey_steps where journey_id = p_id and removed_at is null order by position loop
    insert into journey_steps (journey_id, org_id, name, description, position, responsible_id, completion_rule, requires) values (v_new, s.org_id, s.name, s.description, s.position, s.responsible_id, s.completion_rule, '{}') returning id into v_sid;
    v_map := v_map || jsonb_build_object(s.id::text, v_sid);
    insert into journey_activities (step_id, journey_id, org_id, title, description, kind, instructions, content_url, content_text, event_id, responsible_id, completion_mode, required, position)
    select v_sid, v_new, a.org_id, a.title, a.description, a.kind, a.instructions, a.content_url, a.content_text, a.event_id, a.responsible_id, a.completion_mode, a.required, a.position
      from journey_activities a where a.step_id = s.id and a.removed_at is null order by a.position;
  end loop;
  for r in select id, requires from journey_steps where journey_id = p_id and removed_at is null and cardinality(requires) > 0 loop
    update journey_steps set requires = coalesce((select array_agg((v_map->>x::text)::uuid) from unnest(r.requires) x where v_map ? x::text), '{}')
     where id = (v_map->>r.id::text)::uuid;
  end loop;
  perform public.jr_log(v_new, null, j.org_id, 'duplicate', jsonb_build_object('from', p_id));
  return jsonb_build_object('saved', true, 'id', v_new);
end $$;

-- ---------------------------------------------------------------- construtor: etapas e atividades
create or replace function public.journey_step_save(p_journey uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; st journey_steps; v_name text; v_rule text; v_resp uuid; v_req uuid[]; v_pos int; v_new uuid;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status = 'archived' then raise exception 'journey_archived'; end if;
  if p_id is not null then select * into st from journey_steps where id = p_id and journey_id = p_journey and removed_at is null; if st.id is null then raise exception 'not_found'; end if; end if;
  v_name := trim(coalesce(p->>'name', st.name, '')); if length(v_name) < 1 then raise exception 'name_required'; end if; if length(v_name) > 120 then raise exception 'name_too_long'; end if;
  if length(coalesce(p->>'description', '')) > 500 then raise exception 'text_too_long'; end if;
  v_rule := coalesce(nullif(p->>'completion_rule', ''), st.completion_rule, 'all_required'); if v_rule not in ('all_required','manual') then raise exception 'invalid_rule'; end if;
  v_resp := case when p ? 'responsible_id' then nullif(p->>'responsible_id', '')::uuid else st.responsible_id end; perform public.jr_check_follower(j.org_id, v_resp);
  v_pos := coalesce(st.position, (select coalesce(max(position), 0) + 1 from journey_steps where journey_id = p_journey and removed_at is null));
  v_req := case when p ? 'requires' then (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(p->'requires', '[]'::jsonb)) x) else coalesce(st.requires, '{}') end;
  if cardinality(v_req) > 0 and exists (select 1 from unnest(v_req) x where not exists (select 1 from journey_steps s2 where s2.id = x and s2.journey_id = p_journey and s2.removed_at is null and s2.position < v_pos)) then raise exception 'invalid_requires'; end if;
  perform public.jr_bump(p_journey, p_version);
  if p_id is null then
    insert into journey_steps (journey_id, org_id, name, description, position, responsible_id, completion_rule, requires)
    values (p_journey, j.org_id, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_pos, v_resp, v_rule, v_req) returning id into v_new;
    perform public.jr_log(p_journey, null, j.org_id, 'step_add', jsonb_build_object('name', v_name));
    perform public.jr_recalc_all(p_journey);
    return jsonb_build_object('saved', true, 'id', v_new);
  end if;
  update journey_steps set name = v_name, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, responsible_id = v_resp, completion_rule = v_rule, requires = v_req where id = p_id;
  perform public.jr_log(p_journey, null, j.org_id, 'step_edit', jsonb_build_object('name', v_name));
  perform public.jr_recalc_all(p_journey);
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

create or replace function public.journey_step_remove(p_id uuid, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st journey_steps; j journeys; v_used boolean;
begin
  select * into st from journey_steps where id = p_id and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = st.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if exists (select 1 from journey_activities where step_id = p_id and removed_at is null) then raise exception 'step_not_empty'; end if;
  perform public.jr_bump(j.id, p_version);
  select exists (select 1 from journey_completions c join journey_activities a on a.id = c.activity_id where a.step_id = p_id) or exists (select 1 from journey_step_progress where step_id = p_id) into v_used;
  if v_used then update journey_steps set removed_at = now() where id = p_id; else delete from journey_steps where id = p_id; end if;
  update journey_steps set requires = array_remove(requires, p_id) where journey_id = j.id;
  perform public.jr_log(j.id, null, j.org_id, 'step_remove', jsonb_build_object('name', st.name, 'kept', v_used));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('ok', true, 'kept', v_used);
end $$;

create or replace function public.journey_activity_save(p_step uuid, p_id uuid, p jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st journey_steps; j journeys; a journey_activities; v_title text; v_kind text; v_mode text; v_resp uuid; v_ev uuid; v_url text; v_new uuid; v_pos int; v_req boolean;
begin
  select * into st from journey_steps where id = p_step and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = st.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status = 'archived' then raise exception 'journey_archived'; end if;
  if p_id is not null then select * into a from journey_activities where id = p_id and step_id = p_step and removed_at is null; if a.id is null then raise exception 'not_found'; end if; end if;
  v_title := trim(coalesce(p->>'title', a.title, '')); if length(v_title) < 1 then raise exception 'name_required'; end if; if length(v_title) > 160 then raise exception 'name_too_long'; end if;
  v_kind := coalesce(nullif(p->>'kind', ''), a.kind, 'text'); if v_kind not in ('text','video','file','link','reading','quiz','task','meeting','event','accompanied') then raise exception 'invalid_kind'; end if;
  v_mode := coalesce(nullif(p->>'completion_mode', ''), a.completion_mode, 'self'); if v_mode not in ('self','responsible','auto','approval') then raise exception 'invalid_mode'; end if;
  v_resp := case when p ? 'responsible_id' then nullif(p->>'responsible_id', '')::uuid else a.responsible_id end; perform public.jr_check_follower(j.org_id, v_resp);
  v_ev := case when p ? 'event_id' then nullif(p->>'event_id', '')::uuid else a.event_id end;
  if v_ev is not null and not exists (select 1 from church_events where id = v_ev and org_id = j.org_id) then raise exception 'invalid_event'; end if;
  v_url := case when p ? 'content_url' then nullif(trim(coalesce(p->>'content_url', '')), '') else a.content_url end;
  if v_url is not null and v_url !~* '^https?://' then raise exception 'invalid_url'; end if;
  if v_mode = 'auto' and v_ev is null then raise exception 'auto_needs_event'; end if;
  if v_mode in ('responsible','approval') and v_resp is null and j.owner_id is null then null; end if;
  v_req := coalesce((p->>'required')::boolean, a.required, true);
  if length(coalesce(p->>'description', '')) > 1000 or length(coalesce(p->>'instructions', '')) > 1000 or length(coalesce(p->>'content_text', '')) > 4000 then raise exception 'text_too_long'; end if;
  v_pos := coalesce(a.position, (select coalesce(max(position), 0) + 1 from journey_activities where step_id = p_step and removed_at is null));
  perform public.jr_bump(j.id, p_version);
  if p_id is null then
    insert into journey_activities (step_id, journey_id, org_id, title, description, kind, instructions, content_url, content_text, event_id, responsible_id, completion_mode, required, position)
    values (p_step, j.id, j.org_id, v_title, nullif(trim(coalesce(p->>'description', '')), ''), v_kind, nullif(trim(coalesce(p->>'instructions', '')), ''), v_url, nullif(trim(coalesce(p->>'content_text', '')), ''), v_ev, v_resp, v_mode, v_req, v_pos)
    returning id into v_new;
    perform public.jr_log(j.id, null, j.org_id, 'activity_add', jsonb_build_object('title', v_title, 'kind', v_kind));
    perform public.jr_recalc_all(j.id);
    return jsonb_build_object('saved', true, 'id', v_new);
  end if;
  update journey_activities set title = v_title, description = case when p ? 'description' then nullif(trim(coalesce(p->>'description', '')), '') else description end, kind = v_kind,
         instructions = case when p ? 'instructions' then nullif(trim(coalesce(p->>'instructions', '')), '') else instructions end, content_url = v_url,
         content_text = case when p ? 'content_text' then nullif(trim(coalesce(p->>'content_text', '')), '') else content_text end, event_id = v_ev, responsible_id = v_resp, completion_mode = v_mode, required = v_req where id = p_id;
  perform public.jr_log(j.id, null, j.org_id, 'activity_edit', jsonb_build_object('title', v_title));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('saved', true, 'id', p_id);
end $$;

create or replace function public.journey_activity_remove(p_id uuid, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a journey_activities; j journeys; v_used boolean;
begin
  select * into a from journey_activities where id = p_id and removed_at is null; if a.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = a.journey_id;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  perform public.jr_bump(j.id, p_version);
  select exists (select 1 from journey_completions where activity_id = p_id) into v_used;
  if v_used then update journey_activities set removed_at = now() where id = p_id; else delete from journey_activities where id = p_id; end if;
  perform public.jr_log(j.id, null, j.org_id, 'activity_remove', jsonb_build_object('title', a.title, 'kept', v_used));
  perform public.jr_recalc_all(j.id);
  return jsonb_build_object('ok', true, 'kept', v_used);
end $$;

create or replace function public.journey_reorder(p_kind text, p_parent uuid, p_ids uuid[], p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_j uuid; v_org uuid; v_n int; i int;
begin
  if p_kind = 'step' then select id, org_id into v_j, v_org from journeys where id = p_parent;
  elsif p_kind = 'activity' then select s.journey_id, s.org_id into v_j, v_org from journey_steps s where s.id = p_parent and s.removed_at is null;
  else raise exception 'invalid_kind'; end if;
  if v_j is null then raise exception 'not_found'; end if;
  if not public.jr_can(v_org, 'admin') then raise exception 'forbidden'; end if;
  if p_kind = 'step' then
    select count(*) into v_n from journey_steps where journey_id = p_parent and removed_at is null;
    if coalesce(cardinality(p_ids), 0) <> v_n or exists (select 1 from unnest(p_ids) x where not exists (select 1 from journey_steps where id = x and journey_id = p_parent and removed_at is null)) or (select count(distinct x) from unnest(p_ids) x) <> v_n then raise exception 'invalid_order'; end if;
  else
    select count(*) into v_n from journey_activities where step_id = p_parent and removed_at is null;
    if coalesce(cardinality(p_ids), 0) <> v_n or exists (select 1 from unnest(p_ids) x where not exists (select 1 from journey_activities where id = x and step_id = p_parent and removed_at is null)) or (select count(distinct x) from unnest(p_ids) x) <> v_n then raise exception 'invalid_order'; end if;
  end if;
  perform public.jr_bump(v_j, p_version);
  for i in 1 .. coalesce(cardinality(p_ids), 0) loop
    if p_kind = 'step' then update journey_steps set position = i where id = p_ids[i]; else update journey_activities set position = i where id = p_ids[i]; end if;
  end loop;
  if p_kind = 'step' then   -- pré-requisito só pode apontar para etapa anterior
    update journey_steps s set requires = coalesce((select array_agg(x) from unnest(s.requires) x where exists (select 1 from journey_steps o where o.id = x and o.position < s.position)), '{}') where s.journey_id = v_j;
  end if;
  perform public.jr_log(v_j, null, v_org, 'reorder', jsonb_build_object('kind', p_kind));
  perform public.jr_recalc_all(v_j);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- consulta administrativa
create or replace function public.jr_staff_of(p_journey uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_journey; if j.id is null then return false; end if;
  if public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'indicators') then return true; end if;
  if not public.jr_can(j.org_id, 'follow') then return false; end if;
  return coalesce(j.owner_id = auth.uid(), false) or exists (select 1 from journey_participants where journey_id = p_journey and responsible_id = auth.uid())
      or exists (select 1 from journey_steps where journey_id = p_journey and removed_at is null and responsible_id = auth.uid())
      or exists (select 1 from journey_activities where journey_id = p_journey and removed_at is null and responsible_id = auth.uid());
end $$;
revoke execute on function public.jr_staff_of(uuid) from public, anon, authenticated;

create or replace function public.journey_list(p_org uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text := nullif(p->>'status', ''); v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'follow') or public.jr_can(p_org, 'indicators')) then raise exception 'forbidden'; end if;
  if v_status is not null and v_status not in ('draft','active','paused','archived') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'image_url', j.image_url, 'status', j.status, 'visibility', j.visibility, 'for_converts', j.for_converts,
      'owner_name', case when j.owner_id is null then null else coalesce(public.welcome_name(j.org_id, j.owner_id), 'Usuário removido') end,
      'steps', (select count(*) from journey_steps s where s.journey_id = j.id and s.removed_at is null),
      'participants', (select count(*) from journey_participants x where x.journey_id = j.id and x.status <> 'cancelled'),
      'active', (select count(*) from journey_participants x where x.journey_id = j.id and x.status = 'active'),
      'completed', (select count(*) from journey_participants x where x.journey_id = j.id and x.status = 'completed')) order by (j.status = 'archived'), j.created_at desc), '[]'::jsonb) into v_res
    from journeys j where j.org_id = p_org and (v_status is null or j.status = v_status) and (v_q is null or j.name ilike '%' || v_q || '%') and public.jr_staff_of(j.id);
  return jsonb_build_object('items', v_res, 'can_admin', public.jr_can(p_org, 'admin'), 'can_indicators', public.jr_can(p_org, 'indicators') or public.jr_can(p_org, 'admin'), 'can_participants', public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'admin'));
end $$;

create or replace function public.journey_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_steps jsonb;
begin
  select * into j from journeys where id = p_id; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_staff_of(p_id) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'position', s.position, 'responsible_id', s.responsible_id,
      'responsible_name', case when s.responsible_id is null then null else coalesce(public.welcome_name(j.org_id, s.responsible_id), 'Usuário removido') end, 'completion_rule', s.completion_rule, 'requires', s.requires,
      'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'description', a.description, 'kind', a.kind, 'instructions', a.instructions, 'content_url', a.content_url, 'content_text', a.content_text,
          'event_id', a.event_id, 'event_title', (select title from church_events where id = a.event_id), 'responsible_id', a.responsible_id, 'completion_mode', a.completion_mode, 'required', a.required, 'position', a.position) order by a.position, a.created_at)
        from journey_activities a where a.step_id = s.id and a.removed_at is null), '[]'::jsonb)) order by s.position, s.created_at), '[]'::jsonb) into v_steps
    from journey_steps s where s.journey_id = p_id and s.removed_at is null;
  return jsonb_build_object('id', j.id, 'org_id', j.org_id, 'name', j.name, 'description', j.description, 'image_url', j.image_url, 'objective', j.objective, 'audience', j.audience, 'owner_id', j.owner_id,
    'owner_name', case when j.owner_id is null then null else coalesce(public.welcome_name(j.org_id, j.owner_id), 'Usuário removido') end, 'team_id', j.team_id, 'team_name', (select name from teams where id = j.team_id),
    'visibility', j.visibility, 'status', j.status, 'step_mode', j.step_mode, 'enroll_voluntary', j.enroll_voluntary, 'eligible_classes', j.eligible_classes, 'auto_finish', j.auto_finish, 'for_converts', j.for_converts,
    'auto_rule', j.auto_rule, 'notify', j.notify, 'version', j.version, 'created_at', j.created_at, 'created_by_name', case when j.created_by is null then null else coalesce(public.welcome_name(j.org_id, j.created_by), 'Usuário removido') end,
    'steps', v_steps, 'can_edit', public.jr_can(j.org_id, 'admin') and j.status <> 'archived', 'can_admin', public.jr_can(j.org_id, 'admin'), 'can_participants', public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'admin'),
    'log', case when public.jr_can(j.org_id, 'admin') then coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
        from (select * from journey_log where journey_id = p_id and participant_id is null order by at desc, id desc limit 50) l), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.journey_responsibles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants')) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(public.welcome_name(p_org, u), 'Sem nome')) order by coalesce(public.welcome_name(p_org, u), '')) from (select distinct public.jr_users(p_org, 'follow') u) x
                   where exists (select 1 from org_members where org_id = p_org and user_id = x.u)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- participantes
create or replace function public.jr_person_ok(p_org uuid, p_person uuid) returns people
language sql stable security definer set search_path = public as $$
  select * from people where id = p_person and org_id = p_org and status in ('active','inactive','pending')
$$;
revoke execute on function public.jr_person_ok(uuid, uuid) from public, anon, authenticated;

create or replace function public.journey_enroll(p_journey uuid, p_person uuid, p_responsible uuid default null, p_start boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; pe people; v_id uuid; v_status text := case when coalesce(p_start, true) then 'active' else 'waiting' end;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not (public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants')) then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from public.jr_person_ok(j.org_id, p_person); if pe.id is null then raise exception 'person_not_found'; end if;
  perform public.jr_check_follower(j.org_id, p_responsible);
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, started_on, added_by)
    values (p_journey, j.org_id, p_person, v_status, coalesce(p_responsible, j.owner_id), 'admin', case when v_status = 'active' then public.jr_today() end, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('person_id', p_person, 'status', v_status));
  perform public.jr_history(v_id, case when v_status = 'active' then 'Entrou em uma jornada' else 'Convidado(a) para uma jornada' end, null, 'enroll:' || v_id);
  perform public.jr_notify(p_journey, case when v_status = 'active' then 'enroll' else 'invite' end, pe.user_id, case when v_status = 'active' then 'Você foi incluído(a) em uma jornada' else 'Você foi convidado(a) para uma jornada' end, '#/jornadas/' || v_id);
  if coalesce(p_responsible, j.owner_id) is not null then perform public.jr_notify(p_journey, 'assign', coalesce(p_responsible, j.owner_id), 'Você acompanha uma nova pessoa em uma jornada', '#/gestao-jornadas/' || p_journey); end if;
  if v_status = 'active' then perform public.jr_auto_sync(v_id); perform public.jr_recalc(v_id); end if;
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

create or replace function public.journey_self_enroll(p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; pe people; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = j.org_id and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if j.visibility <> 'public' or not j.enroll_voluntary then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from people where org_id = j.org_id and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is null then raise exception 'no_person_record'; end if;
  if j.eligible_classes is not null and not (pe.classification = any (j.eligible_classes)) then raise exception 'not_eligible'; end if;
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, started_on, added_by)
    values (p_journey, j.org_id, pe.id, 'active', j.owner_id, 'self', public.jr_today(), auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('self', true));
  perform public.jr_history(v_id, 'Entrou em uma jornada', null, 'enroll:' || v_id);
  perform public.jr_auto_sync(v_id); perform public.jr_recalc(v_id);
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- inclusão por critérios: só cria CONVITES (aguardando início); a pessoa decide se aceita
create or replace function public.journey_apply_rule(p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; r record; v_id uuid; n int := 0; v_cls text[];
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_can(j.org_id, 'admin') then raise exception 'forbidden'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  if j.auto_rule is null then raise exception 'no_rule'; end if;
  v_cls := (select array_agg(x) from jsonb_array_elements_text(coalesce(j.auto_rule->'classes', '[]'::jsonb)) x);
  if v_cls is null or cardinality(v_cls) = 0 then raise exception 'no_rule'; end if;
  for r in select p.id, p.user_id from people p where p.org_id = j.org_id and p.status = 'active' and p.classification = any (v_cls)
              and (j.eligible_classes is null or p.classification = any (j.eligible_classes))
              and not exists (select 1 from journey_participants x where x.journey_id = p_journey and x.person_id = p.id and x.status <> 'cancelled') limit 500 loop
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, added_by) values (p_journey, j.org_id, r.id, 'waiting', j.owner_id, 'rule', auth.uid()) returning id into v_id;
    perform public.jr_log(p_journey, v_id, j.org_id, 'enroll', jsonb_build_object('rule', true));
    perform public.jr_history(v_id, 'Convidado(a) para uma jornada', null, 'enroll:' || v_id);
    perform public.jr_notify(p_journey, 'invite', r.user_id, 'Você foi convidado(a) para uma jornada', '#/jornadas/' || v_id);
    n := n + 1;
  end loop;
  perform public.jr_log(p_journey, null, j.org_id, 'apply_rule', jsonb_build_object('invited', n));
  return jsonb_build_object('ok', true, 'invited', n);
end $$;

create or replace function public.journey_respond(p_pid uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null or not public.jr_is_self(p_pid) then raise exception 'forbidden'; end if;
  if pt.status <> 'waiting' then raise exception 'invalid_status'; end if;
  select * into j from journeys where id = pt.journey_id;
  if p_accept then
    if j.status <> 'active' then raise exception 'journey_not_active'; end if;
    update journey_participants set status = 'active', started_on = public.jr_today(), updated_at = now() where id = p_pid;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'accept', '{}'::jsonb);
    perform public.jr_history(p_pid, 'Começou uma jornada', null, 'start:' || p_pid);
    perform public.jr_notify(j.id, 'enroll', coalesce(pt.responsible_id, j.owner_id), 'Uma pessoa aceitou começar a jornada', '#/gestao-jornadas/' || j.id);
    perform public.jr_auto_sync(p_pid); perform public.jr_recalc(p_pid);
  else
    update journey_participants set status = 'cancelled', cancel_reason = 'declined', updated_at = now() where id = p_pid;   -- a recusa não altera cadastro nem decisão
    perform public.jr_log(j.id, p_pid, pt.org_id, 'decline', '{}'::jsonb);
    perform public.jr_history(p_pid, 'Convite para jornada recusado', null, 'decline:' || p_pid);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.journey_participant_status(p_pid uuid, p_action text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; v_lvl text; v_self boolean; v_new text; v_pu uuid; v_req int; v_all boolean; v_title text;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = pt.journey_id; v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid); v_pu := public.jr_person_user(pt.person_id);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  if p_action in ('pause','resume','cancel') then
    if not (v_self or v_lvl in ('staff','manager')) then raise exception 'forbidden'; end if;
  elsif p_action in ('start','complete') then
    if v_lvl not in ('staff','manager') then raise exception 'forbidden'; end if;
  elsif p_action = 'reopen' then
    if not public.jr_can(pt.org_id, 'admin') then raise exception 'forbidden'; end if;
  else raise exception 'invalid_action'; end if;
  if p_action = 'start' and pt.status = 'waiting' then v_new := 'active'; v_title := 'Começou uma jornada';
  elsif p_action = 'pause' and pt.status = 'active' then v_new := 'paused'; v_title := 'Jornada pausada';
  elsif p_action = 'resume' and pt.status = 'paused' then v_new := 'active'; v_title := 'Jornada retomada';
  elsif p_action = 'complete' and pt.status in ('active','paused') then
    select coalesce(sum(req_total), 0), coalesce(bool_and(complete), true) into v_req, v_all from public.jr_steps(p_pid);
    if not v_all and not (coalesce(p_force, false) and public.jr_can(pt.org_id, 'admin')) then raise exception 'required_pending'; end if;
    v_new := 'completed'; v_title := 'Jornada concluída';
  elsif p_action = 'cancel' and pt.status in ('waiting','active','paused') then v_new := 'cancelled'; v_title := 'Participação na jornada cancelada';
  elsif p_action = 'reopen' and pt.status in ('completed','cancelled') then
    if exists (select 1 from journey_participants where journey_id = pt.journey_id and person_id = pt.person_id and status <> 'cancelled' and id <> p_pid) then raise exception 'already_participant'; end if;
    v_new := 'active'; v_title := 'Jornada reaberta';
  else raise exception 'invalid_status'; end if;
  if p_action in ('start','resume','reopen') and j.status <> 'active' then raise exception 'journey_not_active'; end if;
  update journey_participants set status = v_new, updated_at = now(), started_on = case when v_new = 'active' and started_on is null then public.jr_today() else started_on end,
         completed_at = case when v_new = 'completed' then now() when p_action = 'reopen' then null else completed_at end,
         cancel_reason = case when v_new = 'cancelled' then (case when v_self then 'left' else 'staff' end) else null end where id = p_pid;
  perform public.jr_log(j.id, p_pid, pt.org_id, 'status', jsonb_build_object('from', pt.status, 'to', v_new, 'action', p_action));
  perform public.jr_history(p_pid, v_title, null, p_action || ':' || p_pid || ':' || extract(epoch from clock_timestamp())::bigint);
  if v_new = 'completed' then perform public.jr_notify(j.id, 'done', v_pu, 'Você concluiu uma jornada. Parabéns!', '#/jornadas/' || p_pid, not pt.notify); end if;
  if v_new = 'active' and p_action in ('start','reopen') then perform public.jr_notify(j.id, 'enroll', v_pu, 'Sua jornada começou', '#/jornadas/' || p_pid, not pt.notify); perform public.jr_auto_sync(p_pid); perform public.jr_recalc(p_pid); end if;
  if v_new = 'active' and p_action = 'resume' then perform public.jr_recalc(p_pid); end if;
  return jsonb_build_object('ok', true, 'status', v_new);
end $$;

create or replace function public.journey_assign(p_pid uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into j from journeys where id = pt.journey_id;
  if not (public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants')) then raise exception 'forbidden'; end if;
  perform public.jr_check_follower(pt.org_id, p_user);
  if p_user is not distinct from pt.responsible_id then return jsonb_build_object('ok', true, 'changed', false); end if;
  update journey_participants set responsible_id = p_user, updated_at = now() where id = p_pid;
  perform public.jr_log(j.id, p_pid, pt.org_id, 'assign', jsonb_build_object('from', pt.responsible_id, 'to', p_user));
  perform public.jr_history(p_pid, 'Responsável da jornada alterado', null, 'assign:' || p_pid || ':' || extract(epoch from clock_timestamp())::bigint);
  perform public.jr_notify(j.id, 'assign', p_user, 'Você acompanha uma pessoa em uma jornada', '#/gestao-jornadas/' || j.id);
  perform public.jr_notify(j.id, 'responsible', public.jr_person_user(pt.person_id), 'O responsável pela sua jornada mudou', '#/jornadas/' || p_pid, not pt.notify);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.journey_notify_pref(p_pid uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.jr_is_self(p_pid) then raise exception 'forbidden'; end if;
  update journey_participants set notify = coalesce(p_on, true) where id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- acompanhamento: lista e detalhe
create or replace function public.journey_participants_list(p_journey uuid, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j journeys; v_all boolean; v_q text := nullif(trim(coalesce(p->>'q', '')), ''); v_status text := nullif(p->>'status', ''); v_resp uuid := nullif(p->>'responsible', '')::uuid; v_step uuid := nullif(p->>'step', '')::uuid;
        v_sf date; v_st date; v_cf date; v_ct date; v_res jsonb; v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 50), 1), 200);
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not public.jr_staff_of(p_journey) then raise exception 'forbidden'; end if;
  v_all := public.jr_can(j.org_id, 'admin') or public.jr_can(j.org_id, 'participants') or public.jr_can(j.org_id, 'indicators') or j.owner_id = auth.uid();
  begin v_sf := nullif(p->>'started_from', '')::date; v_st := nullif(p->>'started_to', '')::date; v_cf := nullif(p->>'completed_from', '')::date; v_ct := nullif(p->>'completed_to', '')::date; exception when others then raise exception 'invalid_date'; end;
  if v_status is not null and v_status not in ('waiting','active','paused','completed','cancelled') then raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(x.j order by x.nm), '[]'::jsonb) into v_res from (
    select pe.full_name as nm, jsonb_build_object('id', pt.id, 'person_id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'status', pt.status, 'source', pt.source,
        'responsible_id', pt.responsible_id, 'responsible_name', case when pt.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, pt.responsible_id), 'Usuário removido') end,
        'started_on', pt.started_on, 'completed_at', pt.completed_at, 'pct', public.jr_pct(pt.id), 'step', (select name from public.jr_current(pt.id)), 'step_id', (select step_id from public.jr_current(pt.id)),
        'pending_approvals', (select count(*) from journey_completions c where c.participant_id = pt.id and c.status = 'pending_approval')) as j
      from journey_participants pt join people pe on pe.id = pt.person_id
     where pt.journey_id = p_journey and (v_all or pt.responsible_id = auth.uid() or public.jr_level(pt.id) is not null)
       and (v_q is null or pe.full_name ilike '%' || v_q || '%') and (v_status is null or pt.status = v_status) and (v_resp is null or pt.responsible_id = v_resp)
       and (v_sf is null or pt.started_on >= v_sf) and (v_st is null or pt.started_on <= v_st)
       and (v_cf is null or pt.completed_at::date >= v_cf) and (v_ct is null or pt.completed_at::date <= v_ct)
       and (v_step is null or (select step_id from public.jr_current(pt.id)) = v_step)
     limit v_lim) x;
  return jsonb_build_object('items', v_res);
end $$;

-- detalhe de uma participação: a própria pessoa vê tudo da sua jornada; quem acompanha vê dentro do seu escopo
create or replace function public.journey_participant_get(p_pid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; pe people; v_lvl text; v_self boolean; v_steps jsonb; v_approve boolean; v_cur uuid; v_staff boolean;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  select * into j from journeys where id = pt.journey_id; select * into pe from people where id = pt.person_id;
  if pt.status = 'active' then perform public.jr_auto_sync(p_pid); select * into pt from journey_participants where id = p_pid; end if;
  v_staff := v_lvl in ('staff','manager'); v_approve := public.jr_can(pt.org_id, 'approve') and v_lvl <> 'none';
  select step_id into v_cur from public.jr_current(p_pid);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.step_id, 'name', s.name, 'position', s.pos, 'description', st.description, 'responsible_name', case when st.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, st.responsible_id), 'Usuário removido') end,
      'unlocked', s.unlocked, 'complete', s.complete, 'rule', st.completion_rule, 'req_total', s.req_total, 'req_done', s.req_done, 'current', s.step_id = v_cur,
      'can_confirm', st.completion_rule = 'manual' and s.req_done = s.req_total and not s.confirmed and v_lvl <> 'none' and (v_staff or st.responsible_id = auth.uid()),
      'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'kind', a.kind, 'required', a.required, 'mode', a.completion_mode, 'description', a.description,
          'instructions', case when s.unlocked or v_staff then a.instructions end, 'content_url', case when s.unlocked or v_staff then a.content_url end, 'content_text', case when s.unlocked or v_staff then a.content_text end,
          'event', case when a.event_id is null then null else (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'location', e.location) from church_events e where e.id = a.event_id) end,
          'responsible_name', case when a.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, a.responsible_id), 'Usuário removido') end,
          'state', case when c.status = 'done' then 'done' when c.status = 'pending_approval' then 'pending' when not s.unlocked then 'locked' else 'todo' end,
          'answer', c.answer, 'done_at', c.done_at, 'done_source', c.source,
          'can_complete', pt.status = 'active' and j.status = 'active' and s.unlocked and c.id is null and ((v_self and a.completion_mode in ('self','approval')) or (a.completion_mode = 'responsible' and v_lvl <> 'none' and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid()))),
          'can_approve', c.status = 'pending_approval' and v_approve and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid()),
          'can_reopen', c.id is not null and pt.status = 'active' and ((v_self and c.source = 'self') or (v_lvl <> 'none' and (v_staff or a.responsible_id = auth.uid() or st.responsible_id = auth.uid())))
        ) order by a.position, a.created_at)
        from journey_activities a left join journey_completions c on c.activity_id = a.id and c.participant_id = p_pid
        where a.step_id = s.step_id and (a.removed_at is null or c.id is not null)), '[]'::jsonb)) order by s.pos), '[]'::jsonb) into v_steps
    from public.jr_steps(p_pid) s join journey_steps st on st.id = s.step_id
    where v_self or v_lvl in ('staff','manager') or st.responsible_id = auth.uid() or exists (select 1 from journey_activities a2 where a2.step_id = s.step_id and a2.removed_at is null and a2.responsible_id = auth.uid());
  return jsonb_build_object('id', pt.id, 'journey', jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'image_url', j.image_url, 'status', j.status, 'step_mode', j.step_mode, 'visibility', j.visibility),
    'person', jsonb_build_object('id', pe.id, 'name', pe.full_name, 'photo_url', pe.photo_url, 'can_open', public.people_scope_all(pt.org_id) and public.has_people_perm(pt.org_id, 'people_view')),
    'status', pt.status, 'started_on', pt.started_on, 'completed_at', pt.completed_at, 'source', pt.source, 'notify', pt.notify, 'pct', public.jr_pct(p_pid),
    'responsible_id', pt.responsible_id, 'responsible_name', case when pt.responsible_id is null then null else coalesce(public.welcome_name(pt.org_id, pt.responsible_id), 'Usuário removido') end,
    'self', v_self, 'level', nullif(v_lvl, 'none'), 'steps', v_steps, 'pending_total', (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(p_pid)),
    'can_manage', v_lvl in ('staff','manager'), 'can_assign', public.jr_can(pt.org_id, 'admin') or public.jr_can(pt.org_id, 'participants'), 'can_force', public.jr_can(pt.org_id, 'admin'),
    'notes', case when v_lvl <> 'none' then coalesce((select jsonb_agg(jsonb_build_object('text', l.detail->>'text', 'at', l.at, 'by', coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido')) order by l.at desc)
              from (select * from journey_log where participant_id = p_pid and action = 'note' order by at desc limit 30) l), '[]'::jsonb) else '[]'::jsonb end,
    'log', case when v_lvl <> 'none' then coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail - 'text', 'at', l.at, 'by', case when l.actor is null then 'Sistema' else coalesce(public.welcome_name(l.org_id, l.actor), 'Usuário removido') end) order by l.at desc, l.id desc)
              from (select * from journey_log where participant_id = p_pid and action <> 'note' order by at desc, id desc limit 60) l), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- registrar conclusão / aprovar / recusar / reabrir
create or replace function public.journey_record(p_pid uuid, p_activity uuid, p_action text, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; j journeys; a journey_activities; st journey_steps; c journey_completions; v_lvl text; v_self boolean; v_unlocked boolean; v_scope boolean; v_text text := nullif(trim(coalesce(p_text, '')), ''); v_pu uuid; v_resp uuid;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into a from journey_activities where id = p_activity and journey_id = pt.journey_id; if a.id is null then raise exception 'not_found'; end if;
  select * into st from journey_steps where id = a.step_id; select * into j from journeys where id = pt.journey_id;
  v_lvl := coalesce(public.jr_level(p_pid), 'none'); v_self := public.jr_is_self(p_pid); v_pu := public.jr_person_user(pt.person_id); v_resp := coalesce(a.responsible_id, pt.responsible_id, j.owner_id);
  if v_lvl = 'none' and not v_self then raise exception 'forbidden'; end if;
  if length(coalesce(v_text, '')) > 2000 then raise exception 'text_too_long'; end if;
  v_scope := v_lvl in ('staff','manager') or (v_lvl <> 'none' and coalesce(a.responsible_id = auth.uid() or st.responsible_id = auth.uid(), false));
  select * into c from journey_completions where participant_id = p_pid and activity_id = p_activity;
  if p_action in ('complete') then
    if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
    if j.status <> 'active' then raise exception 'journey_not_active'; end if;
    if a.removed_at is not null or st.removed_at is not null then raise exception 'not_found'; end if;
    if c.id is not null then raise exception 'already_done'; end if;
    select unlocked into v_unlocked from public.jr_steps(p_pid) where step_id = a.step_id; if not coalesce(v_unlocked, false) then raise exception 'step_locked'; end if;
    if a.completion_mode = 'auto' then raise exception 'auto_only'; end if;
    if a.completion_mode in ('self','approval') then
      if not v_self then raise exception 'forbidden'; end if;
      insert into journey_completions (participant_id, activity_id, org_id, status, source, answer, done_by) values (p_pid, p_activity, pt.org_id, case when a.completion_mode = 'approval' then 'pending_approval' else 'done' end, 'self', v_text, auth.uid());
    else
      if not v_scope then raise exception 'forbidden'; end if;
      insert into journey_completions (participant_id, activity_id, org_id, status, source, answer, done_by) values (p_pid, p_activity, pt.org_id, 'done', 'responsible', v_text, auth.uid());
    end if;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'activity_done', jsonb_build_object('activity', a.title, 'pending', a.completion_mode = 'approval'));
    if a.completion_mode = 'approval' then
      perform public.jr_notify(j.id, 'approve', v_resp, 'Uma atividade aguarda a sua aprovação', '#/gestao-jornadas/' || j.id);
    else
      perform public.jr_history(p_pid, 'Atividade concluída', a.title, 'act:' || p_pid || ':' || a.id);
    end if;
  elsif p_action in ('approve','reject') then
    if c.id is null or c.status <> 'pending_approval' then raise exception 'nothing_to_approve'; end if;
    if not (public.jr_can(pt.org_id, 'approve') and v_scope) then raise exception 'forbidden'; end if;
    if p_action = 'approve' then
      update journey_completions set status = 'done', approved_by = auth.uid(), approved_at = now() where id = c.id;
      perform public.jr_history(p_pid, 'Atividade concluída', a.title, 'act:' || p_pid || ':' || a.id);
    else delete from journey_completions where id = c.id; end if;
    perform public.jr_log(j.id, p_pid, pt.org_id, case when p_action = 'approve' then 'approve' else 'reject' end, jsonb_build_object('activity', a.title, 'note', v_text));
    perform public.jr_notify(j.id, 'approve', v_pu, case when p_action = 'approve' then 'Sua atividade foi aprovada' else 'Sua atividade precisa ser refeita' end, '#/jornadas/' || p_pid, not pt.notify);
  elsif p_action = 'reopen' then
    if c.id is null then raise exception 'nothing_to_reopen'; end if;
    if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
    if not ((v_self and c.source = 'self') or v_scope) then raise exception 'forbidden'; end if;
    delete from journey_completions where id = c.id;
    perform public.jr_log(j.id, p_pid, pt.org_id, 'activity_reopen', jsonb_build_object('activity', a.title));
  else raise exception 'invalid_action'; end if;
  perform public.jr_recalc(p_pid);
  return jsonb_build_object('ok', true, 'pct', public.jr_pct(p_pid), 'status', (select status from journey_participants where id = p_pid));
end $$;

create or replace function public.journey_step_confirm(p_pid uuid, p_step uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; st journey_steps; v_lvl text; r record;
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  select * into st from journey_steps where id = p_step and journey_id = pt.journey_id and removed_at is null; if st.id is null then raise exception 'not_found'; end if;
  v_lvl := coalesce(public.jr_level(p_pid), 'none');
  if not (v_lvl in ('staff','manager') or (v_lvl <> 'none' and coalesce(st.responsible_id = auth.uid(), false))) then raise exception 'forbidden'; end if;
  if pt.status <> 'active' then raise exception 'participation_not_active'; end if;
  if st.completion_rule <> 'manual' then raise exception 'invalid_action'; end if;
  select * into r from public.jr_steps(p_pid) where step_id = p_step;
  if r.req_done <> r.req_total then raise exception 'required_pending'; end if;
  insert into journey_step_progress (participant_id, step_id, confirmed_by, confirmed_at) values (p_pid, p_step, auth.uid(), now())
    on conflict (participant_id, step_id) do update set confirmed_by = auth.uid(), confirmed_at = now();
  perform public.jr_log(pt.journey_id, p_pid, pt.org_id, 'step_confirm', jsonb_build_object('name', st.name));
  perform public.jr_history(p_pid, 'Etapa concluída', st.name, 'step:' || p_pid || ':' || p_step);
  perform public.jr_recalc(p_pid);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.journey_note_add(p_pid uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt journey_participants; v_text text := trim(coalesce(p_text, ''));
begin
  select * into pt from journey_participants where id = p_pid; if pt.id is null then raise exception 'not_found'; end if;
  if public.jr_level(p_pid) is null then raise exception 'forbidden'; end if;
  if length(v_text) < 1 then raise exception 'body_required'; end if; if length(v_text) > 500 then raise exception 'text_too_long'; end if;
  perform public.jr_log(pt.journey_id, p_pid, pt.org_id, 'note', jsonb_build_object('text', v_text));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Minhas Jornadas
create or replace function public.journey_mine(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_people uuid[]; v_cls text; v_mine jsonb; v_av jsonb; r record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  select array_agg(id) into v_people from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending');
  for r in select pt.id from journey_participants pt where pt.person_id = any (coalesce(v_people, '{}')) and pt.status = 'active' loop perform public.jr_auto_sync(r.id); end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', pt.id, 'status', pt.status, 'started_on', pt.started_on, 'completed_at', pt.completed_at, 'pct', public.jr_pct(pt.id), 'journey_id', j.id, 'name', j.name, 'description', j.description,
        'image_url', j.image_url, 'journey_status', j.status, 'step', (select name from public.jr_current(pt.id)), 'pending', (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id))) order by (pt.status in ('completed','cancelled')), pt.created_at desc), '[]'::jsonb) into v_mine
    from journey_participants pt join journeys j on j.id = pt.journey_id where pt.person_id = any (coalesce(v_people, '{}')) and not (pt.status = 'cancelled' and pt.cancel_reason = 'declined');
  select classification into v_cls from people where id = (v_people)[1];
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'image_url', j.image_url) order by j.created_at desc), '[]'::jsonb) into v_av
    from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and v_people is not null
     and (j.eligible_classes is null or v_cls = any (j.eligible_classes))
     and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_people) and x.status <> 'cancelled');
  return jsonb_build_object('mine', v_mine, 'available', v_av, 'has_person', v_people is not null,
    'staff', public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants') or public.jr_can(p_org, 'follow') or public.jr_can(p_org, 'indicators'));
end $$;

create or replace function public.journey_public_get(p_journey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where id = p_journey; if j.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = j.org_id and user_id = auth.uid()) or j.visibility <> 'public' or j.status <> 'active' then raise exception 'forbidden'; end if;
  return jsonb_build_object('id', j.id, 'name', j.name, 'description', j.description, 'objective', j.objective, 'audience', j.audience, 'image_url', j.image_url, 'can_enroll', j.enroll_voluntary,
    'steps', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'description', s.description) order by s.position) from journey_steps s where s.journey_id = j.id and s.removed_at is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- Ficha e Novos Convertidos
create or replace function public.journey_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from people where id = p_person; if pe.id is null then raise exception 'not_found'; end if;
  if not (public.jr_can(pe.org_id, 'admin') or public.jr_can(pe.org_id, 'participants') or public.jr_can(pe.org_id, 'follow')) then return jsonb_build_object('allowed', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('allowed', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', pt.id, 'journey_id', j.id, 'name', j.name, 'status', pt.status, 'started_on', pt.started_on, 'pct', public.jr_pct(pt.id), 'journey_status', j.status) order by pt.created_at desc)
      from journey_participants pt join journeys j on j.id = pt.journey_id where pt.person_id = p_person and public.jr_level(pt.id) is not null), '[]'::jsonb));
end $$;

create or replace function public.convert_journeys(p_decision uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions;
begin
  select * into d from faith_decisions where id = p_decision and voided_at is null; if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'view') or (public.conv_can(d.org_id, 'followup') and d.responsible_id = auth.uid())) then raise exception 'forbidden'; end if;
  return jsonb_build_object('person_id', d.person_id,
    'can_offer', d.person_id is not null and public.conv_can(d.org_id, 'followup') and (d.responsible_id = auth.uid() or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin')),
    'offerable', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name) order by j.name) from journeys j where j.org_id = d.org_id and j.status = 'active' and j.for_converts
        and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = d.person_id and x.status <> 'cancelled')), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(jsonb_build_object('id', pt.id, 'journey_id', j.id, 'name', j.name, 'status', pt.status, 'pct', public.jr_pct(pt.id), 'cancel_reason', pt.cancel_reason) order by pt.created_at desc)
        from journey_participants pt join journeys j on j.id = pt.journey_id where pt.decision_id = d.id), '[]'::jsonb));
end $$;

create or replace function public.journey_offer(p_decision uuid, p_journey uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d faith_decisions; j journeys; pe people; v_id uuid; v_resp uuid;
begin
  select * into d from faith_decisions where id = p_decision and voided_at is null; if d.id is null then raise exception 'not_found'; end if;
  if not (public.conv_can(d.org_id, 'followup') and (d.responsible_id = auth.uid() or public.conv_can(d.org_id, 'assign') or public.conv_can(d.org_id, 'admin'))) then raise exception 'forbidden'; end if;
  if d.person_id is null then raise exception 'link_required'; end if;
  select * into j from journeys where id = p_journey and org_id = d.org_id; if j.id is null then raise exception 'not_found'; end if;
  if not j.for_converts then raise exception 'not_for_converts'; end if;
  if j.status <> 'active' then raise exception 'journey_not_active'; end if;
  select * into pe from people where id = d.person_id;
  v_resp := case when d.responsible_id is not null and d.responsible_id in (select public.jr_users(d.org_id, 'follow')) then d.responsible_id else j.owner_id end;
  begin
    insert into journey_participants (journey_id, org_id, person_id, status, responsible_id, source, decision_id, added_by) values (p_journey, d.org_id, d.person_id, 'waiting', v_resp, 'convert', d.id, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'already_participant'; end;
  perform public.jr_log(p_journey, v_id, d.org_id, 'offer', jsonb_build_object('decision_id', d.id));
  perform public.conv_log(d.id, d.org_id, 'journey_offer', jsonb_build_object('journey_id', p_journey, 'participant_id', v_id));
  perform public.jr_history(v_id, 'Convidado(a) para uma jornada', null, 'enroll:' || v_id);
  perform public.jr_notify(p_journey, 'invite', pe.user_id, 'Você foi convidado(a) para uma jornada', '#/jornadas/' || v_id);
  return jsonb_build_object('saved', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- indicadores (registros reais, sem leitura espiritual)
create or replace function public.journey_indicators(p_org uuid, p_journey uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  if not (public.jr_can(p_org, 'indicators') or public.jr_can(p_org, 'admin')) then raise exception 'forbidden'; end if;
  with pt as (select * from journey_participants where org_id = p_org and (p_journey is null or journey_id = p_journey) and (p_from is null or started_on >= p_from) and (p_to is null or started_on <= p_to))
  select jsonb_build_object(
    'participants', (select count(*) from pt where status <> 'cancelled'),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'n', n) order by s) from (select status s, count(*) n from pt group by 1) x), '[]'::jsonb),
    'steps_done', (select count(*) from journey_step_progress sp where sp.participant_id in (select id from pt)),
    'pending_approvals', (select count(*) from journey_completions c where c.participant_id in (select id from pt) and c.status = 'pending_approval'),
    'by_journey', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'participants', (select count(*) from pt where pt.journey_id = j.id and pt.status <> 'cancelled'),
        'active', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'active'), 'paused', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'paused'),
        'completed', (select count(*) from pt where pt.journey_id = j.id and pt.status = 'completed')) order by j.name) from journeys j where j.org_id = p_org and (p_journey is null or j.id = p_journey)), '[]'::jsonb)) into v_res;
  return v_res;
end $$;


-- busca de pessoas para incluir em jornada (não exige acesso à base inteira de pessoas)
create or replace function public.journey_people_search(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if not (public.jr_can(p_org, 'admin') or public.jr_can(p_org, 'participants')) then raise exception 'forbidden'; end if;
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'classification', x.classification, 'photo_url', x.photo_url) order by x.full_name)
    from (select id, full_name, classification, photo_url from people where org_id = p_org and status in ('active','inactive','pending') and full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' order by full_name limit 12) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.journey_save(uuid, uuid, jsonb, int), public.journey_set_status(uuid, text, int), public.journey_duplicate(uuid), public.journey_step_save(uuid, uuid, jsonb, int), public.journey_step_remove(uuid, int),
  public.journey_activity_save(uuid, uuid, jsonb, int), public.journey_activity_remove(uuid, int), public.journey_reorder(text, uuid, uuid[], int), public.journey_list(uuid, jsonb), public.journey_get(uuid),
  public.journey_responsibles(uuid), public.journey_enroll(uuid, uuid, uuid, boolean), public.journey_self_enroll(uuid), public.journey_apply_rule(uuid), public.journey_respond(uuid, boolean),
  public.journey_participant_status(uuid, text, boolean), public.journey_assign(uuid, uuid), public.journey_notify_pref(uuid, boolean), public.journey_participants_list(uuid, jsonb), public.journey_participant_get(uuid),
  public.journey_record(uuid, uuid, text, text), public.journey_step_confirm(uuid, uuid), public.journey_note_add(uuid, text), public.journey_mine(uuid), public.journey_public_get(uuid),
  public.journey_for_person(uuid), public.convert_journeys(uuid), public.journey_offer(uuid, uuid), public.journey_indicators(uuid, uuid, date, date), public.journey_people_search(uuid, text) from public, anon;
grant execute on function
  public.journey_save(uuid, uuid, jsonb, int), public.journey_set_status(uuid, text, int), public.journey_duplicate(uuid), public.journey_step_save(uuid, uuid, jsonb, int), public.journey_step_remove(uuid, int),
  public.journey_activity_save(uuid, uuid, jsonb, int), public.journey_activity_remove(uuid, int), public.journey_reorder(text, uuid, uuid[], int), public.journey_list(uuid, jsonb), public.journey_get(uuid),
  public.journey_responsibles(uuid), public.journey_enroll(uuid, uuid, uuid, boolean), public.journey_self_enroll(uuid), public.journey_apply_rule(uuid), public.journey_respond(uuid, boolean),
  public.journey_participant_status(uuid, text, boolean), public.journey_assign(uuid, uuid), public.journey_notify_pref(uuid, boolean), public.journey_participants_list(uuid, jsonb), public.journey_participant_get(uuid),
  public.journey_record(uuid, uuid, text, text), public.journey_step_confirm(uuid, uuid), public.journey_note_add(uuid, text), public.journey_mine(uuid), public.journey_public_get(uuid),
  public.journey_for_person(uuid), public.convert_journeys(uuid), public.journey_offer(uuid, uuid), public.journey_indicators(uuid, uuid, date, date), public.journey_people_search(uuid, text) to authenticated;

-- Conferência (retorna true):
--   select to_regclass('public.journeys') is not null
--      and to_regprocedure('public.journey_save(uuid,uuid,jsonb,integer)') is not null
--      and to_regprocedure('public.journey_record(uuid,uuid,text,text)') is not null
--      and 'people_journeys_admin' = any (public.all_actions()) as ok;
