-- =====================================================================
-- SOMOS — Fase 6B: Integrações e Recursos Técnicos (SOMOS Chamados → Integrações)
--  * Permissão nova: integ_manage (administrador ou concessão; desenvolvedor NÃO tem acesso implícito).
--  * API pública v1 (somente leitura, dados já públicos da igreja): chaves com escopo, validade e limite por minuto.
--    A chave aparece uma única vez; no banco fica só o hash (sha256). O servidor HTTP é a Edge Function "api".
--  * Webhooks: URL https (sem endereços internos), eventos escolhidos, segredo de assinatura (HMAC-SHA256), situação,
--    histórico de entregas e reenvio. O envio é feito pela Edge Function "webhook-dispatch" (reenvio automático com espera crescente).
--  * Eventos nunca levam CPF, e-mail, telefone ou dados de doador. "Contribuição registrada" só pode ser assinada por quem tem fin_manage e não leva pessoa.
--  * Logs e monitoramento sem segredos: o que é gravado passa por limpeza; falhas, pendências e "última execução" dos envios ficam visíveis.
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin',
               'fin_view','fin_entry','fin_approve','fin_manage','fin_donors',
               'comm_manage','comm_publish','comm_sermons','care_prayer','care_pastoral','care_manage','dig_manage','integ_manage']::text[]
$$;

create or replace function public.integ_need(p_org uuid) returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.mod_perm(p_org, 'integ_manage') then raise exception 'forbidden'; end if; end $$;

-- ---------------------------------------------------------------- limpeza de segredos nos logs
create or replace function public.integ_clean_text(t text) returns text language sql immutable as $$
  select left(regexp_replace(coalesce(t, ''), '(whsec_|somos_live_)[A-Za-z0-9]+', '[oculto]', 'g'), 200)
$$;
create or replace function public.integ_clean(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' then to_jsonb(public.integ_clean_text(v #>> '{}')) else v end), '{}'::jsonb)
  from jsonb_each(coalesce(j, '{}'::jsonb)) e(k, v) where k !~* '(secret|token|authorization|password|senha|key|signature)'
$$;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.integration_logs (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete cascade,
  source text not null check (source in ('api', 'webhook', 'push', 'system')),
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null check (length(event) <= 120),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists integration_logs_org on public.integration_logs (org_id, created_at desc);
create table if not exists public.integration_heartbeats (
  source text primary key check (source in ('webhooks', 'push', 'api')),
  last_run_at timestamptz not null default now(),
  last_ok_at timestamptz,
  detail jsonb
);
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null check (cardinality(scopes) >= 1 and scopes <@ array['events:read', 'programs:read', 'sermons:read', 'contents:read']),
  rate_limit int not null default 60 check (rate_limit between 10 and 600),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_org on public.api_keys (org_id);
create table if not exists public.api_rate (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  bucket timestamptz not null,
  n int not null default 0,
  primary key (key_id, bucket)
);
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  url text not null check (length(url) <= 500),
  secret text not null,
  events text[] not null check (cardinality(events) >= 1),
  active boolean not null default true,
  failure_streak int not null default 0,
  disabled_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists webhook_endpoints_org on public.webhook_endpoints (org_id);
create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.webhook_deliveries (
  id bigint generated always as identity primary key,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id bigint not null references public.webhook_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz default now(),
  last_attempt_at timestamptz,
  response_status int,
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_due on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');
create index if not exists webhook_deliveries_endpoint on public.webhook_deliveries (endpoint_id, created_at desc);
alter table public.integration_logs enable row level security; alter table public.integration_heartbeats enable row level security; alter table public.api_keys enable row level security;
alter table public.api_rate enable row level security; alter table public.webhook_endpoints enable row level security; alter table public.webhook_events enable row level security; alter table public.webhook_deliveries enable row level security;
revoke all on public.integration_logs, public.integration_heartbeats, public.api_keys, public.api_rate, public.webhook_endpoints, public.webhook_events, public.webhook_deliveries from anon, authenticated;

create or replace function public.integ_log(p_org uuid, p_source text, p_level text, p_event text, p_detail jsonb default null) returns void language sql security definer set search_path = public as $$
  insert into integration_logs (org_id, source, level, event, detail) values (p_org, p_source, p_level, left(p_event, 120), public.integ_clean(p_detail))
$$;
revoke execute on function public.integ_log(uuid, text, text, text, jsonb), public.integ_need(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- chaves de API
create or replace function public.api_key_create(p_org uuid, p_name text, p_scopes text[], p_rate int default 60, p_days int default 365) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid; v_name text := trim(coalesce(p_name, ''));
begin
  perform public.integ_need(p_org);
  if length(v_name) not between 2 and 60 then raise exception 'integ_need_name'; end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ array['events:read', 'programs:read', 'sermons:read', 'contents:read']) then raise exception 'integ_invalid_scopes'; end if;
  if coalesce(p_rate, 60) not between 10 and 600 then raise exception 'integ_invalid_rate'; end if;
  if p_days is not null and p_days not between 1 and 730 then raise exception 'integ_invalid_days'; end if;
  if (select count(*) from api_keys where org_id = p_org and revoked_at is null) >= 20 then raise exception 'integ_limit_reached'; end if;
  v_key := 'somos_live_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
  insert into api_keys (org_id, name, key_prefix, key_hash, scopes, rate_limit, expires_at, created_by)
  values (p_org, v_name, left(v_key, 15), encode(sha256(convert_to(v_key, 'utf8')), 'hex'), p_scopes, coalesce(p_rate, 60), case when p_days is null then null else now() + make_interval(days => p_days) end, auth.uid()) returning id into v_id;
  perform public.mod_log(p_org, 'integracoes', 'api_key', v_id, 'create', null, jsonb_build_object('name', v_name, 'scopes', p_scopes));
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key);
end $$;
create or replace function public.api_key_list(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.integ_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'prefix', k.key_prefix, 'scopes', k.scopes, 'rate_limit', k.rate_limit, 'expires_at', k.expires_at, 'last_used_at', k.last_used_at, 'created_at', k.created_at,
      'state', case when k.revoked_at is not null then 'revoked' when k.expires_at is not null and k.expires_at < now() then 'expired' else 'active' end) order by k.created_at desc)
    from api_keys k where k.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.api_key_revoke(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare k api_keys;
begin
  select * into k from api_keys where id = p_id; if k.id is null then raise exception 'not_found'; end if;
  perform public.integ_need(k.org_id);
  update api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  perform public.mod_log(k.org_id, 'integracoes', 'api_key', p_id, 'revoke', null, jsonb_build_object('name', k.name));
  return jsonb_build_object('ok', true);
end $$;

-- uso exclusivo da Edge Function "api" (chave de serviço): confere a chave, o escopo e o limite por minuto
create or replace function public.api_authenticate(p_hash text, p_scope text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k api_keys; v_n int; v_bucket timestamptz := date_trunc('minute', now());
begin
  select * into k from api_keys where key_hash = p_hash;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  if k.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked', 'org_id', k.org_id, 'key_id', k.id); end if;
  if k.expires_at is not null and k.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired', 'org_id', k.org_id, 'key_id', k.id); end if;
  if p_scope is not null and not (p_scope = any (k.scopes)) then return jsonb_build_object('ok', false, 'error', 'insufficient_scope', 'org_id', k.org_id, 'key_id', k.id); end if;
  insert into api_rate (key_id, bucket, n) values (k.id, v_bucket, 1) on conflict (key_id, bucket) do update set n = api_rate.n + 1 returning n into v_n;
  if v_n > k.rate_limit then return jsonb_build_object('ok', false, 'error', 'rate_limited', 'org_id', k.org_id, 'key_id', k.id, 'limit', k.rate_limit, 'retry_after', greatest(1, 60 - extract(second from now())::int)); end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then update api_keys set last_used_at = now() where id = k.id; end if;
  return jsonb_build_object('ok', true, 'org_id', k.org_id, 'key_id', k.id, 'limit', k.rate_limit, 'remaining', k.rate_limit - v_n);
end $$;
create or replace function public.api_log(p_org uuid, p_key uuid, p_method text, p_path text, p_status int, p_ms int) returns void language sql security definer set search_path = public as $$
  select public.integ_log(p_org, 'api', case when p_status >= 500 then 'error' when p_status >= 400 then 'warn' else 'info' end, left(coalesce(p_method, '') || ' ' || coalesce(p_path, ''), 120),
    jsonb_build_object('status', p_status, 'ms', p_ms, 'key_id', p_key))
$$;

-- recursos da API v1: só o que a igreja já publica para todos (nada de pessoas, financeiro ou conteúdo restrito)
create or replace function public.api_v1_events(p_org uuid, p_limit int default 50, p_offset int default 0) returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select e.* from ev_events e where e.org_id = p_org and e.status = 'published' and e.audience = 'all' order by e.starts_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('data', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'description', x.description, 'location', x.location, 'starts_at', x.starts_at, 'ends_at', x.ends_at, 'image_url', x.image_url, 'registration', x.registration) order by x.starts_at desc)
      from (select * from r order by starts_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb),
    'limit', least(greatest(coalesce(p_limit, 50), 1), 100), 'offset', greatest(coalesce(p_offset, 0), 0), 'has_more', (select count(*) from r) > least(greatest(coalesce(p_limit, 50), 1), 100))
$$;
create or replace function public.api_v1_programs(p_org uuid, p_limit int default 50, p_offset int default 0) returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select p.* from prog_items p where p.org_id = p_org and p.status = 'published' and p.visibility = 'public' order by p.name limit least(greatest(coalesce(p_limit, 50), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('data', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'description', x.description, 'category', x.category, 'location', x.location, 'start_date', x.start_date, 'starts_time', x.starts_time, 'ends_time', x.ends_time, 'recurrence', x.recurrence) order by x.name)
      from (select * from r order by name limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb),
    'limit', least(greatest(coalesce(p_limit, 50), 1), 100), 'offset', greatest(coalesce(p_offset, 0), 0), 'has_more', (select count(*) from r) > least(greatest(coalesce(p_limit, 50), 1), 100))
$$;
create or replace function public.api_v1_sermons(p_org uuid, p_limit int default 50, p_offset int default 0) returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select z.* from sermons z where z.org_id = p_org and z.status = 'published' and z.audience = 'all' order by z.preached_on desc nulls last, z.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('data', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'preacher', x.preacher, 'preached_on', x.preached_on, 'scripture', x.scripture, 'description', x.description, 'video_url', x.video_url, 'audio_url', x.audio_url, 'image_url', x.image_url,
        'series', (select s.name from sermon_series s where s.id = x.series_id)) order by x.preached_on desc nulls last, x.created_at desc)
      from (select * from r order by preached_on desc nulls last, created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb),
    'limit', least(greatest(coalesce(p_limit, 50), 1), 100), 'offset', greatest(coalesce(p_offset, 0), 0), 'has_more', (select count(*) from r) > least(greatest(coalesce(p_limit, 50), 1), 100))
$$;
create or replace function public.api_v1_contents(p_org uuid, p_limit int default 50, p_offset int default 0) returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select c.* from content_items c where c.org_id = p_org and c.status = 'published' and c.audience = 'all' order by c.published_at desc nulls last, c.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('data', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'description', x.description, 'category', x.category, 'url', x.url, 'image_url', x.image_url, 'published_at', x.published_at) order by x.published_at desc nulls last, x.created_at desc)
      from (select * from r order by published_at desc nulls last, created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb),
    'limit', least(greatest(coalesce(p_limit, 50), 1), 100), 'offset', greatest(coalesce(p_offset, 0), 0), 'has_more', (select count(*) from r) > least(greatest(coalesce(p_limit, 50), 1), 100))
$$;

-- ---------------------------------------------------------------- webhooks
create or replace function public.wh_event_types() returns text[] language sql immutable as $$
  select array['person.created', 'person.updated', 'event.created', 'registration.created', 'attendance.recorded', 'contribution.recorded', 'program.published']::text[]
$$;
-- só https, sem usuário na URL, sem endereço IP, sem nomes internos (localhost, .local, .internal ...)
create or replace function public.integ_url_ok(u text) returns boolean language sql immutable as $$
  select coalesce(u ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{2,5})?(/[^[:space:]]*)?$' and length(u) <= 500
    and h ~ '\.' and h !~ '^[0-9.]+$' and h !~* '(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$', false)
  from (select split_part(split_part(substr(coalesce(u, ''), 9), '/', 1), ':', 1) h) x
$$;

create or replace function public.wh_emit(p_org uuid, p_type text, p_payload jsonb) returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not exists (select 1 from webhook_endpoints e where e.org_id = p_org and e.active and p_type = any (e.events)) then return; end if;
  insert into webhook_events (org_id, event_type, payload) values (p_org, p_type, p_payload) returning id into v_id;
  insert into webhook_deliveries (endpoint_id, event_id) select e.id, v_id from webhook_endpoints e where e.org_id = p_org and e.active and p_type = any (e.events);
end $$;
revoke execute on function public.wh_emit(uuid, text, jsonb) from public, anon, authenticated;

-- Gatilhos: nunca atrapalham a operação principal (qualquer erro é ignorado) e só levam dados mínimos.
create or replace function public.wh_trg_people() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.wh_emit(new.org_id, 'person.created', jsonb_build_object('id', new.id, 'full_name', new.full_name, 'classification', new.classification, 'status', new.status));
    elsif (old.full_name, old.classification, old.status) is distinct from (new.full_name, new.classification, new.status) then
      perform public.wh_emit(new.org_id, 'person.updated', jsonb_build_object('id', new.id, 'full_name', new.full_name, 'classification', new.classification, 'status', new.status,
        'changed', to_jsonb(array_remove(array[case when old.full_name is distinct from new.full_name then 'full_name' end, case when old.classification is distinct from new.classification then 'classification' end, case when old.status is distinct from new.status then 'status' end], null))));
    end if;
  exception when others then null; end;
  return new;
end $$;
create or replace function public.wh_trg_events() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.wh_emit(new.org_id, 'event.created', jsonb_build_object('id', new.id, 'title', new.title, 'starts_at', new.starts_at, 'status', new.status, 'audience', new.audience)); exception when others then null; end;
  return new;
end $$;
create or replace function public.wh_trg_registrations() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.wh_emit(new.org_id, 'registration.created', jsonb_build_object('id', new.id, 'event_id', new.event_id, 'status', new.status, 'guests', new.guests, 'source', new.source));
    elsif old.checked_in_at is null and new.checked_in_at is not null then
      perform public.wh_emit(new.org_id, 'attendance.recorded', jsonb_build_object('registration_id', new.id, 'event_id', new.event_id, 'checked_in_at', new.checked_in_at, 'count', new.checked_in_count));
    end if;
  exception when others then null; end;
  return new;
end $$;
-- contribuição: só valor, data, categoria, campanha e forma; nunca a pessoa nem o nome do doador
create or replace function public.wh_trg_fin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.kind = 'income' and new.status = 'settled' and (tg_op = 'INSERT' or old.status is distinct from 'settled') then
      perform public.wh_emit(new.org_id, 'contribution.recorded', jsonb_build_object('id', new.id, 'amount', new.amount, 'paid_at', new.paid_at, 'category_id', new.category_id, 'campaign_id', new.campaign_id, 'method', new.method));
    end if;
  exception when others then null; end;
  return new;
end $$;
-- programação: só as de visibilidade pública (as internas não saem do SOMOS)
create or replace function public.wh_trg_programs() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'published' and new.visibility = 'public' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
      perform public.wh_emit(new.org_id, 'program.published', jsonb_build_object('id', new.id, 'name', new.name, 'category', new.category, 'start_date', new.start_date, 'starts_time', new.starts_time));
    end if;
  exception when others then null; end;
  return new;
end $$;
revoke execute on function public.wh_trg_people(), public.wh_trg_events(), public.wh_trg_registrations(), public.wh_trg_fin(), public.wh_trg_programs() from public, anon, authenticated;
drop trigger if exists wh_people_trg on public.people;
create trigger wh_people_trg after insert or update of full_name, classification, status on public.people for each row execute function public.wh_trg_people();
drop trigger if exists wh_events_trg on public.ev_events;
create trigger wh_events_trg after insert on public.ev_events for each row execute function public.wh_trg_events();
drop trigger if exists wh_regs_trg on public.ev_registrations;
create trigger wh_regs_trg after insert or update of checked_in_at on public.ev_registrations for each row execute function public.wh_trg_registrations();
drop trigger if exists wh_fin_trg on public.fin_entries;
create trigger wh_fin_trg after insert or update of status on public.fin_entries for each row execute function public.wh_trg_fin();
drop trigger if exists wh_prog_trg on public.prog_items;
create trigger wh_prog_trg after insert or update of status on public.prog_items for each row execute function public.wh_trg_programs();

create or replace function public.wh_save(p_org uuid, p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_url text := trim(coalesce(p->>'url', '')); v_events text[]; v_id uuid := p_id; v_secret text;
begin
  perform public.integ_need(p_org);
  if length(v_name) not between 2 and 60 then raise exception 'integ_need_name'; end if;
  if not public.integ_url_ok(v_url) then raise exception 'integ_bad_url'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_events from jsonb_array_elements_text(coalesce(p->'events', '[]'::jsonb)) x;
  if cardinality(v_events) = 0 or not (v_events <@ public.wh_event_types()) then raise exception 'integ_invalid_events'; end if;
  if 'contribution.recorded' = any (v_events) and not public.mod_perm(p_org, 'fin_manage') then raise exception 'integ_fin_denied'; end if;
  if p_id is null then
    if (select count(*) from webhook_endpoints where org_id = p_org) >= 10 then raise exception 'integ_limit_reached'; end if;
    v_secret := 'whsec_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 48);
    insert into webhook_endpoints (org_id, name, url, secret, events, active, created_by) values (p_org, v_name, v_url, v_secret, v_events, coalesce((p->>'active')::boolean, true), auth.uid()) returning id into v_id;
  else
    update webhook_endpoints set name = v_name, url = v_url, events = v_events where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if;
  end if;
  perform public.mod_log(p_org, 'integracoes', 'webhook', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('name', v_name, 'events', v_events));
  return jsonb_build_object('ok', true, 'id', v_id) || case when v_secret is not null then jsonb_build_object('secret', v_secret) else '{}'::jsonb end;
end $$;
create or replace function public.wh_list(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.integ_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'url', e.url, 'events', e.events, 'active', e.active, 'disabled_reason', e.disabled_reason, 'secret_hint', '…' || right(e.secret, 4), 'created_at', e.created_at,
      'pending', (select count(*) from webhook_deliveries d where d.endpoint_id = e.id and d.status in ('pending', 'failed')),
      'dead', (select count(*) from webhook_deliveries d where d.endpoint_id = e.id and d.status = 'dead'),
      'last', (select jsonb_build_object('status', d.status, 'at', coalesce(d.delivered_at, d.last_attempt_at, d.created_at), 'response_status', d.response_status) from webhook_deliveries d where d.endpoint_id = e.id order by d.id desc limit 1)) order by e.created_at desc)
    from webhook_endpoints e where e.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.wh_rotate_secret(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints; v_secret text;
begin
  select * into e from webhook_endpoints where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.integ_need(e.org_id);
  v_secret := 'whsec_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 48);
  update webhook_endpoints set secret = v_secret where id = p_id;
  perform public.mod_log(e.org_id, 'integracoes', 'webhook', p_id, 'rotate_secret', null, null);
  return jsonb_build_object('ok', true, 'secret', v_secret);
end $$;
create or replace function public.wh_set_active(p_id uuid, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints;
begin
  select * into e from webhook_endpoints where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.integ_need(e.org_id);
  update webhook_endpoints set active = coalesce(p_on, false), failure_streak = case when p_on then 0 else failure_streak end, disabled_reason = case when p_on then null else disabled_reason end where id = p_id;
  perform public.mod_log(e.org_id, 'integracoes', 'webhook', p_id, case when p_on then 'enable' else 'disable' end, null, null);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.wh_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints;
begin
  select * into e from webhook_endpoints where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.integ_need(e.org_id);
  delete from webhook_endpoints where id = p_id;
  perform public.mod_log(e.org_id, 'integracoes', 'webhook', p_id, 'delete', null, jsonb_build_object('name', e.name));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.wh_test(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints; v_ev bigint;
begin
  select * into e from webhook_endpoints where id = p_id; if e.id is null then raise exception 'not_found'; end if;
  perform public.integ_need(e.org_id);
  insert into webhook_events (org_id, event_type, payload) values (e.org_id, 'webhook.test', jsonb_build_object('message', 'Teste de conexão do SOMOS')) returning id into v_ev;
  insert into webhook_deliveries (endpoint_id, event_id) values (p_id, v_ev);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.wh_deliveries(p_org uuid, p_endpoint uuid default null, p_status text default null, p_limit int default 50) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.integ_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'endpoint_id', x.endpoint_id, 'endpoint', x.ename, 'event_type', x.event_type, 'status', x.status, 'attempts', x.attempts, 'response_status', x.response_status, 'error', x.error,
      'created_at', x.created_at, 'last_attempt_at', x.last_attempt_at, 'delivered_at', x.delivered_at, 'next_attempt_at', x.next_attempt_at) order by x.id desc)
    from (select d.*, e.name as ename, v.event_type from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id join webhook_events v on v.id = d.event_id
           where e.org_id = p_org and (p_endpoint is null or d.endpoint_id = p_endpoint) and (p_status is null or d.status = p_status) order by d.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb);
end $$;
-- reenvio manual: só entrega que falhou ou foi abandonada. O destino recebe o mesmo identificador (X-Somos-Delivery), então pode ignorar repetições.
create or replace function public.wh_retry(p_delivery bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries; e webhook_endpoints;
begin
  select * into d from webhook_deliveries where id = p_delivery; if d.id is null then raise exception 'not_found'; end if;
  select * into e from webhook_endpoints where id = d.endpoint_id;
  perform public.integ_need(e.org_id);
  if d.status not in ('failed', 'dead') then raise exception 'integ_not_retryable'; end if;
  update webhook_deliveries set status = 'pending', attempts = 0, next_attempt_at = now(), error = null where id = p_delivery;
  perform public.mod_log(e.org_id, 'integracoes', 'webhook', e.id, 'retry', null, jsonb_build_object('delivery', p_delivery));
  return jsonb_build_object('ok', true);
end $$;

-- uso exclusivo da Edge Function "webhook-dispatch" (chave de serviço)
create or replace function public.wh_claim(p_limit int default 50) returns jsonb language sql security definer set search_path = public as $$
  with c as (select d.id from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
              where d.status in ('pending', 'failed') and d.next_attempt_at <= now() and e.active order by d.id limit least(greatest(coalesce(p_limit, 50), 1), 200) for update of d skip locked),
       u as (update webhook_deliveries d set attempts = d.attempts + 1, last_attempt_at = now(), next_attempt_at = now() + interval '10 minutes' from c where d.id = c.id returning d.id, d.endpoint_id, d.event_id, d.attempts)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'attempt', u.attempts, 'event_id', u.event_id, 'event_type', v.event_type, 'payload', v.payload, 'org_id', v.org_id, 'created_at', v.created_at, 'url', e.url, 'secret', e.secret, 'endpoint_id', e.id) order by u.id), '[]'::jsonb)
  from u join webhook_endpoints e on e.id = u.endpoint_id join webhook_events v on v.id = u.event_id
$$;
create or replace function public.wh_report(p_results jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r record; d webhook_deliveries; v_org uuid; v_streak int;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as x(id bigint, ok boolean, status int, error text) loop
    select * into d from webhook_deliveries where id = r.id; if d.id is null then continue; end if;
    select e.org_id into v_org from webhook_endpoints e where e.id = d.endpoint_id;
    if coalesce(r.ok, false) then
      update webhook_deliveries set status = 'success', response_status = r.status, error = null, delivered_at = now(), next_attempt_at = null where id = d.id;
      update webhook_endpoints set failure_streak = 0 where id = d.endpoint_id;
      perform public.integ_log(v_org, 'webhook', 'info', 'entrega concluída', jsonb_build_object('delivery', d.id, 'endpoint', d.endpoint_id, 'status', r.status, 'attempt', d.attempts));
    else
      update webhook_deliveries set status = case when d.attempts >= 6 then 'dead' else 'failed' end, response_status = r.status, error = public.integ_clean_text(r.error),
        next_attempt_at = case when d.attempts >= 6 then null else now() + case d.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes' when 4 then interval '2 hours' else interval '12 hours' end end where id = d.id;
      update webhook_endpoints set failure_streak = failure_streak + 1 where id = d.endpoint_id returning failure_streak into v_streak;
      if v_streak >= 30 then update webhook_endpoints set active = false, disabled_reason = 'Desativado automaticamente após 30 falhas seguidas' where id = d.endpoint_id and active; end if;
      perform public.integ_log(v_org, 'webhook', case when d.attempts >= 6 then 'error' else 'warn' end, case when d.attempts >= 6 then 'entrega abandonada' else 'entrega falhou, nova tentativa agendada' end,
        jsonb_build_object('delivery', d.id, 'endpoint', d.endpoint_id, 'status', r.status, 'attempt', d.attempts, 'error', r.error));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- monitoramento
create or replace function public.integ_heartbeat(p_source text, p_ok boolean, p_detail jsonb default null) returns void language sql security definer set search_path = public as $$
  insert into integration_heartbeats (source, last_run_at, last_ok_at, detail) values (p_source, now(), case when coalesce(p_ok, false) then now() end, public.integ_clean(p_detail))
  on conflict (source) do update set last_run_at = now(), last_ok_at = case when coalesce(p_ok, false) then now() else integration_heartbeats.last_ok_at end, detail = public.integ_clean(p_detail)
$$;
create or replace function public.integ_status(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.integ_need(p_org);
  return jsonb_build_object(
    'webhooks', jsonb_build_object('endpoints_active', (select count(*) from webhook_endpoints where org_id = p_org and active), 'endpoints_disabled', (select count(*) from webhook_endpoints where org_id = p_org and not active),
      'pending', (select count(*) from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id where e.org_id = p_org and d.status in ('pending', 'failed')),
      'failed_24h', (select count(*) from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id where e.org_id = p_org and d.status in ('failed', 'dead') and coalesce(d.last_attempt_at, d.created_at) > now() - interval '24 hours'),
      'dead', (select count(*) from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id where e.org_id = p_org and d.status = 'dead'),
      'oldest_pending_seconds', (select extract(epoch from now() - min(d.created_at))::int from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id where e.org_id = p_org and d.status in ('pending', 'failed'))),
    'api', jsonb_build_object('keys_active', (select count(*) from api_keys where org_id = p_org and revoked_at is null and (expires_at is null or expires_at > now())),
      'requests_24h', (select count(*) from integration_logs where org_id = p_org and source = 'api' and created_at > now() - interval '24 hours'),
      'errors_24h', (select count(*) from integration_logs where org_id = p_org and source = 'api' and level <> 'info' and created_at > now() - interval '24 hours')),
    'push', jsonb_build_object('devices', (select count(*) from push_subscriptions s where exists (select 1 from org_members m where m.user_id = s.user_id and m.org_id = p_org)),
      'pending', (select count(*) from push_outbox o where o.sent_at is null and o.attempts < 3 and exists (select 1 from org_members m where m.user_id = o.user_id and m.org_id = p_org)),
      'configured', coalesce((select (detail->>'configured')::boolean from integration_heartbeats where source = 'push'), false)),
    'heartbeats', coalesce((select jsonb_agg(jsonb_build_object('source', h.source, 'last_run_at', h.last_run_at, 'last_ok_at', h.last_ok_at, 'state', case when h.last_run_at < now() - interval '15 minutes' then 'late' else 'ok' end) order by h.source) from integration_heartbeats h), '[]'::jsonb));
end $$;
create or replace function public.integ_log_list(p_org uuid, p_source text default null, p_level text default null, p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.integ_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'source', l.source, 'level', l.level, 'event', l.event, 'detail', l.detail, 'at', l.created_at) order by l.id desc)
    from (select * from integration_logs where org_id = p_org and (p_source is null or source = p_source) and (p_level is null or level = p_level) order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) l), '[]'::jsonb);
end $$;
create or replace function public.integ_access(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('manage', public.mod_perm(p_org, 'integ_manage'), 'fin', public.mod_perm(p_org, 'fin_manage'));
end $$;
-- limpeza periódica: logs 90 dias, contadores de limite 2 dias, eventos entregues 30 dias (as entregas pendentes seguram o evento)
create or replace function public.integ_purge() returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  delete from integration_logs where created_at < now() - interval '90 days'; get diagnostics a = row_count;
  delete from api_rate where bucket < now() - interval '2 days'; get diagnostics b = row_count;
  delete from webhook_events v where v.created_at < now() - interval '30 days' and not exists (select 1 from webhook_deliveries d where d.event_id = v.id and d.status in ('pending', 'failed')); get diagnostics c = row_count;
  return jsonb_build_object('logs', a, 'rate', b, 'events', c);
end $$;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-integracoes-limpeza';
  perform cron.schedule('somos-integracoes-limpeza', '17 3 * * *', 'select public.integ_purge()');
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function public.api_key_create(uuid, text, text[], int, int), public.api_key_list(uuid), public.api_key_revoke(uuid), public.wh_save(uuid, uuid, jsonb), public.wh_list(uuid), public.wh_rotate_secret(uuid),
  public.wh_set_active(uuid, boolean), public.wh_delete(uuid), public.wh_test(uuid), public.wh_deliveries(uuid, uuid, text, int), public.wh_retry(bigint), public.integ_status(uuid), public.integ_log_list(uuid, text, text, int), public.integ_access(uuid) from public, anon;
grant execute on function public.api_key_create(uuid, text, text[], int, int), public.api_key_list(uuid), public.api_key_revoke(uuid), public.wh_save(uuid, uuid, jsonb), public.wh_list(uuid), public.wh_rotate_secret(uuid),
  public.wh_set_active(uuid, boolean), public.wh_delete(uuid), public.wh_test(uuid), public.wh_deliveries(uuid, uuid, text, int), public.wh_retry(bigint), public.integ_status(uuid), public.integ_log_list(uuid, text, text, int), public.integ_access(uuid) to authenticated;
-- só a chave de serviço (Edge Functions) executa estas:
revoke execute on function public.api_authenticate(text, text), public.api_log(uuid, uuid, text, text, int, int), public.api_v1_events(uuid, int, int), public.api_v1_programs(uuid, int, int), public.api_v1_sermons(uuid, int, int), public.api_v1_contents(uuid, int, int),
  public.wh_claim(int), public.wh_report(jsonb), public.integ_heartbeat(text, boolean, jsonb), public.integ_purge() from public, anon, authenticated;
grant execute on function public.api_authenticate(text, text), public.api_log(uuid, uuid, text, text, int, int), public.api_v1_events(uuid, int, int), public.api_v1_programs(uuid, int, int), public.api_v1_sermons(uuid, int, int), public.api_v1_contents(uuid, int, int),
  public.wh_claim(int), public.wh_report(jsonb), public.integ_heartbeat(text, boolean, jsonb), public.integ_purge() to service_role;
revoke execute on function public.integ_clean(jsonb), public.integ_clean_text(text), public.wh_event_types(), public.integ_url_ok(text) from public, anon;
grant execute on function public.integ_clean(jsonb), public.integ_clean_text(text), public.wh_event_types(), public.integ_url_ok(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Para desfazer: dropar os gatilhos wh_*_trg, as funções api_*, wh_*, integ_* e as tabelas api_keys, api_rate, webhook_*, integration_* (apaga chaves, endpoints e históricos de entrega);
-- reaplicar module_actions() sem 'integ_manage'. Nenhum dado de pessoas, eventos ou financeiro é tocado.
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select 'integ_manage' = any (public.module_actions())
   and to_regclass('public.api_keys') is not null and to_regclass('public.webhook_endpoints') is not null and to_regclass('public.webhook_deliveries') is not null
   and (select count(*) from pg_trigger where tgname in ('wh_people_trg', 'wh_events_trg', 'wh_regs_trg', 'wh_fin_trg', 'wh_prog_trg')) = 5
   and public.integ_url_ok('https://exemplo.com.br/hook') and not public.integ_url_ok('https://localhost/x') and not public.integ_url_ok('http://exemplo.com/x') and not public.integ_url_ok('https://10.0.0.1/x') as integracoes_ok;
