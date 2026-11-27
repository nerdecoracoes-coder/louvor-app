-- =====================================================================
-- SOMOS — Fase 4A: Comunicação (comunicados com público, agendamento, validade e fixação; pregações; preferências de notificação).
--  * Reaproveita a tabela de avisos (announcements): colunas novas com padrão que mantém o comportamento atual (aviso existente = publicado para toda a igreja).
--  * Público reutiliza a Segmentação (segmentos e grupos), a classificação da pessoa e as células. Não há segundo sistema de segmentação.
--  * Rascunho, agendado, vencido e despublicado NÃO aparecem para quem não administra: a regra está na política da tabela (banco), não só na tela.
--  * Notificação interna só sai quando o comunicado está publicado e no horário, só para quem faz parte do público, e respeita as preferências de cada pessoa.
--    Limite de 5 avisos novos por pessoa em 24 h (o conteúdo continua no mural). Agendados são enviados por pg_cron a cada 10 min (se o pg_cron não estiver ativo, o app
--    mostra o comunicado na hora marcada, mas a notificação só sai quando alguém publicar de novo ou o agendamento for ativado).
--  * Notificação push (celular) e e-mail NÃO estão incluídos: dependem de chaves e serviços externos.
--  * Permissões novas: comm_manage (criar e editar), comm_publish (publicar, agendar, despublicar, fixar), comm_sermons (pregações). Só administrador ou concessão.
-- Nada é apagado: avisos publicados só são despublicados; só rascunho nunca publicado pode ser excluído.
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage','ev_view','ev_manage','ev_publish','ev_checkin',
               'fin_view','fin_entry','fin_approve','fin_manage','fin_donors',
               'comm_manage','comm_publish','comm_sermons']::text[]
$$;

create or replace function public.comm_staff(p_org uuid, p_actions text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin')
    or exists (select 1 from access_grants g where g.org_id = p_org and g.user_id = auth.uid() and g.actions && p_actions))
$$;
create or replace function public.comm_need(p_org uuid, p_actions text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.comm_staff(p_org, p_actions) then raise exception 'forbidden'; end if;
end $$;

-- ---------------------------------------------------------------- avisos: colunas novas
alter table public.announcements
  add column if not exists status text not null default 'published',
  add column if not exists audience text not null default 'all',
  add column if not exists segment_id uuid references public.seg_segments(id) on delete set null,
  add column if not exists group_id uuid references public.seg_groups(id) on delete set null,
  add column if not exists cell_id uuid references public.cells(id) on delete set null,
  add column if not exists publish_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists pinned boolean not null default false,
  add column if not exists link_label text,
  add column if not exists notified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
do $$ begin
  alter table public.announcements add constraint announcements_status_chk check (status in ('draft','published','unpublished'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.announcements add constraint announcements_audience_chk check (audience in ('all','visitor','attender','member','segment','group','cell'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.announcements add constraint announcements_link_chk check (link_url is null or (length(link_url) <= 600 and (link_url ~* '^https?://' or link_url ~ '^#/')));
exception when duplicate_object then null; end $$;
update public.announcements set notified_at = created_at where notified_at is null;   -- os avisos já existentes foram notificados pelo gatilho antigo
create index if not exists announcements_org_live on public.announcements (org_id, pinned desc, created_at desc) where team_id is null;

-- ---------------------------------------------------------------- público
create or replace function public.comm_aud_ok(p_org uuid, p_user uuid, p_aud text, p_segment uuid, p_group uuid, p_cell uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pe people; s seg_segments; v_ok boolean := false;
begin
  if p_aud = 'all' then return true; end if;
  select * into pe from people where org_id = p_org and user_id = p_user and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is null then return false; end if;
  if p_aud in ('visitor','attender','member') then return pe.classification = p_aud; end if;
  if p_aud = 'group' then return exists (select 1 from seg_group_members m where m.group_id = p_group and m.status = 'active' and m.person_id in (select id from people where org_id = p_org and user_id = p_user)); end if;
  if p_aud = 'cell' then return exists (select 1 from cell_members m where m.cell_id = p_cell and m.status = 'active' and m.person_id in (select id from people where org_id = p_org and user_id = p_user)); end if;
  if p_aud = 'segment' then
    select * into s from seg_segments where id = p_segment and org_id = p_org and active;
    if s.id is null then return false; end if;
    execute format('select exists (select 1 from public.people p where p.id = %L and (%s))', pe.id, public.sg_cond(p_org, s.criteria, 0)) into v_ok;
    return coalesce(v_ok, false);
  end if;
  return false;
end $$;

create or replace function public.comm_ann_live(a public.announcements) returns boolean
language sql stable as $$
  select a.status = 'published' and (a.publish_at is null or a.publish_at <= now()) and (a.expires_at is null or a.expires_at > now())
$$;
create or replace function public.comm_ann_ok(a public.announcements) returns boolean
language sql stable security definer set search_path = public as $$
  select public.comm_ann_live(a) and public.comm_aud_ok(a.org_id, auth.uid(), a.audience, a.segment_id, a.group_id, a.cell_id)
$$;

-- leitura: avisos de time seguem iguais; avisos da igreja só aparecem publicados, no horário, dentro da validade e para o público certo (quem administra vê tudo)
drop policy if exists an_select on public.announcements;
create policy an_select on public.announcements for select to authenticated
  using (case when team_id is not null then public.is_team_member(team_id) or public.is_org_admin(org_id)
              else public.is_org_member(org_id) and (public.can_edit_agenda(org_id) or public.comm_staff(org_id, array['comm_manage','comm_publish']) or public.comm_ann_ok(announcements)) end);

-- ---------------------------------------------------------------- preferências e envio de notificações
create table if not exists public.notif_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  grp text not null check (grp in ('comunicados','eventos','escalas','financeiro','conversas','lembretes')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id, grp)
);
alter table public.notif_prefs enable row level security;
revoke all on public.notif_prefs from anon, authenticated;

create or replace function public.notif_group(p_kind text) returns text language sql immutable as $$
  select case
    when p_kind = 'announcement' then 'comunicados'
    when p_kind like 'event\_%' or p_kind in ('registration','evento') then 'eventos'
    when p_kind like 'schedule\_%' or p_kind like 'roster\_%' or p_kind like 'escala\_%' or p_kind in ('rehearsal','repertoire') then 'escalas'
    when p_kind like 'fin\_%' then 'financeiro'
    when p_kind = 'message' then 'conversas'
    when p_kind = 'devocional' then 'lembretes'
    else 'essencial' end
$$;

-- mesma assinatura de antes; agora respeita preferências (só os grupos que podem ser silenciados) e limita avisos novos por dia
create or replace function public.notify_user(p_user uuid, p_org uuid, p_kind text, p_title text,
  p_body text default null, p_link text default null, p_data jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare g text := public.notif_group(p_kind);
begin
  if g <> 'essencial' and p_org is not null and exists (select 1 from notif_prefs where user_id = p_user and org_id = p_org and grp = g and not enabled) then return; end if;
  if p_kind = 'announcement' and (select count(*) from notifications where user_id = p_user and kind = 'announcement' and created_at > now() - interval '24 hours') >= 5 then return; end if;
  insert into notifications (user_id, org_id, kind, title, body, link, data) values (p_user, p_org, p_kind, p_title, p_body, p_link, p_data);
end $$;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.notif_prefs_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'push', jsonb_build_object('configured', false),
    'groups', (select jsonb_agg(jsonb_build_object('key', k, 'label', l, 'hint', h, 'enabled', coalesce((select enabled from notif_prefs where user_id = auth.uid() and org_id = p_org and grp = k), true)) order by o)
               from (values (1, 'comunicados', 'Comunicados', 'Avisos novos da igreja'), (2, 'eventos', 'Eventos', 'Inscrição, lista de espera e mudanças'),
                            (3, 'escalas', 'Escalas', 'Convites, mudanças e lembretes de escala'), (4, 'financeiro', 'Financeiro', 'Despesas aguardando aprovação'),
                            (5, 'conversas', 'Conversas', 'Mensagens dos times'), (6, 'lembretes', 'Lembretes', 'Devocionais e lembretes')) v(o, k, l, h)),
    'note', 'Avisos de segurança, pedidos de cuidado, solicitações pendentes e respostas a você sempre chegam.');
end $$;
create or replace function public.notif_prefs_set(p_org uuid, p_grp text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_org_member(p_org) then raise exception 'forbidden'; end if;
  if p_grp not in ('comunicados','eventos','escalas','financeiro','conversas','lembretes') then raise exception 'invalid_group'; end if;
  insert into notif_prefs (user_id, org_id, grp, enabled, updated_at) values (auth.uid(), p_org, p_grp, coalesce(p_enabled, true), now())
    on conflict (user_id, org_id, grp) do update set enabled = excluded.enabled, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- envio do comunicado (uma vez só)
create or replace function public.comm_notify(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a announcements; u record; n int := 0;
begin
  select * into a from announcements where id = p_id for update;
  if a.id is null or a.team_id is not null or a.notified_at is not null or not public.comm_ann_live(a) then return 0; end if;
  update announcements set notified_at = now() where id = p_id;
  for u in select user_id from org_members where org_id = a.org_id and user_id is distinct from a.created_by and user_id is distinct from auth.uid() loop
    if public.comm_aud_ok(a.org_id, u.user_id, a.audience, a.segment_id, a.group_id, a.cell_id) then
      perform public.notify_user(u.user_id, a.org_id, 'announcement', 'Novo aviso: ' || a.title, left(coalesce(a.body, ''), 140), '#/avisos', jsonb_build_object('announcement_id', a.id));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is null then
    perform public.comm_notify(new.id);   -- só envia se já está publicado e no horário
    return new;
  end if;
  insert into notifications (user_id, org_id, kind, title, body, link, data)
  select user_id, new.org_id, 'announcement', 'Novo aviso: ' || new.title, left(coalesce(new.body, ''), 140), '#/times/' || new.team_id || '/avisos', jsonb_build_object('announcement_id', new.id)
  from team_members where team_id = new.team_id and user_id is distinct from new.created_by;
  return new;
end $$;

create or replace function public.comm_dispatch() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from announcements where team_id is null and notified_at is null and status = 'published' and publish_at is not null and publish_at <= now() loop
    n := n + public.comm_notify(r.id);
  end loop;
  return n;
end $$;
revoke execute on function public.comm_notify(uuid), public.comm_dispatch(), public.comm_aud_ok(uuid, uuid, text, uuid, uuid, uuid), public.comm_staff(uuid, text[]), public.comm_need(uuid, text[]) from public, anon, authenticated;
grant execute on function public.comm_ann_ok(public.announcements), public.comm_ann_live(public.announcements), public.comm_staff(uuid, text[]) to authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-comunicados-agendados';
  perform cron.schedule('somos-comunicados-agendados', '*/10 * * * *', 'select public.comm_dispatch()');
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- gestão dos comunicados
create or replace function public.comm_ann_state(a public.announcements) returns text
language sql stable as $$
  select case when a.status = 'draft' then 'draft' when a.status = 'unpublished' then 'unpublished'
              when a.expires_at is not null and a.expires_at <= now() then 'expired'
              when a.publish_at is not null and a.publish_at > now() then 'scheduled' else 'live' end
$$;

create or replace function public.comm_ann_list(p_org uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_st text := nullif(p_filter->>'state', ''); v_q text := nullif(trim(coalesce(p_filter->>'q', '')), '');
begin
  perform public.comm_need(p_org, array['comm_manage','comm_publish']);
  return jsonb_build_object(
    'can', jsonb_build_object('manage', public.comm_staff(p_org, array['comm_manage']), 'publish', public.comm_staff(p_org, array['comm_publish']), 'sermons', public.comm_staff(p_org, array['comm_sermons'])),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name) from seg_segments s where s.org_id = p_org and s.active), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name) from seg_groups g where g.org_id = p_org and g.status = 'active'), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from cells c where c.org_id = p_org), '[]'::jsonb),
    'push', jsonb_build_object('configured', false),
    'items', coalesce((select jsonb_agg(x order by x->>'pin' desc, x->>'sort' desc) from (
      select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'link_url', a.link_url, 'link_label', a.link_label, 'tag', a.tag, 'image_url', a.image_url, 'audience', a.audience,
             'segment_id', a.segment_id, 'group_id', a.group_id, 'cell_id', a.cell_id, 'publish_at', a.publish_at, 'expires_at', a.expires_at, 'pinned', a.pinned, 'status', a.status,
             'state', public.comm_ann_state(a), 'notified', a.notified_at is not null, 'created_at', a.created_at, 'updated_at', a.updated_at,
             'pin', case when a.pinned then '1' else '0' end, 'sort', to_char(coalesce(a.publish_at, a.created_at), 'YYYYMMDDHH24MISS')) x
        from announcements a where a.org_id = p_org and a.team_id is null
         and (v_st is null or public.comm_ann_state(a) = v_st) and (v_q is null or a.title ilike '%' || v_q || '%') order by coalesce(a.publish_at, a.created_at) desc limit 200) t), '[]'::jsonb));
end $$;

create or replace function public.comm_ann_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a announcements; v_title text := trim(coalesce(p->>'title', '')); v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_seg uuid := nullif(p->>'segment_id', '')::uuid;
        v_grp uuid := nullif(p->>'group_id', '')::uuid; v_cell uuid := nullif(p->>'cell_id', '')::uuid; v_link text := nullif(trim(coalesce(p->>'link_url', '')), '');
        v_exp timestamptz := nullif(p->>'expires_at', '')::timestamptz; v_id uuid := p_id;
begin
  perform public.comm_need(p_org, array['comm_manage']);
  if length(v_title) not between 1 and 140 then raise exception 'comm_title_required'; end if;
  if v_aud not in ('all','visitor','attender','member','segment','group','cell') then raise exception 'comm_invalid_audience'; end if;
  if (v_aud = 'segment' and not exists (select 1 from seg_segments where id = v_seg and org_id = p_org and active))
     or (v_aud = 'group' and not exists (select 1 from seg_groups where id = v_grp and org_id = p_org and status = 'active'))
     or (v_aud = 'cell' and not exists (select 1 from cells where id = v_cell and org_id = p_org)) then raise exception 'comm_invalid_audience'; end if;
  if v_aud <> 'segment' then v_seg := null; end if; if v_aud <> 'group' then v_grp := null; end if; if v_aud <> 'cell' then v_cell := null; end if;
  if v_link is not null and not (length(v_link) <= 600 and (v_link ~* '^https?://' or v_link ~ '^#/')) then raise exception 'comm_invalid_link'; end if;
  if length(coalesce(p->>'body', '')) > 4000 then raise exception 'comm_body_long'; end if;
  begin
    if p_id is null then
      insert into announcements (org_id, team_id, title, body, link_url, link_label, tag, image_url, audience, segment_id, group_id, cell_id, expires_at, status, created_by, updated_by)
      values (p_org, null, v_title, nullif(p->>'body', ''), v_link, nullif(left(trim(coalesce(p->>'link_label', '')), 40), ''), nullif(left(trim(coalesce(p->>'tag', '')), 30), ''), nullif(p->>'image_url', ''), v_aud, v_seg, v_grp, v_cell, v_exp, 'draft', auth.uid(), auth.uid())
      returning id into v_id;
    else
      select * into a from announcements where id = p_id and org_id = p_org and team_id is null for update; if a.id is null then raise exception 'not_found'; end if;
      update announcements set title = v_title, body = nullif(p->>'body', ''), link_url = v_link, link_label = nullif(left(trim(coalesce(p->>'link_label', '')), 40), ''), tag = nullif(left(trim(coalesce(p->>'tag', '')), 30), ''),
        image_url = coalesce(nullif(p->>'image_url', ''), image_url), audience = v_aud, segment_id = v_seg, group_id = v_grp, cell_id = v_cell, expires_at = v_exp, updated_by = auth.uid(), updated_at = now() where id = p_id;
    end if;
  exception when check_violation then raise exception 'comm_invalid_link'; end;
  perform public.mod_log(p_org, 'comm', 'announcement', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('title', v_title, 'audience', v_aud));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- publica agora (p_when nulo) ou agenda para uma data futura
create or replace function public.comm_ann_publish(p_id uuid, p_when timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a announcements; v_n int := 0; v_sched boolean;
begin
  select * into a from announcements where id = p_id and team_id is null for update; if a.id is null then raise exception 'not_found'; end if;
  perform public.comm_need(a.org_id, array['comm_publish']);
  if a.expires_at is not null and a.expires_at <= coalesce(p_when, now()) then raise exception 'comm_expired'; end if;
  v_sched := p_when is not null and p_when > now();
  update announcements set status = 'published', publish_at = case when v_sched then p_when else null end, updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.mod_log(a.org_id, 'comm', 'announcement', p_id, case when v_sched then 'schedule' else 'publish' end, null, jsonb_build_object('title', a.title, 'when', p_when));
  if not v_sched then v_n := public.comm_notify(p_id); end if;
  return jsonb_build_object('ok', true, 'scheduled', v_sched, 'notified', v_n);
end $$;

create or replace function public.comm_ann_unpublish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and team_id is null for update; if a.id is null then raise exception 'not_found'; end if;
  perform public.comm_need(a.org_id, array['comm_publish']);
  if a.status <> 'published' then raise exception 'comm_not_published'; end if;
  update announcements set status = 'unpublished', pinned = false, updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.mod_log(a.org_id, 'comm', 'announcement', p_id, 'unpublish', null, jsonb_build_object('title', a.title));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comm_ann_pin(p_id uuid, p_pinned boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and team_id is null for update; if a.id is null then raise exception 'not_found'; end if;
  perform public.comm_need(a.org_id, array['comm_publish']);
  if p_pinned and a.status <> 'published' then raise exception 'comm_not_published'; end if;
  if p_pinned and not a.pinned and (select count(*) from announcements x where x.org_id = a.org_id and x.team_id is null and x.pinned and x.status = 'published') >= 3 then raise exception 'comm_too_many_pinned'; end if;
  update announcements set pinned = coalesce(p_pinned, false), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.mod_log(a.org_id, 'comm', 'announcement', p_id, case when p_pinned then 'pin' else 'unpin' end, null, jsonb_build_object('title', a.title));
  return jsonb_build_object('ok', true);
end $$;

-- só rascunho que nunca foi publicado pode ser excluído; o resto é despublicado
create or replace function public.comm_ann_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and team_id is null for update; if a.id is null then raise exception 'not_found'; end if;
  perform public.comm_need(a.org_id, array['comm_manage']);
  if a.status <> 'draft' or a.notified_at is not null then raise exception 'comm_not_draft'; end if;
  delete from announcements where id = p_id;
  perform public.mod_log(a.org_id, 'comm', 'announcement', p_id, 'delete_draft', null, jsonb_build_object('title', a.title));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- pregações e mensagens
create table if not exists public.sermon_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text check (description is null or length(description) <= 500),
  image_url text check (image_url is null or length(image_url) <= 600),
  created_at timestamptz not null default now()
);
create unique index if not exists sermon_series_name on public.sermon_series (org_id, lower(name));
create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  preacher text check (preacher is null or length(preacher) <= 120),
  preached_on date,
  series_id uuid references public.sermon_series(id) on delete set null,
  category text check (category is null or length(category) <= 40),
  scripture text check (scripture is null or length(scripture) <= 160),
  description text check (description is null or length(description) <= 3000),
  video_url text check (video_url is null or (length(video_url) <= 600 and video_url ~* '^https?://')),
  audio_url text check (audio_url is null or (length(audio_url) <= 600 and audio_url ~* '^https?://')),
  image_url text check (image_url is null or length(image_url) <= 600),
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member')),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sermons_org_date on public.sermons (org_id, status, preached_on desc nulls last);
alter table public.sermon_series enable row level security; alter table public.sermons enable row level security;
revoke all on public.sermon_series, public.sermons from anon, authenticated;

-- lista para qualquer membro (publicadas e do seu público) ou para a equipe (tudo). Busca por título, pregador, texto bíblico, série e descrição.
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
         and (v_q is null or z.title ilike '%' || v_q || '%' or z.preacher ilike '%' || v_q || '%' or z.scripture ilike '%' || v_q || '%' or z.description ilike '%' || v_q || '%' or sr.name ilike '%' || v_q || '%')
       order by z.preached_on desc nulls last, z.created_at desc limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.sermon_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text := trim(coalesce(p->>'title', '')); v_series uuid := nullif(p->>'series_id', '')::uuid; v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_links jsonb := coalesce(p->'links', '[]'::jsonb); v_id uuid := p_id; l jsonb;
begin
  perform public.comm_need(p_org, array['comm_sermons']);
  if length(v_title) not between 1 and 160 then raise exception 'comm_title_required'; end if;
  if v_aud not in ('all','visitor','attender','member') then raise exception 'comm_invalid_audience'; end if;
  if v_series is not null and not exists (select 1 from sermon_series where id = v_series and org_id = p_org) then raise exception 'comm_invalid_series'; end if;
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 8 then raise exception 'comm_invalid_link'; end if;
  for l in select * from jsonb_array_elements(v_links) loop
    if coalesce(l->>'url', '') !~* '^https?://' or length(l->>'url') > 600 or length(coalesce(l->>'label', '')) > 60 then raise exception 'comm_invalid_link'; end if;
  end loop;
  begin
    if p_id is null then
      insert into sermons (org_id, title, preacher, preached_on, series_id, category, scripture, description, video_url, audio_url, image_url, links, audience, created_by)
      values (p_org, v_title, nullif(trim(p->>'preacher'), ''), nullif(p->>'preached_on', '')::date, v_series, nullif(trim(p->>'category'), ''), nullif(trim(p->>'scripture'), ''), nullif(trim(p->>'description'), ''),
              nullif(trim(p->>'video_url'), ''), nullif(trim(p->>'audio_url'), ''), nullif(p->>'image_url', ''), v_links, v_aud, auth.uid()) returning id into v_id;
    else
      update sermons set title = v_title, preacher = nullif(trim(p->>'preacher'), ''), preached_on = nullif(p->>'preached_on', '')::date, series_id = v_series, category = nullif(trim(p->>'category'), ''),
        scripture = nullif(trim(p->>'scripture'), ''), description = nullif(trim(p->>'description'), ''), video_url = nullif(trim(p->>'video_url'), ''), audio_url = nullif(trim(p->>'audio_url'), ''),
        image_url = coalesce(nullif(p->>'image_url', ''), image_url), links = v_links, audience = v_aud, updated_at = now() where id = p_id and org_id = p_org;
      if not found then raise exception 'not_found'; end if;
    end if;
  exception when check_violation then raise exception 'comm_invalid_link'; end;
  perform public.mod_log(p_org, 'comm', 'sermon', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('title', v_title));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.sermon_set_status(p_id uuid, p_publish boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare z sermons;
begin
  select * into z from sermons where id = p_id for update; if z.id is null then raise exception 'not_found'; end if;
  perform public.comm_need(z.org_id, array['comm_sermons']);
  update sermons set status = case when p_publish then 'published' else 'draft' end, updated_at = now() where id = p_id;
  perform public.mod_log(z.org_id, 'comm', 'sermon', p_id, case when p_publish then 'publish' else 'unpublish' end, null, jsonb_build_object('title', z.title));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sermon_series_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id uuid := p_id;
begin
  perform public.comm_need(p_org, array['comm_sermons']);
  if length(v_name) not between 1 and 100 then raise exception 'comm_title_required'; end if;
  begin
    if p_id is null then insert into sermon_series (org_id, name, description, image_url) values (p_org, v_name, nullif(trim(p->>'description'), ''), nullif(p->>'image_url', '')) returning id into v_id;
    else update sermon_series set name = v_name, description = nullif(trim(p->>'description'), ''), image_url = coalesce(nullif(p->>'image_url', ''), image_url) where id = p_id and org_id = p_org; if not found then raise exception 'not_found'; end if; end if;
  exception when unique_violation then raise exception 'name_taken'; end;
  perform public.mod_log(p_org, 'comm', 'series', v_id, case when p_id is null then 'create' else 'update' end, null, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke execute on function public.comm_ann_list(uuid, jsonb), public.comm_ann_save(uuid, uuid, jsonb), public.comm_ann_publish(uuid, timestamptz), public.comm_ann_unpublish(uuid), public.comm_ann_pin(uuid, boolean),
  public.comm_ann_delete(uuid), public.sermon_list(uuid, jsonb), public.sermon_save(uuid, uuid, jsonb), public.sermon_set_status(uuid, boolean), public.sermon_series_save(uuid, uuid, jsonb),
  public.notif_prefs_get(uuid), public.notif_prefs_set(uuid, text, boolean), public.comm_ann_state(public.announcements) from public, anon;
grant execute on function public.comm_ann_list(uuid, jsonb), public.comm_ann_save(uuid, uuid, jsonb), public.comm_ann_publish(uuid, timestamptz), public.comm_ann_unpublish(uuid), public.comm_ann_pin(uuid, boolean),
  public.comm_ann_delete(uuid), public.sermon_list(uuid, jsonb), public.sermon_save(uuid, uuid, jsonb), public.sermon_set_status(uuid, boolean), public.sermon_series_save(uuid, uuid, jsonb),
  public.notif_prefs_get(uuid), public.notif_prefs_set(uuid, text, boolean), public.comm_ann_state(public.announcements) to authenticated;

-- ---------------------------------------------------------------- menu: Pregações aparece só quando há pregação publicada para a pessoa (mesma função, uma chave a mais)
create or replace function public.my_menu(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_dec boolean; v_scales boolean; v_welcome boolean; v_ev boolean; v_tk boolean; v_sm boolean;
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
  return jsonb_build_object(
    'sermons', v_sm, 'events', v_ev, 'tickets', v_tk,
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
-- Para desfazer: restaurar a política an_select e o gatilho on_announcement da migração 20261103; as colunas novas podem ficar (têm padrão seguro);
-- drop das funções comm_*/sermon_*/notif_prefs_*, das tabelas sermons, sermon_series e notif_prefs; notify_user volta à versão simples (insert direto).
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select 'comm_publish' = any (public.module_actions()) and to_regclass('public.sermons') is not null and to_regclass('public.notif_prefs') is not null
   and exists (select 1 from pg_proc where proname = 'comm_ann_publish') and exists (select 1 from information_schema.columns where table_name = 'announcements' and column_name = 'audience') as comunicacao_ok;
