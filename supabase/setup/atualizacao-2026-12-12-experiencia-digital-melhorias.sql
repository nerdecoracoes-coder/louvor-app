-- =====================================================================
-- SOMOS  Fase 5 (melhorias): busca sem acento e tolerante a erros, transmissao ao vivo, anotacoes e lembretes dos planos de leitura,
-- e a base do aviso no celular (push) ja pronta para quando o app for instalado e as chaves forem configuradas.
--  * Busca: "biblia", "Biblia" e "BIBLIA" acham o mesmo; palavras parecidas (ex.: "bibila") tambem. Vale para a busca geral, conteudos e pregacoes.
--  * Transmissao ao vivo: a administracao cadastra titulo, link (YouTube etc.), imagem, inicio, fim e publico; o card aparece na Home de 15 min antes ao fim.
--  * Planos: anotacao pessoal por dia (so a pessoa le) e lembrete diario opcional (horario escolhido) por aviso no app.
--  * Push: assinaturas e fila de envio no banco; envio por Edge Function (push-send) quando houver as chaves VAPID. Sem chaves, nada e enviado.
-- =====================================================================
create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public.dig_norm(t text) returns text language sql stable set search_path = public, extensions as $$
  select lower(extensions.unaccent(coalesce(t, '')))
$$;
create or replace function public.dig_sorted(t text) returns text language sql immutable as $$
  select string_agg(c, '' order by c) from regexp_split_to_table(coalesce(t, ''), '') c
$$;
create or replace function public.dig_match(t text, q text) returns boolean language sql stable set search_path = public, extensions as $$
  select case when t is null or q is null or length(trim(q)) = 0 then false
    else public.dig_norm(t) like '%' || public.dig_norm(q) || '%'
      or (length(trim(public.dig_norm(q))) >= 4 and trim(public.dig_norm(q)) !~ '\s'
          and exists (select 1 from unnest(regexp_split_to_array(public.dig_norm(t), '[^a-z0-9]+')) w
                       where length(w) >= 3 and (extensions.levenshtein(left(w, 40), left(trim(public.dig_norm(q)), 40)) <= case when length(trim(public.dig_norm(q))) >= 7 then 2 else 1 end
                              or (extensions.levenshtein(left(w, 40), left(trim(public.dig_norm(q)), 40)) = 2 and public.dig_sorted(w) = public.dig_sorted(trim(public.dig_norm(q))))))) end
$$;
revoke execute on function public.dig_norm(text), public.dig_sorted(text), public.dig_match(text, text) from public, anon;
grant execute on function public.dig_norm(text), public.dig_sorted(text), public.dig_match(text, text) to authenticated;

create or replace function public.search_all(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare pe people; v_q text := trim(coalesce(p_q, '')); v_like text; v_member boolean; v_leader boolean; v_mgr boolean; v_guest boolean;
begin
  perform public.dig_member(p_org);
  v_q := trim(replace(replace(replace(v_q, '%', ''), '_', ''), '\', ''));
  if length(v_q) < 2 then return jsonb_build_object('q', v_q, 'groups', '[]'::jsonb); end if;
  v_like := '%' || v_q || '%';
  select * into pe from public.dig_me(p_org);
  v_member := public.mod_member(p_org); v_leader := public.prog_leader(p_org); v_mgr := public.prog_mgr(p_org);
  return jsonb_build_object('q', v_q, 'groups', (select coalesce(jsonb_agg(g) filter (where jsonb_array_length(g->'items') > 0), '[]'::jsonb) from (values
    (jsonb_build_object('key', 'events', 'label', 'Eventos', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'sub', to_char(e.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'route', '#/eventos') order by e.starts_at) from (
        select * from ev_events e where e.org_id = p_org and e.status = 'published' and e.starts_at >= now() - interval '1 day' and public.ev_eligible(e, pe) and (public.dig_match(e.title, v_q) or public.dig_match(e.description, v_q) or public.dig_match(e.location, v_q)) order by e.starts_at limit 6) e), '[]'::jsonb))),
    (jsonb_build_object('key', 'agenda', 'label', E'Agenda e programa\u00e7\u00f5es', 'items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('title', p.name, 'sub', coalesce(p.location, initcap(p.category)), 'route', '#/agenda') x from prog_items p where p.org_id = p_org
          and (v_mgr or (p.status = 'published' and (p.visibility = 'public' or (p.visibility = 'members' and v_member) or (p.visibility = 'leaders' and v_leader)))) and p.status <> 'cancelled' and (public.dig_match(p.name, v_q) or public.dig_match(p.description, v_q) or public.dig_match(p.location, v_q)) order by p.name limit 6) a), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'sub', to_char(c.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'route', '#/agenda')) from (
        select * from church_events c where c.org_id = p_org and c.starts_at >= now() - interval '1 day' and (public.dig_match(c.title, v_q) or public.dig_match(c.description, v_q)) order by c.starts_at limit 4) c), '[]'::jsonb))),
    (jsonb_build_object('key', 'sermons', 'label', E'Prega\u00e7\u00f5es', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'sub', coalesce(s.preacher, ''), 'route', '#/pregacoes?q=' || replace(s.title, ' ', '%20')) order by s.preached_on desc nulls last) from (
        select * from sermons s where s.org_id = p_org and s.status = 'published' and (s.audience = 'all' or (pe.id is not null and pe.classification = s.audience))
          and (public.dig_match(s.title, v_q) or public.dig_match(s.preacher, v_q) or public.dig_match(s.scripture, v_q) or public.dig_match(s.description, v_q)) order by s.preached_on desc nulls last limit 6) s), '[]'::jsonb))),
    (jsonb_build_object('key', 'contents', 'label', E'Conte\u00fados', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'sub', case c.kind when 'video' then E'V\u00eddeo' when 'audio' then E'\u00c1udio' when 'study' then 'Estudo' when 'download' then 'Material' else 'Institucional' end, 'route', '#/conteudos/' || c.id) order by c.published_at desc) from (
        select * from content_items c left join lateral (select 1) z on true where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe)
          and (public.dig_match(c.title, v_q) or public.dig_match(c.description, v_q) or public.dig_match(c.category, v_q) or exists (select 1 from content_series s where s.id = c.series_id and public.dig_match(s.name, v_q))) order by c.published_at desc limit 6) c), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'sub', 'Plano de leitura', 'route', '#/planos/' || p.id)) from (
        select * from reading_plans p where p.org_id = p_org and p.status = 'published' and public.dig_aud_ok(p.audience, pe) and (public.dig_match(p.title, v_q) or public.dig_match(p.description, v_q)) and exists (select 1 from reading_plan_days d where d.plan_id = p.id) limit 4) p), '[]'::jsonb))),
    (jsonb_build_object('key', 'notices', 'label', 'Comunicados', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', a.title, 'sub', to_char(a.created_at at time zone 'America/Sao_Paulo', 'DD/MM'), 'route', '#/avisos') order by a.created_at desc) from (
        select * from announcements a where a.org_id = p_org and a.team_id is null and public.comm_ann_ok(a) and (public.dig_match(a.title, v_q) or public.dig_match(a.body, v_q)) order by a.created_at desc limit 6) a), '[]'::jsonb))),
    (jsonb_build_object('key', 'church', 'label', E'Informa\u00e7\u00f5es da igreja', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', o.name, 'sub', coalesce(o.subtitle, ''), 'route', '#/igreja')) from organizations o where o.id = p_org and (public.dig_match(o.name, v_q) or public.dig_match(o.subtitle, v_q))), '[]'::jsonb)))
  ) as t(g)));
end $$;

create or replace function public.content_list(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_q text := nullif(trim(coalesce(p_filter->>'q', '')), ''); v_kind text := nullif(p_filter->>'kind', ''); v_series uuid := nullif(p_filter->>'series_id', '')::uuid;
begin
  perform public.dig_member(p_org);
  select * into pe from public.dig_me(p_org);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'description', left(coalesce(c.description, ''), 240), 'series_id', c.series_id, 'series', s.name, 'category', c.category, 'image_url', c.image_url, 'published_at', c.published_at)
        order by c.published_at desc)
      from content_items c left join content_series s on s.id = c.series_id
      where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe) and (v_kind is null or c.kind = v_kind) and (v_series is null or c.series_id = v_series)
        and (v_q is null or public.dig_match(c.title, v_q) or public.dig_match(c.description, v_q) or public.dig_match(s.name, v_q) or public.dig_match(c.category, v_q))), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by lower(s.name)) from content_series s
        where s.org_id = p_org and exists (select 1 from content_items c where c.series_id = s.id and c.status = 'published' and public.dig_aud_ok(c.audience, pe))), '[]'::jsonb),
    'can_manage', public.dig_staff(p_org));
end $$;

create or replace function public.sermon_list(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean; v_cls text; v_q text := nullif(trim(coalesce(p_filter->>'q', '')), ''); v_series uuid := nullif(p_filter->>'series_id', '')::uuid; v_cat text := nullif(p_filter->>'category', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  v_staff := public.comm_staff(p_org, array['comm_sermons']);
  select classification into v_cls from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return jsonb_build_object('can', v_staff,
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'image_url', s.image_url, 'count', (select count(*) from sermons z where z.series_id = s.id and (v_staff or (z.status = 'published' and (z.audience = 'all' or z.audience = v_cls))))) order by s.name) from sermon_series s where s.org_id = p_org), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(distinct z.category) from sermons z where z.org_id = p_org and z.category is not null and (v_staff or (z.status = 'published' and (z.audience = 'all' or z.audience = v_cls)))), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(x) - 'created_by' order by x.preached_on desc nulls last, x.created_at desc) from (
      select z.id, z.title, z.preacher, z.preached_on, z.series_id, sr.name as series, z.category, z.scripture, z.description, z.video_url, z.audio_url, z.image_url, z.links, z.audience, z.status, z.created_at, z.created_by
        from sermons z left join sermon_series sr on sr.id = z.series_id
       where z.org_id = p_org and (v_staff or (z.status = 'published' and (z.audience = 'all' or z.audience = v_cls)))
         and (v_series is null or z.series_id = v_series) and (v_cat is null or z.category = v_cat)
         and (v_q is null or public.dig_match(z.title, v_q) or public.dig_match(z.preacher, v_q) or public.dig_match(z.scripture, v_q) or public.dig_match(z.description, v_q) or public.dig_match(sr.name, v_q))
       order by z.preached_on desc nulls last, z.created_at desc limit 200) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- transmissao ao vivo
create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  url text not null check (length(url) <= 600 and url ~* '^https://'),
  image_url text check (image_url is null or length(image_url) <= 600),
  starts_at timestamptz not null,
  ends_at timestamptz,
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists live_streams_org on public.live_streams (org_id, starts_at desc);
alter table public.live_streams enable row level security; revoke all on public.live_streams from anon, authenticated;

create or replace function public.live_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.dig_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'url', l.url, 'image_url', l.image_url, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'audience', l.audience, 'active', l.active,
      'state', case when not l.active then 'off' when now() > coalesce(l.ends_at, l.starts_at + interval '3 hours') then 'past' when now() >= l.starts_at then 'live' else 'scheduled' end) order by l.starts_at desc)
    from live_streams l where l.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.live_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text := trim(coalesce(p->>'title', '')); v_url text := trim(coalesce(p->>'url', '')); v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
        v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_id uuid := p_id;
begin
  perform public.dig_need(p_org);
  if length(v_title) not between 1 and 120 then raise exception 'dig_title_required'; end if;
  if v_url !~* '^https://' or length(v_url) > 600 then raise exception 'dig_invalid_link'; end if;
  if v_start is null then raise exception 'dig_start_required'; end if;
  if v_end is not null and v_end <= v_start then raise exception 'dig_bad_period'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'dig_invalid_audience'; end if;
  if p_id is null then insert into live_streams (org_id, title, url, image_url, starts_at, ends_at, audience, active, created_by) values (p_org, v_title, v_url, nullif(p->>'image_url', ''), v_start, v_end, v_aud, coalesce((p->>'active')::boolean, true), auth.uid()) returning id into v_id;
  else update live_streams set title = v_title, url = v_url, image_url = nullif(p->>'image_url', ''), starts_at = v_start, ends_at = v_end, audience = v_aud, active = coalesce((p->>'active')::boolean, active) where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  perform public.mod_log(p_org, 'digital', 'live', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('title', v_title));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.live_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l live_streams;
begin
  select * into l from live_streams where id = p_id; if l.id is null then raise exception 'not_found'; end if;
  perform public.dig_need(l.org_id);
  delete from live_streams where id = p_id;
  perform public.mod_log(l.org_id, 'digital', 'live', p_id, 'delete', null, jsonb_build_object('title', l.title));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- planos: anotacoes pessoais e lembrete diario
create table if not exists public.reading_plan_notes (
  plan_id uuid not null references public.reading_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_no int not null,
  body text not null check (length(body) between 1 and 2000),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id, day_no)
);
alter table public.reading_plan_notes enable row level security; revoke all on public.reading_plan_notes from anon, authenticated;
alter table public.reading_plan_enrollments add column if not exists remind boolean not null default false;
alter table public.reading_plan_enrollments add column if not exists remind_time time not null default '07:00';
alter table public.reading_plan_enrollments add column if not exists last_reminded_on date;

create or replace function public.notif_group(p_kind text) returns text language sql immutable as $$
  select case
    when p_kind = 'announcement' then 'comunicados'
    when p_kind like 'event\_%' or p_kind in ('registration','evento') then 'eventos'
    when p_kind like 'schedule\_%' or p_kind like 'roster\_%' or p_kind like 'escala\_%' or p_kind in ('rehearsal','repertoire') then 'escalas'
    when p_kind like 'fin\_%' then 'financeiro'
    when p_kind = 'message' then 'conversas'
    when p_kind = 'devocional' or p_kind = 'plan_reminder' then 'lembretes'
    else 'essencial' end
$$;

create or replace function public.plan_note_set(p_id uuid, p_day int, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_body text := trim(coalesce(p_body, ''));
begin
  if not exists (select 1 from reading_plan_enrollments where plan_id = p_id and user_id = auth.uid()) then raise exception 'dig_not_enrolled'; end if;
  if not exists (select 1 from reading_plan_days where plan_id = p_id and day_no = p_day) then raise exception 'not_found'; end if;
  if length(v_body) > 2000 then raise exception 'dig_note_long'; end if;
  if v_body = '' then delete from reading_plan_notes where plan_id = p_id and user_id = auth.uid() and day_no = p_day;
  else insert into reading_plan_notes (plan_id, user_id, day_no, body) values (p_id, auth.uid(), p_day, v_body)
    on conflict (plan_id, user_id, day_no) do update set body = excluded.body, updated_at = now(); end if;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.plan_remind_set(p_id uuid, p_on boolean, p_time text default '07:00') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_time time;
begin
  begin v_time := coalesce(nullif(p_time, ''), '07:00')::time; exception when others then raise exception 'dig_bad_time'; end;
  update reading_plan_enrollments set remind = coalesce(p_on, false), remind_time = v_time where plan_id = p_id and user_id = auth.uid();
  if not found then raise exception 'dig_not_enrolled'; end if;
  return jsonb_build_object('ok', true);
end $$;
-- chamada a cada 15 min (pg_cron): um aviso por plano por dia, depois do horario escolhido, so para quem ativou e ainda nao concluiu
create or replace function public.plan_remind_dispatch() returns int
language plpgsql security definer set search_path = public as $$
declare e record; v_today date := (now() at time zone 'America/Sao_Paulo')::date; v_now time := (now() at time zone 'America/Sao_Paulo')::time; n int := 0; d record;
begin
  for e in select x.* , p.title from reading_plan_enrollments x join reading_plans p on p.id = x.plan_id
            where x.remind and p.status = 'published' and v_now >= x.remind_time and (x.last_reminded_on is null or x.last_reminded_on < v_today) loop
    select dd.day_no, dd.passage into d from reading_plan_days dd where dd.plan_id = e.plan_id
      and not exists (select 1 from reading_plan_progress g where g.plan_id = e.plan_id and g.user_id = e.user_id and g.day_no = dd.day_no) order by dd.day_no limit 1;
    update reading_plan_enrollments set last_reminded_on = v_today where plan_id = e.plan_id and user_id = e.user_id;
    if d.day_no is null then continue; end if;
    perform public.notify_user(e.user_id, e.org_id, 'plan_reminder', 'Hora da leitura: ' || e.title, 'Dia ' || d.day_no || E' \u00b7 ' || d.passage, '#/planos/' || e.plan_id, null);
    n := n + 1;
  end loop;
  return n;
end $$;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-lembretes-leitura';
  perform cron.schedule('somos-lembretes-leitura', '*/15 * * * *', 'select public.plan_remind_dispatch()');
exception when others then raise notice E'pg_cron indispon\u00edvel: %', sqlerrm;
end $$;

create or replace function public.plan_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl reading_plans; pe people; v_enr boolean;
begin
  select * into pl from reading_plans where id = p_id; if pl.id is null then raise exception 'not_found'; end if;
  perform public.dig_member(pl.org_id);
  select * into pe from public.dig_me(pl.org_id);
  v_enr := exists (select 1 from reading_plan_enrollments where plan_id = p_id and user_id = auth.uid());
  if not (v_enr or public.dig_staff(pl.org_id) or (pl.status = 'published' and public.dig_aud_ok(pl.audience, pe))) then raise exception 'not_found'; end if;
  return jsonb_build_object('id', pl.id, 'title', pl.title, 'description', pl.description, 'image_url', pl.image_url, 'status', pl.status, 'enrolled', v_enr, 'remind', (select jsonb_build_object('on', e.remind, 'time', to_char(e.remind_time, 'HH24:MI')) from reading_plan_enrollments e where e.plan_id = p_id and e.user_id = auth.uid()),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day_no', d.day_no, 'title', d.title, 'passage', d.passage, 'note', d.note, 'url', d.url,
        'done', exists (select 1 from reading_plan_progress g where g.plan_id = p_id and g.user_id = auth.uid() and g.day_no = d.day_no),
        'my_note', (select n.body from reading_plan_notes n where n.plan_id = p_id and n.user_id = auth.uid() and n.day_no = d.day_no)) order by d.day_no) from reading_plan_days d where d.plan_id = p_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- aviso no celular (push): base pronta; so envia quando houver chaves VAPID na Edge Function push-send
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint ~* '^https://'),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, body text, link text,
  created_at timestamptz not null default now(),
  sent_at timestamptz, attempts int not null default 0, error text
);
create index if not exists push_outbox_pending on public.push_outbox (id) where sent_at is null;
alter table public.push_subscriptions enable row level security; alter table public.push_outbox enable row level security;
revoke all on public.push_subscriptions, public.push_outbox from anon, authenticated;

-- toda notificacao criada (ja respeitando as preferencias) vira um envio para quem tem celular cadastrado
create or replace function public.push_enqueue() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_subscriptions where user_id = new.user_id) then
    insert into push_outbox (user_id, title, body, link) values (new.user_id, left(new.title, 120), left(new.body, 200), new.link);
  end if;
  return new;
end $$;
drop trigger if exists push_enqueue_trg on public.notifications;
create trigger push_enqueue_trg after insert on public.notifications for each row execute function public.push_enqueue();

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_endpoint, '') !~* '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'push_invalid'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
    on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.push_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('devices', (select count(*) from push_subscriptions where user_id = auth.uid()));
end $$;
-- uso exclusivo da Edge Function (chave de servico): pega os pendentes e registra o resultado
create or replace function public.push_claim(p_limit int default 100) returns jsonb
language sql security definer set search_path = public as $$
  with c as (select id from push_outbox where sent_at is null and attempts < 3 order by id limit least(greatest(coalesce(p_limit, 100), 1), 500) for update skip locked),
       u as (update push_outbox o set attempts = attempts + 1 from c where o.id = c.id returning o.id, o.user_id, o.title, o.body, o.link)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'link', u.link,
     'subs', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb) from push_subscriptions s where s.user_id = u.user_id))), '[]'::jsonb) from u
$$;
create or replace function public.push_report(p_done bigint[], p_dead text[], p_error text default null) returns void
language sql security definer set search_path = public as $$
  with a as (update push_outbox set sent_at = now(), error = null where id = any (coalesce(p_done, '{}')) returning 1),
       b as (delete from push_subscriptions where endpoint = any (coalesce(p_dead, '{}')) returning 1),
       c as (update push_outbox set error = left(p_error, 300) where p_error is not null and sent_at is null and attempts > 0 and id > (select coalesce(max(id), 0) - 500 from push_outbox) returning 1)
  select null::void
$$;
revoke execute on function public.push_enqueue(), public.push_claim(int), public.push_report(bigint[], text[], text), public.plan_remind_dispatch() from public, anon, authenticated;
grant execute on function public.push_claim(int), public.push_report(bigint[], text[], text), public.plan_remind_dispatch() to service_role;

revoke execute on function public.live_list(uuid), public.live_save(uuid, uuid, jsonb), public.live_delete(uuid), public.plan_note_set(uuid, int, text), public.plan_remind_set(uuid, boolean, text),
  public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_status(), public.search_all(uuid, text), public.content_list(uuid, jsonb), public.plan_get(uuid), public.sermon_list(uuid, jsonb) from public, anon;
grant execute on function public.live_list(uuid), public.live_save(uuid, uuid, jsonb), public.live_delete(uuid), public.plan_note_set(uuid, int, text), public.plan_remind_set(uuid, boolean, text),
  public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_status(), public.search_all(uuid, text), public.content_list(uuid, jsonb), public.plan_get(uuid), public.sermon_list(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- Home: card ao vivo
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
  v_order := array['live'] || array(select x from unnest(v_order) x where x <> 'live');
  v_order := v_order || array(select x from unnest(array['contents','plan']) x where x <> all (v_order));
  v_max := coalesce(st.max_cards, 8);

  -- 0. transmissao ao vivo (ou prestes a comecar): so entre 15 min antes do inicio e o fim, e so para o publico escolhido
  select l.id lid, l.title, l.url, l.image_url, l.starts_at, l.ends_at into r
    from live_streams l where l.org_id = p_org and l.active and now() >= l.starts_at - interval '15 minutes' and now() <= coalesce(l.ends_at, l.starts_at + interval '3 hours')
     and public.dig_aud_ok(l.audience, pe) order by l.starts_at limit 1;
  if r.lid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'live', 'kind', 'feature', 'label', case when now() >= r.starts_at then 'Ao vivo agora' else E'Come\u00e7a em instantes' end, 'title', r.title,
      'body', E'Hoje \u00e0s ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI'), 'action', 'Assistir ao vivo', 'url', r.url, 'icon', 'play', 'image', r.image_url, 'urgent', true, 'tier', 1);
  end if;

  -- 1. atividade pendente de uma jornada em andamento
  select pt.id pid, j.name, j.image_url, public.jr_pct(pt.id) pct, (select name from public.jr_current(pt.id)) step,
         (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id)) pend into r
    from journey_participants pt join journeys j on j.id = pt.journey_id
   where pt.person_id = any (v_ids) and pt.status = 'active' and j.status = 'active'
     and (select coalesce(sum(req_total - req_done), 0) from public.jr_steps(pt.id)) > 0 order by pt.updated_at desc limit 1;
  if r.pid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'continue', 'kind', 'progress', 'label', 'Sua jornada', 'title', E'Continue de onde voc\u00ea parou.', 'body', r.name || coalesce(E' \u00b7 ' || r.step, ''),
      'action', 'Continuar', 'route', '#/jornadas/' || r.pid, 'icon', 'route', 'image', r.image_url, 'pct', r.pct, 'tier', 1);
  end if;

  -- 2. destaques e conteudos cadastrados (campanhas, estudos, pregacoes)
  for it in select * from discover_items i where i.org_id = p_org and i.archived_at is null and i.active order by i.urgent desc, i.priority desc, coalesce(i.starts_at, i.created_at) desc loop
    if not public.disc_visible(it, pe, v_ids) then continue; end if;
    k := case it.kind when 'campaign' then 'campaign' when 'study' then 'study' else 'sermon' end;
    if k <> 'campaign' and exists (select 1 from unnest(v_cards) c where c->>'key' = k) then continue; end if;
    if k = 'campaign' and (select count(*) from unnest(v_cards) c where c->>'key' = 'campaign') >= 3 then continue; end if;
    v_cards := v_cards || jsonb_build_object('key', k, 'kind', case when k = 'campaign' then 'feature' else 'content' end, 'urgent', it.urgent, 'item_id', it.id,
      'label', case k when 'campaign' then case when it.urgent then 'Comunicado importante' else 'Destaque' end when 'study' then 'Estudo' else E'\u00daltima prega\u00e7\u00e3o' end,
      'title', it.title, 'body', it.body, 'action', coalesce(it.action_label, case k when 'study' then 'Assistir agora' when 'sermon' then 'Assistir' else 'Saiba mais' end),
      'route', case when it.url ~ '^#/' then it.url end, 'url', case when it.url ~* '^https?://' then it.url end, 'image', it.image_url, 'icon', case k when 'campaign' then 'megaphone' else 'play' end, 'tier', 1);
  end loop;

  -- 3. proximos eventos: eventos com inscricao (publicados e do publico da pessoa) e, na falta deles, a agenda simples da igreja
  select count(*) n, (array_agg(e.title order by e.starts_at))[1] t, min(e.starts_at) d, bool_or(public.ev_reg_state(e) in ('open','full')) opn into r
    from ev_events e where e.org_id = p_org and e.status = 'published' and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and e.starts_at <= now() + interval '90 days' and public.ev_eligible(e, pe);
  if r.n > 0 then
    v_cards := v_cards || jsonb_build_object('key', 'events', 'kind', 'event', 'label', case when r.opn then E'Inscri\u00e7\u00f5es abertas' else 'Eventos' end, 'title', 'Tem algo especial chegando.', 'body', r.t || E' \u00b7 ' || to_char(r.d at time zone 'America/Sao_Paulo', E'DD/MM "\u00e0s" HH24:MI'),
      'action', case when r.opn then 'Inscrever-se' else 'Ver eventos' end, 'route', '#/eventos', 'icon', 'calendar', 'count', r.n, 'tier', 1);
  else
    select count(*) n, (array_agg(e.title order by e.starts_at))[1] t, min(e.starts_at) d into r from church_events e where e.org_id = p_org and e.starts_at >= now() - interval '3 hours' and e.starts_at <= now() + interval '45 days';
    if r.n > 0 then
      v_cards := v_cards || jsonb_build_object('key', 'events', 'kind', 'event', 'label', 'Agenda', 'title', 'Tem algo especial chegando.', 'body', r.t || E' \u00b7 ' || to_char(r.d at time zone 'America/Sao_Paulo', E'DD/MM "\u00e0s" HH24:MI'),
        'action', 'Ver eventos', 'route', '#/agenda', 'icon', 'calendar', 'count', r.n, 'tier', 1);
    end if;
  end if;

  -- 4. comunicados reais publicados nas ultimas semanas
  select a.title, a.image_url into r from announcements a where a.org_id = p_org and a.team_id is null and a.created_at > now() - interval '30 days' order by a.created_at desc limit 1;
  if r.title is not null then
    v_cards := v_cards || jsonb_build_object('key', 'notices', 'kind', 'notice', 'label', 'Comunicado', 'title', 'Fique por dentro.', 'body', r.title, 'action', 'Ver comunicado', 'route', '#/avisos', 'icon', 'megaphone', 'image', r.image_url, 'tier', 1);
  end if;

  -- 5. convite para uma jornada aberta ao publico desta pessoa
  select count(*) n, (array_agg(j.name order by j.created_at desc))[1] nm, (array_agg(j.image_url order by j.created_at desc))[1] im into r
    from journeys j where j.org_id = p_org and j.status = 'active' and j.visibility = 'public' and j.enroll_voluntary and pe.id is not null
     and (j.eligible_classes is null or pe.classification = any (j.eligible_classes))
     and not exists (select 1 from journey_participants x where x.journey_id = j.id and x.person_id = any (v_ids) and x.status <> 'cancelled');
  if r.n > 0 then
    v_cards := v_cards || jsonb_build_object('key', 'journeys', 'kind', 'journey', 'label', 'Jornadas', 'title', E'Existe uma jornada esperando por voc\u00ea.',
      'body', case when r.n = 1 then r.nm else r.n || E' jornadas abertas para inscri\u00e7\u00e3o' end, 'action', 'Explorar jornadas', 'route', '#/jornadas', 'icon', 'route', 'image', case when r.n = 1 then r.im end, 'tier', 2);
  end if;

  -- 6. convite a decisao: so para quem ainda nao tem decisao registrada e nao e membro
  if public.decision_eligible(p_org) then
    v_cards := v_cards || jsonb_build_object('key', 'decision', 'kind', 'horizontal', 'label', 'Um passo importante', 'title', 'Quer dar um passo importante na sua caminhada?',
      'body', E'Registre sua decis\u00e3o ou converse com nossa equipe.', 'action', 'Saiba mais', 'route', '#/decisao', 'icon', 'heart', 'tier', 1);
  end if;

  -- 7. carteira digital: so membro elegivel com carteira ativa
  if pe.id is not null and v_member and pe.status = 'active' then
    select * into w from wallets where org_id = p_org and person_id = pe.id; wc := public.wl_cfg(p_org);
    if w.id is not null and public.wl_effective(w, pe, wc) = 'active' then
      v_cards := v_cards || jsonb_build_object('key', 'wallet', 'kind', 'compact', 'label', 'Carteira', 'title', E'Sua identifica\u00e7\u00e3o est\u00e1 aqui.', 'body', 'Acesse sua Carteira Digital de Membro.', 'action', 'Ver carteira', 'route', '#/carteira', 'icon', 'badge', 'tier', 2);
    end if;
  end if;

  -- 7b. plano de leitura em andamento ou aberto para comecar; conteudo novo publicado para o publico da pessoa (so o que existe e a pessoa pode abrir)
  select p.id pid, p.title, p.image_url, e.user_id is not null enrolled,
         (select count(*) from reading_plan_progress g where g.plan_id = p.id and g.user_id = auth.uid()) done,
         (select count(*) from reading_plan_days d where d.plan_id = p.id) total into r
    from reading_plans p left join reading_plan_enrollments e on e.plan_id = p.id and e.user_id = auth.uid()
   where p.org_id = p_org and p.status = 'published' and public.dig_aud_ok(p.audience, pe)
     and exists (select 1 from reading_plan_days d where d.plan_id = p.id)
     and (e.user_id is null or (select count(*) from reading_plan_progress g where g.plan_id = p.id and g.user_id = auth.uid()) < (select count(*) from reading_plan_days d where d.plan_id = p.id))
   order by (e.user_id is not null) desc, p.created_at desc limit 1;
  if r.pid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'plan', 'kind', case when r.enrolled then 'progress' else 'horizontal' end, 'label', 'Plano de leitura',
      'title', case when r.enrolled then 'Continue o seu plano de leitura.' else E'Que tal come\u00e7ar um plano de leitura?' end, 'body', r.title, 'action', case when r.enrolled then 'Continuar' else 'Conhecer' end,
      'route', '#/planos/' || r.pid, 'icon', 'book', 'image', r.image_url, 'pct', case when r.enrolled and r.total > 0 then (r.done * 100 / r.total)::int end, 'tier', case when r.enrolled then 1 else 2 end);
  end if;
  select c.id cid, c.title, c.kind, c.image_url, c.description into r
    from content_items c where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe) and c.kind <> 'institutional'
   order by c.published_at desc limit 1;
  if r.cid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'contents', 'kind', 'content', 'label', case r.kind when 'video' then E'V\u00eddeo' when 'audio' then E'\u00c1udio' when 'study' then 'Estudo' else 'Material' end,
      'title', r.title, 'body', left(coalesce(r.description, ''), 140), 'action', case r.kind when 'video' then 'Assistir' when 'audio' then 'Ouvir' when 'download' then 'Baixar' else 'Abrir' end,
      'route', '#/conteudos/' || r.cid, 'icon', case r.kind when 'audio' then 'music' when 'video' then 'play' else 'book' end, 'image', r.image_url, 'tier', 2);
  end if;

  -- 8. ministerios e oportunidades de participacao (so se houver time)
  if exists (select 1 from teams t where t.org_id = p_org) then
    v_cards := v_cards || jsonb_build_object('key', 'ministries', 'kind', 'horizontal', 'label', 'Participe',
      'title', case when v_member then E'H\u00e1 um lugar para voc\u00ea servir.' else E'Fa\u00e7a parte da nossa comunidade.' end,
      'body', E'Conhe\u00e7a os minist\u00e9rios, as atividades e as oportunidades de participa\u00e7\u00e3o.', 'action', 'Conhecer', 'route', '#/times', 'icon', 'users', 'tier', 2);
  end if;

  -- 9. contato com a igreja (quem ainda nao e membro)
  if pe.id is null or v_cls <> 'member' then
    v_cards := v_cards || jsonb_build_object('key', 'contact', 'kind', 'compact', 'label', 'Fale com a igreja', 'title', 'Quer conversar com a igreja?', 'body', E'Pe\u00e7a para a nossa equipe entrar em contato com voc\u00ea.', 'action', 'Solicitar contato', 'route', '#/contato', 'icon', 'chat', 'tier', 2);
  end if;

  -- 10. atualizacao cadastral: ficha sem alteracao ha mais de 180 dias e sem pedido em andamento
  if pe.id is not null and pe.status = 'active' and coalesce(pe.updated_at, pe.created_at) < now() - interval '180 days'
     and not exists (select 1 from person_update_requests q where q.person_id = pe.id and q.status in ('draft','pending','in_review')) then
    v_cards := v_cards || jsonb_build_object('key', 'cadastro', 'kind', 'compact', 'label', 'Cadastro', 'title', E'Seus dados est\u00e3o atualizados?', 'body', E'Mantenha suas informa\u00e7\u00f5es atualizadas para facilitar nossa comunica\u00e7\u00e3o.', 'action', 'Atualizar cadastro', 'route', '#/meu-cadastro', 'icon', 'user', 'tier', 2);
  end if;

  -- ordem escolhida pela administracao; urgentes sempre na frente
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
  -- variedade: os convites institucionais (tier 2) giram de lugar a cada dia, sem esconder avisos nem conteudos
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
grant execute on function public.home_discover(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Para desfazer: reaplicar search_all, content_list, plan_get, sermon_list, home_discover e notif_group das migracoes anteriores; dropar live_*, plan_note_set, plan_remind_*, push_* e as tabelas live_streams, reading_plan_notes, push_* (apaga anotacoes e transmissoes!).
-- ---------------------------------------------------------------------
-- Verificacao (deve retornar true):
select public.dig_match(E'Conhecendo a B\u00edblia', 'biblia') and public.dig_match(E'Conhecendo a B\u00edblia', 'bibila') and not public.dig_match('Culto de Jovens', 'batismo')
   and to_regclass('public.live_streams') is not null and to_regclass('public.reading_plan_notes') is not null and to_regclass('public.push_subscriptions') is not null
   and pg_get_functiondef('public.home_discover(uuid)'::regprocedure) like '%live_streams%' as digital_melhorias_ok;
