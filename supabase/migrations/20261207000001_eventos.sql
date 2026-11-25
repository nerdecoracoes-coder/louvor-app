-- =====================================================================
-- SOMOS — Fase 2: Eventos com inscrição, ingresso digital (QR), lista de espera e check-in.
--  * Tabelas novas (a agenda simples `church_events` não é alterada). Nada é apagado: cancelar guarda motivo e histórico.
--  * Permissões novas: ev_view (ver tudo e as inscrições), ev_manage (criar/editar), ev_publish (publicar/cancelar/encerrar), ev_checkin (check-in).
--    Administrador da igreja tem tudo; ser líder ou integrante não dá acesso. Desenvolvedor não tem atalho.
--  * Inscrição pelo próprio app (conta obrigatória): confirma na hora ou entra na lista de espera; ao cancelar, o próximo da fila é promovido e avisado.
--  * Pagamento/ingresso pago NÃO está incluído (depende de provedor de pagamento e credenciais).
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin']::text[]
$$;

create table if not exists public.ev_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  location text check (location is null or length(location) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz,
  image_url text check (image_url is null or length(image_url) <= 600),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  registration text not null default 'none' check (registration in ('none','open','closed')),
  capacity int check (capacity is null or capacity between 1 and 100000),
  reg_opens_at timestamptz,
  reg_closes_at timestamptz,
  max_guests int not null default 0 check (max_guests between 0 and 10),
  status text not null default 'draft' check (status in ('draft','published','cancelled','finished')),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (ends_at is null or ends_at >= starts_at),
  check (reg_opens_at is null or reg_closes_at is null or reg_closes_at >= reg_opens_at)
);
create index if not exists ev_events_org on public.ev_events (org_id, status, starts_at);
alter table public.ev_events enable row level security;
revoke all on public.ev_events from anon, authenticated;

create table if not exists public.ev_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  guests int not null default 0 check (guests between 0 and 10),
  status text not null default 'confirmed' check (status in ('confirmed','waitlist','cancelled')),
  code text not null unique,
  source text not null default 'self' check (source in ('self','admin')),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  checked_in_count int not null default 0 check (checked_in_count between 0 and 11),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ev_reg_one_active on public.ev_registrations (event_id, user_id) where status <> 'cancelled' and user_id is not null;
create index if not exists ev_reg_event on public.ev_registrations (event_id, status, created_at);
create index if not exists ev_reg_user on public.ev_registrations (user_id, status);
alter table public.ev_registrations enable row level security;
revoke all on public.ev_registrations from anon, authenticated;

-- ---------------------------------------------------------------- auxiliares
create or replace function public.ev_staff(p_org uuid, p_actions text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.actions && p_actions))
$$;
create or replace function public.ev_need(p_org uuid, p_actions text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.ev_staff(p_org, p_actions) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.ev_eligible(e public.ev_events, pe public.people) returns boolean
language sql stable as $$ select e.audience = 'all' or (pe.id is not null and pe.classification = e.audience) $$;
create or replace function public.ev_seats(p_event uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(1 + guests), 0)::int from ev_registrations where event_id = p_event and status = 'confirmed'
$$;
-- situação das inscrições: none | open | full (entra na espera) | not_yet | closed | ended | unavailable
create or replace function public.ev_reg_state(e public.ev_events) returns text
language sql stable security definer set search_path = public as $$
  select case when e.status <> 'published' then 'unavailable'
    when coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then 'ended'
    when e.registration = 'none' then 'none'
    when e.registration = 'closed' then 'closed'
    when e.reg_opens_at is not null and e.reg_opens_at > now() then 'not_yet'
    when e.reg_closes_at is not null and e.reg_closes_at < now() then 'closed'
    when e.capacity is not null and public.ev_seats(e.id) >= e.capacity then 'full'
    else 'open' end
$$;
create or replace function public.ev_newcode() returns text
language plpgsql volatile as $$
declare c text; begin
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 10));
    exit when not exists (select 1 from ev_registrations where code = c);
  end loop; return c;
end $$;
create or replace function public.ev_pname(p_user uuid, p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(trim(social_name), ''), full_name) from people where id = p_person), (select full_name from profiles where id = p_user), 'Participante')
$$;
-- promove quem está na espera enquanto couber
create or replace function public.ev_promote(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e ev_events; g record; n int := 0;
begin
  select * into e from ev_events where id = p_event; if e.id is null or e.status <> 'published' then return 0; end if;
  for g in select * from ev_registrations where event_id = p_event and status = 'waitlist' order by created_at loop
    if e.capacity is null or public.ev_seats(p_event) + 1 + g.guests <= e.capacity then
      update ev_registrations set status = 'confirmed' where id = g.id; n := n + 1;
      if g.user_id is not null then perform public.notify_user(g.user_id, e.org_id, 'event_promoted', 'Sua vaga foi confirmada', e.title || ' · ' || to_char(e.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#/meus-ingressos', jsonb_build_object('event_id', e.id)); end if;
    else exit; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.ev_staff(uuid, text[]), public.ev_need(uuid, text[]), public.ev_seats(uuid), public.ev_reg_state(public.ev_events), public.ev_newcode(),
  public.ev_pname(uuid, uuid), public.ev_promote(uuid), public.ev_eligible(public.ev_events, public.people) from public, anon, authenticated;

-- ---------------------------------------------------------------- gestão
create or replace function public.event_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ev_events; v_id uuid := p_id; v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_reg text := coalesce(nullif(p->>'registration', ''), 'none');
        v_cap int := nullif(p->>'capacity', '')::int; v_st timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_en timestamptz := nullif(p->>'ends_at', '')::timestamptz;
        v_ro timestamptz := nullif(p->>'reg_opens_at', '')::timestamptz; v_rc timestamptz := nullif(p->>'reg_closes_at', '')::timestamptz; v_g int := coalesce(nullif(p->>'max_guests', '')::int, 0);
begin
  perform public.ev_need(p_org, array['ev_manage']);
  if length(trim(coalesce(p->>'title', ''))) = 0 then raise exception 'title_required'; end if;
  if v_st is null then raise exception 'date_required'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'invalid_audience'; end if;
  if v_reg not in ('none','open','closed') then raise exception 'invalid_registration'; end if;
  if v_en is not null and v_en < v_st then raise exception 'invalid_period'; end if;
  if v_ro is not null and v_rc is not null and v_rc < v_ro then raise exception 'invalid_period'; end if;
  begin
    if p_id is null then
      insert into ev_events (org_id, title, description, location, starts_at, ends_at, image_url, audience, registration, capacity, reg_opens_at, reg_closes_at, max_guests, created_by)
      values (p_org, trim(p->>'title'), nullif(trim(coalesce(p->>'description', '')), ''), nullif(trim(coalesce(p->>'location', '')), ''), v_st, v_en, nullif(p->>'image_url', ''), v_aud, v_reg, v_cap, v_ro, v_rc, v_g, auth.uid()) returning id into v_id;
      perform public.mod_log(p_org, 'events', 'event', v_id, 'create', null, jsonb_build_object('title', p->>'title'));
    else
      select * into e from ev_events where id = p_id and org_id = p_org for update; if e.id is null then raise exception 'not_found'; end if;
      if e.status in ('cancelled','finished') then raise exception 'event_closed'; end if;
      if v_cap is not null and public.ev_seats(p_id) > v_cap then raise exception 'capacity_below_registered'; end if;
      update ev_events set title = trim(p->>'title'), description = nullif(trim(coalesce(p->>'description', '')), ''), location = nullif(trim(coalesce(p->>'location', '')), ''), starts_at = v_st, ends_at = v_en,
        image_url = nullif(p->>'image_url', ''), audience = v_aud, registration = v_reg, capacity = v_cap, reg_opens_at = v_ro, reg_closes_at = v_rc, max_guests = v_g, updated_at = now() where id = p_id;
      perform public.mod_log(p_org, 'events', 'event', p_id, 'update', null, jsonb_build_object('before', to_jsonb(e) - 'created_by', 'title', p->>'title'));
      if v_cap is distinct from e.capacity or v_reg <> e.registration then perform public.ev_promote(p_id); end if;
    end if;
  exception when check_violation then raise exception 'invalid_data'; end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- publicar, cancelar (com motivo; avisa quem se inscreveu), encerrar (só depois do início) ou voltar a rascunho (só sem inscrições)
create or replace function public.event_set_status(p_id uuid, p_action text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ev_events; g record;
begin
  select * into e from ev_events where id = p_id for update; if e.id is null then raise exception 'not_found'; end if;
  perform public.ev_need(e.org_id, array['ev_publish']);
  if p_action = 'publish' then
    if e.status <> 'draft' then raise exception 'invalid_status'; end if;
    update ev_events set status = 'published', published_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'draft' then
    if e.status <> 'published' or exists (select 1 from ev_registrations where event_id = p_id and status <> 'cancelled') then raise exception 'invalid_status'; end if;
    update ev_events set status = 'draft', updated_at = now() where id = p_id;
  elsif p_action = 'cancel' then
    if e.status not in ('draft','published') then raise exception 'invalid_status'; end if;
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'reason_required'; end if;
    update ev_events set status = 'cancelled', cancel_reason = left(trim(p_reason), 300), updated_at = now() where id = p_id;
    for g in select distinct user_id from ev_registrations where event_id = p_id and status in ('confirmed','waitlist') and user_id is not null loop
      perform public.notify_user(g.user_id, e.org_id, 'event_cancelled', 'Evento cancelado', e.title || ' · ' || left(trim(p_reason), 120), '#/meus-ingressos', jsonb_build_object('event_id', e.id));
    end loop;
  elsif p_action = 'finish' then
    if e.status <> 'published' or e.starts_at > now() then raise exception 'invalid_status'; end if;
    update ev_events set status = 'finished', updated_at = now() where id = p_id;
  else raise exception 'invalid_action'; end if;
  perform public.mod_log(e.org_id, 'events', 'event', p_id, p_action, p_reason, jsonb_build_object('title', e.title));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ev_counts(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('seats', coalesce(sum(1 + guests) filter (where status = 'confirmed'), 0), 'confirmed', count(*) filter (where status = 'confirmed'),
    'waitlist', count(*) filter (where status = 'waitlist'), 'cancelled', count(*) filter (where status = 'cancelled'),
    'present', coalesce(sum(checked_in_count) filter (where status = 'confirmed'), 0), 'checked', count(*) filter (where status = 'confirmed' and checked_in_at is not null))
  from ev_registrations where event_id = p_event
$$;
revoke execute on function public.ev_counts(uuid) from public, anon, authenticated;

create or replace function public.event_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ev_need(p_org, array['ev_view','ev_manage','ev_publish','ev_checkin']);
  return jsonb_build_object(
    'can', jsonb_build_object('manage', public.ev_staff(p_org, array['ev_manage']), 'publish', public.ev_staff(p_org, array['ev_publish']), 'checkin', public.ev_staff(p_org, array['ev_checkin']), 'view', public.ev_staff(p_org, array['ev_view'])),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'created_by' || jsonb_build_object('counts', public.ev_counts(e.id), 'state', public.ev_reg_state(e)) order by e.starts_at desc) from ev_events e where e.org_id = p_org), '[]'::jsonb));
end $$;

create or replace function public.event_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e ev_events;
begin
  select * into e from ev_events where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.ev_need(e.org_id, array['ev_view','ev_manage','ev_publish','ev_checkin']);
  return jsonb_build_object('event', to_jsonb(e) - 'created_by', 'counts', public.ev_counts(p_id), 'state', public.ev_reg_state(e),
    'can', jsonb_build_object('manage', public.ev_staff(e.org_id, array['ev_manage']), 'publish', public.ev_staff(e.org_id, array['ev_publish']), 'checkin', public.ev_staff(e.org_id, array['ev_checkin']), 'view', public.ev_staff(e.org_id, array['ev_view'])),
    'regs', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'guests', g.guests, 'status', g.status, 'source', g.source, 'checked_in_at', g.checked_in_at, 'checked_in_count', g.checked_in_count, 'created_at', g.created_at)
      order by case g.status when 'confirmed' then 0 when 'waitlist' then 1 else 2 end, lower(g.name)) from ev_registrations g where g.event_id = p_id), '[]'::jsonb));
end $$;

-- inscrição feita pela equipe (quem chegou sem se inscrever); só ultrapassa a capacidade com p_force
create or replace function public.event_register_admin(p_event uuid, p_person uuid, p_name text, p_guests int default 0, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ev_events; pe people; v_name text := nullif(trim(coalesce(p_name, '')), ''); v_status text := 'confirmed'; v_id uuid; v_code text; v_g int := coalesce(p_guests, 0);
begin
  select * into e from ev_events where id = p_event for update; if e.id is null then raise exception 'not_found'; end if;
  perform public.ev_need(e.org_id, array['ev_manage']);
  if e.status <> 'published' then raise exception 'event_not_open'; end if;
  if v_g < 0 or v_g > 10 then raise exception 'invalid_guests'; end if;
  if p_person is not null then select * into pe from people where id = p_person and org_id = e.org_id; if pe.id is null then raise exception 'not_found'; end if; v_name := coalesce(v_name, public.mod_pname(pe.id)); end if;
  if v_name is null then raise exception 'name_required'; end if;
  if pe.user_id is not null and exists (select 1 from ev_registrations where event_id = p_event and user_id = pe.user_id and status <> 'cancelled') then raise exception 'already_registered'; end if;
  if e.capacity is not null and public.ev_seats(p_event) + 1 + v_g > e.capacity and not coalesce(p_force, false) then v_status := 'waitlist'; end if;
  v_code := public.ev_newcode();
  insert into ev_registrations (event_id, org_id, user_id, person_id, name, guests, status, code, source) values (p_event, e.org_id, pe.user_id, pe.id, v_name, v_g, v_status, v_code, 'admin') returning id into v_id;
  perform public.mod_log(e.org_id, 'events', 'registration', v_id, 'register_admin', null, jsonb_build_object('event', e.title, 'status', v_status, 'forced', coalesce(p_force, false)));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'code', v_code);
end $$;

-- check-in por código do ingresso (QR) ou pela lista (id da inscrição); guarda quem fez e quantas pessoas entraram
create or replace function public.event_checkin(p_event uuid, p_code text, p_reg uuid default null, p_count int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ev_events; g ev_registrations; v_code text := upper(regexp_replace(regexp_replace(coalesce(p_code, ''), '^.*EV-', '', 'i'), '[^0-9A-Za-z]', '', 'g')); v_n int;
begin
  select * into e from ev_events where id = p_event; if e.id is null then raise exception 'not_found'; end if;
  perform public.ev_need(e.org_id, array['ev_checkin']);
  if e.status = 'cancelled' then return jsonb_build_object('result', 'event_cancelled'); end if;
  if e.status not in ('published','finished') then return jsonb_build_object('result', 'event_not_open'); end if;
  if p_reg is not null then select * into g from ev_registrations where id = p_reg and event_id = p_event;
  else select * into g from ev_registrations where code = v_code and event_id = p_event; end if;
  if g.id is null then
    if p_reg is null and exists (select 1 from ev_registrations where code = v_code) then return jsonb_build_object('result', 'other_event'); end if;
    return jsonb_build_object('result', 'not_found');
  end if;
  if g.status = 'cancelled' then return jsonb_build_object('result', 'cancelled', 'name', g.name); end if;
  if g.status = 'waitlist' then return jsonb_build_object('result', 'waitlist', 'name', g.name); end if;
  if g.checked_in_at is not null then return jsonb_build_object('result', 'already', 'name', g.name, 'at', g.checked_in_at, 'count', g.checked_in_count); end if;
  v_n := least(greatest(coalesce(p_count, 1 + g.guests), 1), 1 + g.guests);
  update ev_registrations set checked_in_at = now(), checked_in_by = auth.uid(), checked_in_count = v_n where id = g.id;
  perform public.mod_log(e.org_id, 'events', 'registration', g.id, 'checkin', null, jsonb_build_object('count', v_n));
  return jsonb_build_object('result', 'ok', 'name', g.name, 'count', v_n, 'guests', g.guests);
end $$;

create or replace function public.event_checkin_undo(p_reg uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g ev_registrations;
begin
  select * into g from ev_registrations where id = p_reg; if g.id is null then raise exception 'not_found'; end if;
  perform public.ev_need(g.org_id, array['ev_checkin']);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'reason_required'; end if;
  if g.checked_in_at is null then raise exception 'not_checked_in'; end if;
  update ev_registrations set checked_in_at = null, checked_in_by = null, checked_in_count = 0 where id = p_reg;
  perform public.mod_log(g.org_id, 'events', 'registration', p_reg, 'checkin_undo', p_reason, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- participante
create or replace function public.events_for_me(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest') then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'location', e.location, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'image_url', e.image_url,
      'status', e.status, 'cancel_reason', e.cancel_reason, 'state', public.ev_reg_state(e), 'capacity', e.capacity, 'spots', case when e.capacity is null then null else greatest(e.capacity - public.ev_seats(e.id), 0) end,
      'max_guests', e.max_guests, 'reg_opens_at', e.reg_opens_at, 'reg_closes_at', e.reg_closes_at,
      'mine', (select jsonb_build_object('id', g.id, 'status', g.status, 'guests', g.guests, 'code', g.code) from ev_registrations g where g.event_id = e.id and g.user_id = auth.uid() and g.status <> 'cancelled' limit 1))
    order by e.starts_at) from ev_events e
    where e.org_id = p_org and e.status in ('published','cancelled') and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() - interval '1 day' and public.ev_eligible(e, pe)
      and (e.status = 'published' or exists (select 1 from ev_registrations g where g.event_id = e.id and g.user_id = auth.uid() and g.status <> 'cancelled'))), '[]'::jsonb);
end $$;

create or replace function public.event_register(p_event uuid, p_guests int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ev_events; pe people; v_g int := coalesce(p_guests, 0); v_status text; v_id uuid; v_code text; v_state text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into e from ev_events where id = p_event for update; if e.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from org_members where org_id = e.org_id and user_id = auth.uid() and role <> 'guest') then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = e.org_id and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if e.status <> 'published' or not public.ev_eligible(e, pe) then raise exception 'not_found'; end if;
  v_state := public.ev_reg_state(e);
  if v_state not in ('open','full') then raise exception 'registration_%', v_state; end if;
  if v_g < 0 or v_g > e.max_guests then raise exception 'invalid_guests'; end if;
  if exists (select 1 from ev_registrations where event_id = p_event and user_id = auth.uid() and status <> 'cancelled') then raise exception 'already_registered'; end if;
  v_status := case when e.capacity is null or public.ev_seats(p_event) + 1 + v_g <= e.capacity then 'confirmed' else 'waitlist' end;
  v_code := public.ev_newcode();
  insert into ev_registrations (event_id, org_id, user_id, person_id, name, guests, status, code) values (p_event, e.org_id, auth.uid(), pe.id, public.ev_pname(auth.uid(), pe.id), v_g, v_status, v_code) returning id into v_id;
  perform public.notify_user(auth.uid(), e.org_id, 'event_registered', case v_status when 'confirmed' then 'Inscrição confirmada' else 'Você está na lista de espera' end,
    e.title || ' · ' || to_char(e.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#/meus-ingressos', jsonb_build_object('event_id', e.id));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'code', v_code);
end $$;

-- cancelar a própria inscrição (ou a equipe cancela a de alguém); libera a vaga para a lista de espera
create or replace function public.event_unregister(p_reg uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g ev_registrations; e ev_events; v_own boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into g from ev_registrations where id = p_reg for update; if g.id is null then raise exception 'not_found'; end if;
  select * into e from ev_events where id = g.event_id for update;
  v_own := g.user_id = auth.uid();
  if not v_own then perform public.ev_need(g.org_id, array['ev_manage']); end if;
  if g.status = 'cancelled' then raise exception 'already_cancelled'; end if;
  if g.checked_in_at is not null then raise exception 'already_checked_in'; end if;
  update ev_registrations set status = 'cancelled', cancelled_at = now() where id = p_reg;
  perform public.mod_log(g.org_id, 'events', 'registration', p_reg, case when v_own then 'unregister' else 'unregister_admin' end, p_reason, jsonb_build_object('event', e.title));
  if not v_own and g.user_id is not null then perform public.notify_user(g.user_id, g.org_id, 'event_unregistered', 'Sua inscrição foi cancelada', e.title, '#/meus-ingressos', jsonb_build_object('event_id', e.id)); end if;
  perform public.ev_promote(g.event_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.event_my_tickets(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'guests', g.guests, 'code', g.code, 'checked_in_at', g.checked_in_at, 'event_id', e.id, 'title', e.title, 'location', e.location,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'event_status', e.status, 'cancel_reason', e.cancel_reason, 'image_url', e.image_url,
      'position', case when g.status = 'waitlist' then (select count(*) + 1 from ev_registrations w where w.event_id = e.id and w.status = 'waitlist' and w.created_at < g.created_at) end)
    order by e.starts_at desc) from ev_registrations g join ev_events e on e.id = g.event_id where g.org_id = p_org and g.user_id = auth.uid() and g.status <> 'cancelled'), '[]'::jsonb);
end $$;

revoke execute on function public.event_save(uuid, uuid, jsonb), public.event_set_status(uuid, text, text), public.event_list(uuid), public.event_get(uuid), public.event_register_admin(uuid, uuid, text, int, boolean),
  public.event_checkin(uuid, text, uuid, int), public.event_checkin_undo(uuid, text), public.events_for_me(uuid), public.event_register(uuid, int), public.event_unregister(uuid, text), public.event_my_tickets(uuid) from public, anon;
grant execute on function public.event_save(uuid, uuid, jsonb), public.event_set_status(uuid, text, text), public.event_list(uuid), public.event_get(uuid), public.event_register_admin(uuid, uuid, text, int, boolean),
  public.event_checkin(uuid, text, uuid, int), public.event_checkin_undo(uuid, text), public.events_for_me(uuid), public.event_register(uuid, int), public.event_unregister(uuid, text), public.event_my_tickets(uuid) to authenticated;

-- ---------------------------------------------------------------- menu e cards passam a conhecer os eventos
create or replace function public.my_menu(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_dec boolean; v_scales boolean; v_welcome boolean; v_ev boolean; v_tk boolean;
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
  return jsonb_build_object(
    'events', v_ev, 'tickets', v_tk,
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

create or replace function public.home_discover(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_cls text; v_dec boolean; st discover_settings; v_order text[]; v_max int; v_cards jsonb[] := '{}'; v_c jsonb; r record; it discover_items;
        v_n int; v_off int; v_idx int[]; v_pool jsonb[]; v_sorted jsonb[] := '{}'; k text; i int; w wallets; wc wallet_settings; v_member boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest') then raise exception 'forbidden'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  v_ids := array(select id from people where org_id = p_org and user_id = auth.uid());
  v_cls := pe.classification; v_member := coalesce(v_cls = 'member', false);
  v_dec := exists (select 1 from faith_decisions d where d.org_id = p_org and d.voided_at is null and (d.person_id = any (v_ids) or d.self_user = auth.uid()));
  select * into st from discover_settings where org_id = p_org;
  v_order := coalesce(st.card_order, (array['continue','campaign','study','sermon','events','notices','journeys','decision','wallet','ministries','contact','cadastro'])::text[]);
  v_max := coalesce(st.max_cards, 8);

  -- 1. atividade pendente de uma jornada em andamento
  select pt.id pid, j.name, j.image_url, public.jr_pct(pt.id) pct, (select name from public.jr_current(pt.id)) step,
         (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id)) pend into r
    from journey_participants pt join journeys j on j.id = pt.journey_id
   where pt.person_id = any (v_ids) and pt.status = 'active' and j.status = 'active'
     and (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id)) > 0 order by pt.updated_at desc limit 1;
  if r.pid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'continue', 'kind', 'progress', 'label', 'Sua jornada', 'title', 'Continue de onde você parou.', 'body', r.name || coalesce(' · ' || r.step, ''),
      'action', 'Continuar', 'route', '#/jornadas/' || r.pid, 'icon', 'route', 'image', r.image_url, 'pct', r.pct, 'tier', 1);
  end if;

  -- 2. destaques e conteúdos cadastrados (campanhas, estudos, pregações)
  for it in select * from discover_items i where i.org_id = p_org and i.archived_at is null and i.active order by i.urgent desc, i.priority desc, coalesce(i.starts_at, i.created_at) desc loop
    if not public.disc_visible(it, pe, v_ids) then continue; end if;
    k := case it.kind when 'campaign' then 'campaign' when 'study' then 'study' else 'sermon' end;
    if k <> 'campaign' and exists (select 1 from unnest(v_cards) c where c->>'key' = k) then continue; end if;
    if k = 'campaign' and (select count(*) from unnest(v_cards) c where c->>'key' = 'campaign') >= 3 then continue; end if;
    v_cards := v_cards || jsonb_build_object('key', k, 'kind', case when k = 'campaign' then 'feature' else 'content' end, 'urgent', it.urgent, 'item_id', it.id,
      'label', case k when 'campaign' then case when it.urgent then 'Comunicado importante' else 'Destaque' end when 'study' then 'Estudo' else 'Última pregação' end,
      'title', it.title, 'body', it.body, 'action', coalesce(it.action_label, case k when 'study' then 'Assistir agora' when 'sermon' then 'Assistir' else 'Saiba mais' end),
      'route', case when it.url ~ '^#/' then it.url end, 'url', case when it.url ~* '^https?://' then it.url end, 'image', it.image_url, 'icon', case k when 'campaign' then 'megaphone' else 'play' end, 'tier', 1);
  end loop;

  -- 3. próximos eventos: eventos com inscrição (publicados e do público da pessoa) e, na falta deles, a agenda simples da igreja
  select count(*) n, (array_agg(e.title order by e.starts_at))[1] t, min(e.starts_at) d, bool_or(public.ev_reg_state(e) in ('open','full')) opn into r
    from ev_events e where e.org_id = p_org and e.status = 'published' and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and e.starts_at <= now() + interval '90 days' and public.ev_eligible(e, pe);
  if r.n > 0 then
    v_cards := v_cards || jsonb_build_object('key', 'events', 'kind', 'event', 'label', case when r.opn then 'Inscrições abertas' else 'Eventos' end, 'title', 'Tem algo especial chegando.', 'body', r.t || ' · ' || to_char(r.d at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
      'action', case when r.opn then 'Inscrever-se' else 'Ver eventos' end, 'route', '#/eventos', 'icon', 'calendar', 'count', r.n, 'tier', 1);
  else
    select count(*) n, (array_agg(e.title order by e.starts_at))[1] t, min(e.starts_at) d into r from church_events e where e.org_id = p_org and e.starts_at >= now() - interval '3 hours' and e.starts_at <= now() + interval '45 days';
    if r.n > 0 then
      v_cards := v_cards || jsonb_build_object('key', 'events', 'kind', 'event', 'label', 'Agenda', 'title', 'Tem algo especial chegando.', 'body', r.t || ' · ' || to_char(r.d at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
        'action', 'Ver eventos', 'route', '#/agenda', 'icon', 'calendar', 'count', r.n, 'tier', 1);
    end if;
  end if;

  -- 4. comunicados reais publicados nas últimas semanas
  select a.title, a.image_url into r from announcements a where a.org_id = p_org and a.team_id is null and a.created_at > now() - interval '30 days' order by a.created_at desc limit 1;
  if r.title is not null then
    v_cards := v_cards || jsonb_build_object('key', 'notices', 'kind', 'notice', 'label', 'Comunicado', 'title', 'Fique por dentro.', 'body', r.title, 'action', 'Ver comunicado', 'route', '#/avisos', 'icon', 'megaphone', 'image', r.image_url, 'tier', 1);
  end if;

  -- 5. convite para uma jornada aberta ao público desta pessoa
  select count(*) n, (array_agg(j.name order by j.created_at desc))[1] nm, (array_agg(j.image_url order by j.created_at desc))[1] im into r
    from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and pe.id is not null
     and (j.eligible_classes is null or pe.classification = any (j.eligible_classes))
     and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_ids) and x.status <> 'cancelled');
  if r.n > 0 then
    v_cards := v_cards || jsonb_build_object('key', 'journeys', 'kind', 'journey', 'label', 'Jornadas', 'title', 'Existe uma jornada esperando por você.',
      'body', case when r.n = 1 then r.nm else r.n || ' jornadas abertas para inscrição' end, 'action', 'Explorar jornadas', 'route', '#/jornadas', 'icon', 'route', 'image', case when r.n = 1 then r.im end, 'tier', 2);
  end if;

  -- 6. convite à decisão: só para quem ainda não tem decisão registrada e não é membro
  if not v_dec and (pe.id is null or v_cls <> 'member') then
    v_cards := v_cards || jsonb_build_object('key', 'decision', 'kind', 'horizontal', 'label', 'Um passo importante', 'title', 'Quer dar um passo importante na sua caminhada?',
      'body', 'Registre sua decisão ou converse com nossa equipe.', 'action', 'Saiba mais', 'route', '#/decisao', 'icon', 'heart', 'tier', 1);
  end if;

  -- 7. carteira digital: só membro elegível com carteira ativa
  if pe.id is not null and v_member and pe.status = 'active' then
    select * into w from wallets where org_id = p_org and person_id = pe.id; wc := public.wl_cfg(p_org);
    if w.id is not null and public.wl_effective(w, pe, wc) = 'active' then
      v_cards := v_cards || jsonb_build_object('key', 'wallet', 'kind', 'compact', 'label', 'Carteira', 'title', 'Sua identificação está aqui.', 'body', 'Acesse sua Carteira Digital de Membro.', 'action', 'Ver carteira', 'route', '#/carteira', 'icon', 'badge', 'tier', 2);
    end if;
  end if;

  -- 8. ministérios e oportunidades de participação (só se houver time)
  if exists (select 1 from teams t where t.org_id = p_org) then
    v_cards := v_cards || jsonb_build_object('key', 'ministries', 'kind', 'horizontal', 'label', 'Participe',
      'title', case when v_member then 'Há um lugar para você servir.' else 'Faça parte da nossa comunidade.' end,
      'body', 'Conheça os ministérios, as atividades e as oportunidades de participação.', 'action', 'Conhecer', 'route', '#/times', 'icon', 'users', 'tier', 2);
  end if;

  -- 9. contato com a igreja (quem ainda não é membro)
  if pe.id is null or v_cls <> 'member' then
    v_cards := v_cards || jsonb_build_object('key', 'contact', 'kind', 'compact', 'label', 'Fale com a igreja', 'title', 'Quer conversar com a igreja?', 'body', 'Peça para a nossa equipe entrar em contato com você.', 'action', 'Solicitar contato', 'route', '#/contato', 'icon', 'chat', 'tier', 2);
  end if;

  -- 10. atualização cadastral: ficha sem alteração há mais de 180 dias e sem pedido em andamento
  if pe.id is not null and pe.status = 'active' and coalesce(pe.updated_at, pe.created_at) < now() - interval '180 days'
     and not exists (select 1 from person_update_requests q where q.person_id = pe.id and q.status in ('draft','pending','in_review')) then
    v_cards := v_cards || jsonb_build_object('key', 'cadastro', 'kind', 'compact', 'label', 'Cadastro', 'title', 'Seus dados estão atualizados?', 'body', 'Mantenha suas informações atualizadas para facilitar nossa comunicação.', 'action', 'Atualizar cadastro', 'route', '#/meu-cadastro', 'icon', 'user', 'tier', 2);
  end if;

  -- ordem escolhida pela administração; urgentes sempre na frente
  foreach k in array v_order loop
    for i in 1 .. coalesce(cardinality(v_cards), 0) loop
      if v_cards[i]->>'key' = k and coalesce((v_cards[i]->>'urgent')::boolean, false) then v_sorted := v_sorted || v_cards[i]; end if;
    end loop;
  end loop;
  foreach k in array v_order loop
    for i in 1 .. coalesce(cardinality(v_cards), 0) loop
      if v_cards[i]->>'key' = k and not coalesce((v_cards[i]->>'urgent')::boolean, false) then v_sorted := v_sorted || v_cards[i]; end if;
    end loop;
  end loop;
  -- variedade: os convites institucionais (tier 2) giram de lugar a cada dia, sem esconder avisos nem conteúdos
  v_idx := '{}'; v_pool := '{}';
  for i in 1 .. coalesce(cardinality(v_sorted), 0) loop
    if (v_sorted[i]->>'tier')::int = 2 then v_idx := v_idx || i; v_pool := v_pool || v_sorted[i]; end if;
  end loop;
  v_n := coalesce(cardinality(v_idx), 0);
  if v_n > 1 then
    v_off := abs(hashtext(auth.uid()::text || to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD'))) % v_n;
    for i in 1 .. v_n loop v_sorted[v_idx[i]] := v_pool[((i - 1 + v_off) % v_n) + 1]; end loop;
  end if;
  return jsonb_build_object('classification', v_cls, 'max', v_max, 'cards', to_jsonb(v_sorted[1:v_max]));
end $$;

grant execute on function public.my_menu(uuid), public.home_discover(uuid) to authenticated;

-- verificação (deve retornar true):
--   select to_regclass('public.ev_events') is not null and to_regclass('public.ev_registrations') is not null and to_regprocedure('public.event_register(uuid,int)') is not null
--      and to_regprocedure('public.event_checkin(uuid,text,uuid,int)') is not null and 'ev_checkin' = any (public.module_actions()) as ok;
-- REVERSÃO: drop function public.event_save(uuid, uuid, jsonb), public.event_set_status(uuid, text, text), public.event_list(uuid), public.event_get(uuid), public.event_register_admin(uuid, uuid, text, int, boolean), public.event_checkin(uuid, text, uuid, int),
--   public.event_checkin_undo(uuid, text), public.events_for_me(uuid), public.event_register(uuid, int), public.event_unregister(uuid, text), public.event_my_tickets(uuid), public.ev_counts(uuid), public.ev_promote(uuid), public.ev_pname(uuid, uuid), public.ev_newcode(),
--   public.ev_reg_state(public.ev_events), public.ev_seats(uuid), public.ev_eligible(public.ev_events, public.people), public.ev_need(uuid, text[]), public.ev_staff(uuid, text[]);  drop table public.ev_registrations, public.ev_events;
--   (my_menu e home_discover voltam à versão do arquivo atualizacao-2026-12-06-menu-inteligente.sql)
