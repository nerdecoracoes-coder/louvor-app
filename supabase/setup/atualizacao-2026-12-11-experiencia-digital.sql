-- =====================================================================
-- SOMOS — Fase 5: Experiência Digital.
--  * Conteúdos digitais: vídeos, áudios, estudos, materiais para download e conteúdos institucionais, com séries, público e rascunho/publicado.
--  * Planos de leitura: dias com passagem e anotação, inscrição e progresso por pessoa (cada um só vê o próprio progresso; a gestão vê apenas contagens).
--  * Atalhos institucionais configuráveis na Home (rótulo, ícone, destino, público, ordem; no máximo 8).
--  * Busca integrada (eventos, programações, agenda da igreja, pregações, conteúdos, planos, comunicados, informações da igreja) que respeita permissões e público.
--  * Pregações continuam em sermons (Fase 4); nada é duplicado. Home e menu passam a conhecer conteúdos e planos.
--  * Permissão nova: dig_manage (administrador ou concessão; liderança de time e desenvolvedor não ganham acesso).
-- =====================================================================
create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin',
               'fin_view','fin_entry','fin_approve','fin_manage','fin_donors',
               'comm_manage','comm_publish','comm_sermons','care_prayer','care_pastoral','care_manage','dig_manage']::text[]
$$;

create table if not exists public.content_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text check (description is null or length(description) <= 500),
  image_url text check (image_url is null or length(image_url) <= 600),
  created_at timestamptz not null default now()
);
create unique index if not exists content_series_name on public.content_series (org_id, lower(name));
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('video','audio','study','download','institutional')),
  title text not null check (length(trim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 3000),
  series_id uuid references public.content_series(id) on delete set null,
  category text check (category is null or length(category) <= 40),
  url text check (url is null or (length(url) <= 600 and url ~* '^https?://')),
  file_url text check (file_url is null or (length(file_url) <= 600 and file_url ~* '^https?://')),
  image_url text check (image_url is null or length(image_url) <= 600),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or url is not null or file_url is not null or kind in ('study','institutional'))
);
create index if not exists content_items_org on public.content_items (org_id, status, published_at desc);
create table if not exists public.reading_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  image_url text check (image_url is null or length(image_url) <= 600),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.reading_plan_days (
  plan_id uuid not null references public.reading_plans(id) on delete cascade,
  day_no int not null check (day_no between 1 and 400),
  title text check (title is null or length(title) <= 120),
  passage text not null check (length(trim(passage)) between 1 and 160),
  note text check (note is null or length(note) <= 1000),
  url text check (url is null or (length(url) <= 600 and url ~* '^https?://')),
  primary key (plan_id, day_no)
);
create table if not exists public.reading_plan_enrollments (
  plan_id uuid not null references public.reading_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  started_on date not null default current_date,
  primary key (plan_id, user_id)
);
create table if not exists public.reading_plan_progress (
  plan_id uuid not null references public.reading_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_no int not null,
  done_at timestamptz not null default now(),
  primary key (plan_id, user_id, day_no)
);
create table if not exists public.home_shortcuts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 24),
  icon text not null default 'link' check (icon in ('link','calendar','star','heart','book','play','music','megaphone','users','gift','badge','image','file','user')),
  route text not null check (length(route) <= 400 and (route ~* '^https://' or route ~ '^#/[a-z0-9/_-]*$')),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists home_shortcuts_org on public.home_shortcuts (org_id, active, position);
do $$ declare t text; begin
  foreach t in array array['content_series','content_items','reading_plans','reading_plan_days','reading_plan_enrollments','reading_plan_progress','home_shortcuts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- auxiliares
create or replace function public.dig_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and 'dig_manage' = any (g.actions)))
$$;
create or replace function public.dig_need(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.dig_staff(p_org) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.dig_member(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
end $$;
create or replace function public.dig_aud_ok(p_aud text, pe public.people) returns boolean
language sql stable as $$ select p_aud = 'all' or (pe.id is not null and pe.classification = p_aud) $$;
create or replace function public.dig_me(p_org uuid) returns public.people
language sql stable security definer set search_path = public as $$
  select p from people p where p.org_id = p_org and p.user_id = auth.uid() and p.status in ('active','inactive','pending') order by p.created_at limit 1
$$;
create or replace function public.dig_has_contents(p_org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from public.dig_me(p_org);
  return exists (select 1 from content_items c where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe));
end $$;
create or replace function public.dig_has_plans(p_org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  select * into pe from public.dig_me(p_org);
  return exists (select 1 from reading_plans p where p.org_id = p_org and p.status = 'published' and public.dig_aud_ok(p.audience, pe) and exists (select 1 from reading_plan_days d where d.plan_id = p.id))
      or exists (select 1 from reading_plan_enrollments e where e.org_id = p_org and e.user_id = auth.uid());
end $$;
revoke execute on function public.dig_staff(uuid), public.dig_need(uuid), public.dig_member(uuid), public.dig_aud_ok(text, public.people), public.dig_me(uuid), public.dig_has_contents(uuid), public.dig_has_plans(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- conteúdos: gestão
create or replace function public.dig_content_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.dig_need(p_org);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'description', c.description, 'series_id', c.series_id, 'series', s.name, 'category', c.category, 'url', c.url, 'file_url', c.file_url,
        'image_url', c.image_url, 'audience', c.audience, 'status', c.status, 'published_at', c.published_at) order by (c.status = 'draft') desc, c.created_at desc)
      from content_items c left join content_series s on s.id = c.series_id where c.org_id = p_org), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'image_url', s.image_url) order by lower(s.name)) from content_series s where s.org_id = p_org), '[]'::jsonb));
end $$;
create or replace function public.dig_content_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text := trim(coalesce(p->>'title', '')); v_kind text := coalesce(nullif(p->>'kind', ''), 'video'); v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_series uuid := nullif(p->>'series_id', '')::uuid;
        v_url text := nullif(trim(coalesce(p->>'url', '')), ''); v_file text := nullif(trim(coalesce(p->>'file_url', '')), ''); v_id uuid := p_id; old content_items;
begin
  perform public.dig_need(p_org);
  if length(v_title) not between 1 and 160 then raise exception 'dig_title_required'; end if;
  if v_kind not in ('video','audio','study','download','institutional') then raise exception 'dig_invalid_kind'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'dig_invalid_audience'; end if;
  if v_series is not null and not exists (select 1 from content_series where id = v_series and org_id = p_org) then raise exception 'dig_invalid_series'; end if;
  if (v_url is not null and v_url !~* '^https?://') or (v_file is not null and v_file !~* '^https?://') then raise exception 'dig_invalid_link'; end if;
  if length(coalesce(p->>'description', '')) > 3000 then raise exception 'dig_body_long'; end if;
  if p_id is null then
    insert into content_items (org_id, kind, title, description, series_id, category, url, file_url, image_url, audience, created_by)
    values (p_org, v_kind, v_title, nullif(trim(coalesce(p->>'description', '')), ''), v_series, nullif(left(trim(coalesce(p->>'category', '')), 40), ''), v_url, v_file, nullif(p->>'image_url', ''), v_aud, auth.uid()) returning id into v_id;
  else
    select * into old from content_items where id = p_id and org_id = p_org for update; if old.id is null then raise exception 'not_found'; end if;
    if old.status = 'published' and v_url is null and v_file is null and v_kind not in ('study','institutional') then raise exception 'dig_link_required'; end if;
    update content_items set kind = v_kind, title = v_title, description = nullif(trim(coalesce(p->>'description', '')), ''), series_id = v_series, category = nullif(left(trim(coalesce(p->>'category', '')), 40), ''),
      url = v_url, file_url = v_file, image_url = nullif(p->>'image_url', ''), audience = v_aud, updated_at = now() where id = p_id;
  end if;
  perform public.mod_log(p_org, 'digital', 'content', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('title', v_title, 'kind', v_kind));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.dig_content_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c content_items;
begin
  select * into c from content_items where id = p_id for update; if c.id is null then raise exception 'not_found'; end if;
  perform public.dig_need(c.org_id);
  if p_status not in ('draft','published') then raise exception 'dig_invalid_status'; end if;
  if p_status = 'published' and c.url is null and c.file_url is null and c.kind not in ('study','institutional') then raise exception 'dig_link_required'; end if;
  update content_items set status = p_status, published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = p_id;
  perform public.mod_log(c.org_id, 'digital', 'content', p_id, p_status, null, jsonb_build_object('title', c.title));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.dig_series_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id uuid := p_id;
begin
  perform public.dig_need(p_org);
  if length(v_name) not between 1 and 100 then raise exception 'name_required'; end if;
  begin
    if p_id is null then insert into content_series (org_id, name, description, image_url) values (p_org, v_name, nullif(trim(coalesce(p->>'description', '')), ''), nullif(p->>'image_url', '')) returning id into v_id;
    else update content_series set name = v_name, description = nullif(trim(coalesce(p->>'description', '')), ''), image_url = nullif(p->>'image_url', '') where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  exception when unique_violation then raise exception 'name_taken'; end;
  perform public.mod_log(p_org, 'digital', 'series', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- conteúdos: leitura pelo membro (só publicados e do seu público)
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
        and (v_q is null or c.title ilike '%' || v_q || '%' or c.description ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%' or c.category ilike '%' || v_q || '%')), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by lower(s.name)) from content_series s
        where s.org_id = p_org and exists (select 1 from content_items c where c.series_id = s.id and c.status = 'published' and public.dig_aud_ok(c.audience, pe))), '[]'::jsonb),
    'can_manage', public.dig_staff(p_org));
end $$;
create or replace function public.content_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c content_items; pe people;
begin
  select * into c from content_items where id = p_id; if c.id is null then raise exception 'not_found'; end if;
  perform public.dig_member(c.org_id);
  select * into pe from public.dig_me(c.org_id);
  if not (public.dig_staff(c.org_id) or (c.status = 'published' and public.dig_aud_ok(c.audience, pe))) then raise exception 'not_found'; end if;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'description', c.description, 'series', (select name from content_series where id = c.series_id), 'category', c.category,
    'url', c.url, 'file_url', c.file_url, 'image_url', c.image_url, 'published_at', c.published_at, 'status', c.status);
end $$;

-- ---------------------------------------------------------------- planos de leitura
create or replace function public.plan_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text := trim(coalesce(p->>'title', '')); v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_id uuid := p_id; d jsonb; n int := 0; v_days jsonb := p->'days';
begin
  perform public.dig_need(p_org);
  if length(v_title) not between 1 and 120 then raise exception 'dig_title_required'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'dig_invalid_audience'; end if;
  if v_days is not null and (jsonb_typeof(v_days) <> 'array' or jsonb_array_length(v_days) > 400) then raise exception 'dig_invalid_days'; end if;
  if p_id is null then insert into reading_plans (org_id, title, description, image_url, audience, created_by) values (p_org, v_title, nullif(trim(coalesce(p->>'description', '')), ''), nullif(p->>'image_url', ''), v_aud, auth.uid()) returning id into v_id;
  else update reading_plans set title = v_title, description = nullif(trim(coalesce(p->>'description', '')), ''), image_url = nullif(p->>'image_url', ''), audience = v_aud, updated_at = now() where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  if v_days is not null then
    -- só é possível acrescentar ou alterar dias; remover dia de plano com progresso apagaria o histórico das pessoas
    if exists (select 1 from reading_plan_progress g where g.plan_id = v_id) and jsonb_array_length(v_days) < (select count(*) from reading_plan_days where plan_id = v_id) then raise exception 'dig_plan_in_use'; end if;
    delete from reading_plan_days where plan_id = v_id;
    for d in select * from jsonb_array_elements(v_days) loop
      n := n + 1;
      if length(trim(coalesce(d->>'passage', ''))) not between 1 and 160 then raise exception 'dig_passage_required'; end if;
      if nullif(trim(coalesce(d->>'url', '')), '') is not null and (d->>'url') !~* '^https?://' then raise exception 'dig_invalid_link'; end if;
      insert into reading_plan_days (plan_id, day_no, title, passage, note, url) values (v_id, n, nullif(left(trim(coalesce(d->>'title', '')), 120), ''), trim(d->>'passage'), nullif(left(trim(coalesce(d->>'note', '')), 1000), ''), nullif(trim(coalesce(d->>'url', '')), ''));
    end loop;
  end if;
  perform public.mod_log(p_org, 'digital', 'plan', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('title', v_title, 'days', n));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.plan_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl reading_plans;
begin
  select * into pl from reading_plans where id = p_id for update; if pl.id is null then raise exception 'not_found'; end if;
  perform public.dig_need(pl.org_id);
  if p_status not in ('draft','published') then raise exception 'dig_invalid_status'; end if;
  if p_status = 'published' and not exists (select 1 from reading_plan_days where plan_id = p_id) then raise exception 'dig_plan_empty'; end if;
  update reading_plans set status = p_status, updated_at = now() where id = p_id;
  perform public.mod_log(pl.org_id, 'digital', 'plan', p_id, p_status, null, jsonb_build_object('title', pl.title));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.plan_admin_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.dig_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'image_url', p.image_url, 'audience', p.audience, 'status', p.status,
      'days', coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'passage', d.passage, 'note', d.note, 'url', d.url) order by d.day_no) from reading_plan_days d where d.plan_id = p.id), '[]'::jsonb),
      'enrolled', (select count(*) from reading_plan_enrollments e where e.plan_id = p.id), 'finished', (select count(*) from reading_plan_enrollments e where e.plan_id = p.id and
        (select count(*) from reading_plan_progress g where g.plan_id = p.id and g.user_id = e.user_id) >= (select count(*) from reading_plan_days d where d.plan_id = p.id) and exists (select 1 from reading_plan_days d where d.plan_id = p.id)))
      order by (p.status = 'draft') desc, p.created_at desc) from reading_plans p where p.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.plans_for_me(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  perform public.dig_member(p_org);
  select * into pe from public.dig_me(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'image_url', p.image_url, 'enrolled', e.user_id is not null,
      'total', (select count(*) from reading_plan_days d where d.plan_id = p.id), 'done', (select count(*) from reading_plan_progress g where g.plan_id = p.id and g.user_id = auth.uid()))
      order by (e.user_id is not null) desc, p.created_at desc)
    from reading_plans p left join reading_plan_enrollments e on e.plan_id = p.id and e.user_id = auth.uid()
    where p.org_id = p_org and ((p.status = 'published' and public.dig_aud_ok(p.audience, pe)) or e.user_id is not null)
      and exists (select 1 from reading_plan_days d where d.plan_id = p.id)), '[]'::jsonb);
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
  return jsonb_build_object('id', pl.id, 'title', pl.title, 'description', pl.description, 'image_url', pl.image_url, 'status', pl.status, 'enrolled', v_enr,
    'days', coalesce((select jsonb_agg(jsonb_build_object('day_no', d.day_no, 'title', d.title, 'passage', d.passage, 'note', d.note, 'url', d.url,
        'done', exists (select 1 from reading_plan_progress g where g.plan_id = p_id and g.user_id = auth.uid() and g.day_no = d.day_no)) order by d.day_no) from reading_plan_days d where d.plan_id = p_id), '[]'::jsonb));
end $$;
create or replace function public.plan_enroll(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl reading_plans; pe people;
begin
  select * into pl from reading_plans where id = p_id; if pl.id is null then raise exception 'not_found'; end if;
  perform public.dig_member(pl.org_id);
  select * into pe from public.dig_me(pl.org_id);
  if not (pl.status = 'published' and public.dig_aud_ok(pl.audience, pe)) then raise exception 'not_found'; end if;
  insert into reading_plan_enrollments (plan_id, user_id, org_id) values (p_id, auth.uid(), pl.org_id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.plan_mark(p_id uuid, p_day int, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from reading_plan_enrollments where plan_id = p_id and user_id = auth.uid()) then raise exception 'dig_not_enrolled'; end if;
  if not exists (select 1 from reading_plan_days where plan_id = p_id and day_no = p_day) then raise exception 'not_found'; end if;
  if coalesce(p_done, true) then insert into reading_plan_progress (plan_id, user_id, day_no) values (p_id, auth.uid(), p_day) on conflict do nothing;
  else delete from reading_plan_progress where plan_id = p_id and user_id = auth.uid() and day_no = p_day; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- atalhos institucionais
create or replace function public.shortcut_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.dig_need(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'icon', s.icon, 'route', s.route, 'audience', s.audience, 'position', s.position, 'active', s.active) order by s.position, s.created_at) from home_shortcuts s where s.org_id = p_org), '[]'::jsonb);
end $$;
create or replace function public.shortcut_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_label text := trim(coalesce(p->>'label', '')); v_route text := trim(coalesce(p->>'route', '')); v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_id uuid := p_id; v_active boolean := coalesce((p->>'active')::boolean, true);
begin
  perform public.dig_need(p_org);
  if length(v_label) not between 1 and 24 then raise exception 'dig_label_required'; end if;
  if v_route !~* '^https://' and v_route !~ '^#/[a-z0-9/_-]*$' then raise exception 'dig_invalid_link'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'dig_invalid_audience'; end if;
  if v_active and (select count(*) from home_shortcuts where org_id = p_org and active and id is distinct from p_id) >= 8 then raise exception 'dig_too_many_shortcuts'; end if;
  if p_id is null then insert into home_shortcuts (org_id, label, icon, route, audience, position, active) values (p_org, v_label, coalesce(nullif(p->>'icon', ''), 'link'), v_route, v_aud, coalesce((p->>'position')::int, 0), v_active) returning id into v_id;
  else update home_shortcuts set label = v_label, icon = coalesce(nullif(p->>'icon', ''), icon), route = v_route, audience = v_aud, position = coalesce((p->>'position')::int, position), active = v_active where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  perform public.mod_log(p_org, 'digital', 'shortcut', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('label', v_label));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.shortcut_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s home_shortcuts;
begin
  select * into s from home_shortcuts where id = p_id; if s.id is null then raise exception 'not_found'; end if;
  perform public.dig_need(s.org_id);
  delete from home_shortcuts where id = p_id;
  perform public.mod_log(s.org_id, 'digital', 'shortcut', p_id, 'delete', null, jsonb_build_object('label', s.label));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.shortcuts_for_me(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  perform public.dig_member(p_org);
  select * into pe from public.dig_me(p_org);
  return coalesce((select jsonb_agg(jsonb_build_object('label', s.label, 'icon', s.icon, 'route', s.route) order by s.position, s.created_at)
    from home_shortcuts s where s.org_id = p_org and s.active and public.dig_aud_ok(s.audience, pe)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- busca integrada (só o que a pessoa pode abrir)
create or replace function public.search_all(p_org uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
        select * from ev_events e where e.org_id = p_org and e.status = 'published' and e.starts_at >= now() - interval '1 day' and public.ev_eligible(e, pe) and (e.title ilike v_like or e.description ilike v_like or e.location ilike v_like) order by e.starts_at limit 6) e), '[]'::jsonb))),
    (jsonb_build_object('key', 'agenda', 'label', 'Agenda e programações', 'items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('title', p.name, 'sub', coalesce(p.location, initcap(p.category)), 'route', '#/agenda') x from prog_items p where p.org_id = p_org
          and (v_mgr or (p.status = 'published' and (p.visibility = 'public' or (p.visibility = 'members' and v_member) or (p.visibility = 'leaders' and v_leader)))) and p.status <> 'cancelled' and (p.name ilike v_like or p.description ilike v_like or p.location ilike v_like) order by p.name limit 6) a), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'sub', to_char(c.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'route', '#/agenda')) from (
        select * from church_events c where c.org_id = p_org and c.starts_at >= now() - interval '1 day' and (c.title ilike v_like or c.description ilike v_like) order by c.starts_at limit 4) c), '[]'::jsonb))),
    (jsonb_build_object('key', 'sermons', 'label', 'Pregações', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'sub', coalesce(s.preacher, ''), 'route', '#/pregacoes?q=' || replace(s.title, ' ', '%20')) order by s.preached_on desc nulls last) from (
        select * from sermons s where s.org_id = p_org and s.status = 'published' and (s.audience = 'all' or (pe.id is not null and pe.classification = s.audience))
          and (s.title ilike v_like or s.preacher ilike v_like or s.scripture ilike v_like or s.description ilike v_like) order by s.preached_on desc nulls last limit 6) s), '[]'::jsonb))),
    (jsonb_build_object('key', 'contents', 'label', 'Conteúdos', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'sub', case c.kind when 'video' then 'Vídeo' when 'audio' then 'Áudio' when 'study' then 'Estudo' when 'download' then 'Material' else 'Institucional' end, 'route', '#/conteudos/' || c.id) order by c.published_at desc) from (
        select * from content_items c left join lateral (select 1) z on true where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe)
          and (c.title ilike v_like or c.description ilike v_like or c.category ilike v_like or exists (select 1 from content_series s where s.id = c.series_id and s.name ilike v_like)) order by c.published_at desc limit 6) c), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'sub', 'Plano de leitura', 'route', '#/planos/' || p.id)) from (
        select * from reading_plans p where p.org_id = p_org and p.status = 'published' and public.dig_aud_ok(p.audience, pe) and (p.title ilike v_like or p.description ilike v_like) and exists (select 1 from reading_plan_days d where d.plan_id = p.id) limit 4) p), '[]'::jsonb))),
    (jsonb_build_object('key', 'notices', 'label', 'Comunicados', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', a.title, 'sub', to_char(a.created_at at time zone 'America/Sao_Paulo', 'DD/MM'), 'route', '#/avisos') order by a.created_at desc) from (
        select * from announcements a where a.org_id = p_org and a.team_id is null and public.comm_ann_ok(a) and (a.title ilike v_like or a.body ilike v_like) order by a.created_at desc limit 6) a), '[]'::jsonb))),
    (jsonb_build_object('key', 'church', 'label', 'Informações da igreja', 'items', coalesce((select jsonb_agg(jsonb_build_object('title', o.name, 'sub', coalesce(o.subtitle, ''), 'route', '#/igreja')) from organizations o where o.id = p_org and (o.name ilike v_like or o.subtitle ilike v_like)), '[]'::jsonb)))
  ) as t(g)));
end $$;

revoke execute on function public.dig_content_list(uuid), public.dig_content_save(uuid, uuid, jsonb), public.dig_content_set_status(uuid, text), public.dig_series_save(uuid, uuid, jsonb),
  public.content_list(uuid, jsonb), public.content_get(uuid), public.plan_save(uuid, uuid, jsonb), public.plan_set_status(uuid, text), public.plan_admin_list(uuid), public.plans_for_me(uuid), public.plan_get(uuid),
  public.plan_enroll(uuid), public.plan_mark(uuid, int, boolean), public.shortcut_list(uuid), public.shortcut_save(uuid, uuid, jsonb), public.shortcut_delete(uuid), public.shortcuts_for_me(uuid), public.search_all(uuid, text) from public, anon;
grant execute on function public.dig_content_list(uuid), public.dig_content_save(uuid, uuid, jsonb), public.dig_content_set_status(uuid, text), public.dig_series_save(uuid, uuid, jsonb),
  public.content_list(uuid, jsonb), public.content_get(uuid), public.plan_save(uuid, uuid, jsonb), public.plan_set_status(uuid, text), public.plan_admin_list(uuid), public.plans_for_me(uuid), public.plan_get(uuid),
  public.plan_enroll(uuid), public.plan_mark(uuid, int, boolean), public.shortcut_list(uuid), public.shortcut_save(uuid, uuid, jsonb), public.shortcut_delete(uuid), public.shortcuts_for_me(uuid), public.search_all(uuid, text) to authenticated;

-- ---------------------------------------------------------------- menu e Home passam a conhecer conteúdos e planos
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
    'decision', public.decision_eligible(p_org),
    'contents', public.dig_has_contents(p_org), 'plans', public.dig_has_plans(p_org),
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
  v_order := v_order || array(select x from unnest(array['contents','plan']) x where x <> all (v_order));
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
  if public.decision_eligible(p_org) then
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

  -- 7b. plano de leitura em andamento ou aberto para começar; conteúdo novo publicado para o público da pessoa (só o que existe e a pessoa pode abrir)
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
      'title', case when r.enrolled then 'Continue o seu plano de leitura.' else 'Que tal começar um plano de leitura?' end, 'body', r.title, 'action', case when r.enrolled then 'Continuar' else 'Conhecer' end,
      'route', '#/planos/' || r.pid, 'icon', 'book', 'image', r.image_url, 'pct', case when r.enrolled and r.total > 0 then (r.done * 100 / r.total)::int end, 'tier', case when r.enrolled then 1 else 2 end);
  end if;
  select c.id cid, c.title, c.kind, c.image_url, c.description into r
    from content_items c where c.org_id = p_org and c.status = 'published' and public.dig_aud_ok(c.audience, pe) and c.kind <> 'institutional'
   order by c.published_at desc limit 1;
  if r.cid is not null then
    v_cards := v_cards || jsonb_build_object('key', 'contents', 'kind', 'content', 'label', case r.kind when 'video' then 'Vídeo' when 'audio' then 'Áudio' when 'study' then 'Estudo' else 'Material' end,
      'title', r.title, 'body', left(coalesce(r.description, ''), 140), 'action', case r.kind when 'video' then 'Assistir' when 'audio' then 'Ouvir' when 'download' then 'Baixar' else 'Abrir' end,
      'route', '#/conteudos/' || r.cid, 'icon', case r.kind when 'audio' then 'music' when 'video' then 'play' else 'book' end, 'image', r.image_url, 'tier', 2);
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

-- ---------------------------------------------------------------------
-- Para desfazer: reaplicar my_menu e home_discover da migração 20261210000001 e dropar as funções dig_*, content_*, plan_*, shortcut*, search_all e as tabelas content_*, reading_plan*, home_shortcuts (apaga o conteúdo e o progresso!).
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select 'dig_manage' = any (public.module_actions()) and to_regclass('public.content_items') is not null and to_regclass('public.reading_plans') is not null
   and exists (select 1 from pg_proc where proname = 'search_all') and pg_get_functiondef('public.my_menu(uuid)'::regprocedure) like '%dig_has_contents%'
   and pg_get_functiondef('public.home_discover(uuid)'::regprocedure) like '%reading_plan_progress%' as experiencia_digital_ok;
