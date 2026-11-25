-- =====================================================================
-- SOMOS — Menu inteligente e central de descoberta do SOMOS Um.
--  * my_menu (ampliado): decisão consultada no histórico permanente (faith_decisions), escalas por vínculo com time,
--    acolhimento (equipe com o recurso "Visitantes", administrador ou permissão de acolhimento) e pedido de arte/vídeo.
--  * Pedir arte ou vídeo: também no banco, só administrador, líder de time ou quem recebeu a permissão "media_request".
--  * Catálogo de destaques (campanhas, estudos, pregações) com público, período, prioridade e segmento (reusa a Segmentação).
--  * home_discover: cards escolhidos no servidor, só com conteúdo real e destino funcional.
-- Alteração não destrutiva: tabelas novas, funções novas/substituídas e duas permissões novas (a lista é cumulativa).
-- =====================================================================

create or replace function public.module_actions() returns text[] language sql immutable as $$
  select array['cells_view','cells_manage','cells_members','cells_meetings','cells_supervision','cells_reports',
               'prog_view','prog_manage','prog_publish','prog_run','roster_view','roster_manage','roster_approve',
               'media_request','discover_manage']::text[]
$$;

-- ---------------------------------------------------------------- pedir arte ou vídeo (também no banco)
create or replace function public.can_request_media(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
    and (public.mod_perm(p_org, 'media_request')
      or exists (select 1 from team_members m where m.org_id = p_org and m.user_id = auth.uid() and m.is_leader))
$$;
revoke execute on function public.can_request_media(uuid) from public, anon;
grant execute on function public.can_request_media(uuid) to authenticated;

drop policy if exists mr2_insert on public.media_requests;
create policy mr2_insert on public.media_requests for insert to authenticated
  with check (requested_by = auth.uid() and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'pedidos')
    and (public.can_request_media(org_id) or public.is_team_member(team_id)) and status = 'pendente');

-- ---------------------------------------------------------------- catálogo de destaques
create table if not exists public.discover_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('campaign','study','sermon')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text check (body is null or length(body) <= 300),
  action_label text check (action_label is null or length(action_label) <= 40),
  url text check (url is null or (length(url) <= 600 and (url ~* '^https?://' or url ~ '^#/'))),
  image_url text check (image_url is null or length(image_url) <= 600),
  audience text not null default 'all' check (audience in ('all','visitor','attender','member','journey','segment')),
  journey_id uuid references public.journeys(id) on delete set null,
  segment_id uuid references public.seg_segments(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  priority int not null default 50 check (priority between 0 and 100),
  urgent boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists discover_items_org on public.discover_items (org_id, kind) where archived_at is null;
alter table public.discover_items enable row level security;
revoke all on public.discover_items from anon, authenticated;

create table if not exists public.discover_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  card_order text[] not null default array['continue','campaign','study','sermon','events','notices','journeys','decision','wallet','ministries','contact','cadastro'],
  max_cards int not null default 8 check (max_cards between 3 and 12),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.discover_settings enable row level security;
revoke all on public.discover_settings from anon, authenticated;

create or replace function public.disc_keys() returns text[] language sql immutable as $$
  select array['continue','campaign','study','sermon','events','notices','journeys','decision','wallet','ministries','contact','cadastro']::text[]
$$;

create or replace function public.disc_need(p_org uuid) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.mod_perm(p_org, 'discover_manage') then raise exception 'forbidden'; end if;
end $$;
revoke execute on function public.disc_keys(), public.disc_need(uuid) from public, anon, authenticated;

-- o destaque vale para esta pessoa? (público, período e segmento; nunca usa dado pastoral)
create or replace function public.disc_visible(it public.discover_items, pe public.people, p_ids uuid[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.seg_segments; v_ok boolean := false;
begin
  if not it.active or it.archived_at is not null then return false; end if;
  if it.starts_at is not null and it.starts_at > now() then return false; end if;
  if it.ends_at is not null and it.ends_at < now() then return false; end if;
  if it.audience = 'all' then return true; end if;
  if it.audience in ('visitor','attender','member') then return pe.id is not null and pe.classification = it.audience; end if;
  if it.audience = 'journey' then
    return it.journey_id is not null and exists (select 1 from journey_participants x where x.journey_id = it.journey_id and x.person_id = any (p_ids) and x.status in ('waiting','active','paused','completed'));
  end if;
  if it.audience = 'segment' then
    if pe.id is null or it.segment_id is null then return false; end if;
    select * into s from seg_segments where id = it.segment_id and org_id = it.org_id and active;
    if s.id is null then return false; end if;
    execute format('select exists (select 1 from public.people p where p.id = %L and (%s))', pe.id, public.sg_cond(it.org_id, s.criteria, 0)) into v_ok;
    return coalesce(v_ok, false);
  end if;
  return false;
end $$;
revoke execute on function public.disc_visible(public.discover_items, public.people, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- menu (v2)
create or replace function public.my_menu(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people; v_ids uuid[]; v_dec boolean; v_scales boolean; v_welcome boolean;
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
  return jsonb_build_object(
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

-- ---------------------------------------------------------------- administração dos destaques
create or replace function public.discover_save(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it discover_items; v_id uuid := p_id; v_aud text := coalesce(nullif(p->>'audience', ''), 'all'); v_j uuid := nullif(p->>'journey_id', '')::uuid; v_s uuid := nullif(p->>'segment_id', '')::uuid;
        v_st timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_en timestamptz := nullif(p->>'ends_at', '')::timestamptz; v_kind text := coalesce(nullif(p->>'kind', ''), 'campaign');
begin
  perform public.disc_need(p_org);
  if length(trim(coalesce(p->>'title', ''))) = 0 then raise exception 'title_required'; end if;
  if v_kind not in ('campaign','study','sermon') then raise exception 'invalid_kind'; end if;
  if v_aud not in ('all','visitor','attender','member','journey','segment') then raise exception 'invalid_audience'; end if;
  if v_aud = 'journey' and not exists (select 1 from journeys where id = v_j and org_id = p_org) then raise exception 'invalid_journey'; end if;
  if v_aud = 'segment' and not exists (select 1 from seg_segments where id = v_s and org_id = p_org) then raise exception 'invalid_segment'; end if;
  if v_en is not null and v_st is not null and v_en < v_st then raise exception 'invalid_period'; end if;
  if v_aud <> 'journey' then v_j := null; end if; if v_aud <> 'segment' then v_s := null; end if;
  begin
    if p_id is null then
      insert into discover_items (org_id, kind, title, body, action_label, url, image_url, audience, journey_id, segment_id, starts_at, ends_at, priority, urgent, active, created_by)
      values (p_org, v_kind, trim(p->>'title'), nullif(trim(coalesce(p->>'body', '')), ''), nullif(trim(coalesce(p->>'action_label', '')), ''), nullif(trim(coalesce(p->>'url', '')), ''), nullif(p->>'image_url', ''), v_aud, v_j, v_s, v_st, v_en,
              coalesce((p->>'priority')::int, 50), coalesce((p->>'urgent')::boolean, false), coalesce((p->>'active')::boolean, true), auth.uid()) returning id into v_id;
      perform public.mod_log(p_org, 'discover', 'item', v_id, 'create', null, jsonb_build_object('title', p->>'title', 'audience', v_aud));
    else
      select * into it from discover_items where id = p_id and org_id = p_org; if it.id is null then raise exception 'not_found'; end if;
      update discover_items set kind = v_kind, title = trim(p->>'title'), body = nullif(trim(coalesce(p->>'body', '')), ''), action_label = nullif(trim(coalesce(p->>'action_label', '')), ''), url = nullif(trim(coalesce(p->>'url', '')), ''),
        image_url = nullif(p->>'image_url', ''), audience = v_aud, journey_id = v_j, segment_id = v_s, starts_at = v_st, ends_at = v_en, priority = coalesce((p->>'priority')::int, priority),
        urgent = coalesce((p->>'urgent')::boolean, urgent), active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = p_id;
      perform public.mod_log(p_org, 'discover', 'item', p_id, 'update', null, jsonb_build_object('before', to_jsonb(it) - 'created_by', 'title', p->>'title', 'audience', v_aud));
    end if;
  exception when check_violation then raise exception 'invalid_data'; end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.discover_set_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it discover_items;
begin
  select * into it from discover_items where id = p_id; if it.id is null then raise exception 'not_found'; end if;
  perform public.disc_need(it.org_id);
  update discover_items set active = coalesce(p_active, false), updated_at = now() where id = p_id;
  perform public.mod_log(it.org_id, 'discover', 'item', p_id, case when p_active then 'activate' else 'deactivate' end, null, jsonb_build_object('title', it.title));
  return jsonb_build_object('ok', true);
end $$;

-- arquivar: some das listas, nada é apagado
create or replace function public.discover_archive(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it discover_items;
begin
  select * into it from discover_items where id = p_id; if it.id is null then raise exception 'not_found'; end if;
  perform public.disc_need(it.org_id);
  update discover_items set archived_at = now(), active = false, updated_at = now() where id = p_id;
  perform public.mod_log(it.org_id, 'discover', 'item', p_id, 'archive', null, jsonb_build_object('title', it.title));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.discover_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.disc_need(p_org);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'created_by' order by i.created_at desc) from discover_items i where i.org_id = p_org and i.archived_at is null), '[]'::jsonb),
    'settings', (select jsonb_build_object('card_order', s.card_order, 'max_cards', s.max_cards) from discover_settings s where s.org_id = p_org),
    'keys', to_jsonb(public.disc_keys()),
    'journeys', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name) order by j.name) from journeys j where j.org_id = p_org and j.status in ('active','paused')), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name) from seg_segments g where g.org_id = p_org and g.active), '[]'::jsonb));
end $$;

create or replace function public.discover_settings_save(p_org uuid, p_order text[], p_max int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.disc_need(p_org);
  if p_order is null or not (p_order <@ public.disc_keys()) or cardinality(p_order) = 0 then raise exception 'invalid_order'; end if;
  if p_max is null or p_max not between 3 and 12 then raise exception 'invalid_max'; end if;
  insert into discover_settings (org_id, card_order, max_cards, updated_by) values (p_org, p_order, p_max, auth.uid())
    on conflict (org_id) do update set card_order = excluded.card_order, max_cards = excluded.max_cards, updated_by = auth.uid(), updated_at = now();
  perform public.mod_log(p_org, 'discover', 'settings', p_org, 'update', null, jsonb_build_object('order', p_order, 'max', p_max));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- cards da página inicial do SOMOS Um
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

  -- 3. próximos eventos (agenda publicada da igreja)
  select count(*) n, (array_agg(e.title order by e.starts_at))[1] t, min(e.starts_at) d into r from church_events e where e.org_id = p_org and e.starts_at >= now() - interval '3 hours' and e.starts_at <= now() + interval '45 days';
  if r.n > 0 then
    v_cards := v_cards || jsonb_build_object('key', 'events', 'kind', 'event', 'label', 'Agenda', 'title', 'Tem algo especial chegando.', 'body', r.t || ' · ' || to_char(r.d at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
      'action', 'Ver eventos', 'route', '#/agenda', 'icon', 'calendar', 'count', r.n, 'tier', 1);
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

revoke execute on function public.discover_save(uuid, uuid, jsonb), public.discover_set_active(uuid, boolean), public.discover_archive(uuid), public.discover_list(uuid),
  public.discover_settings_save(uuid, text[], int), public.home_discover(uuid) from public, anon;
grant execute on function public.discover_save(uuid, uuid, jsonb), public.discover_set_active(uuid, boolean), public.discover_archive(uuid), public.discover_list(uuid),
  public.discover_settings_save(uuid, text[], int), public.home_discover(uuid), public.my_menu(uuid) to authenticated;

-- verificação (deve retornar true):
--   select to_regprocedure('public.home_discover(uuid)') is not null and to_regprocedure('public.can_request_media(uuid)') is not null
--      and to_regclass('public.discover_items') is not null and 'discover_manage' = any (public.module_actions()) as ok;
-- REVERSÃO: drop function public.home_discover(uuid), public.discover_save(uuid, uuid, jsonb), public.discover_set_active(uuid, boolean), public.discover_archive(uuid), public.discover_list(uuid), public.discover_settings_save(uuid, text[], int),
--   public.disc_visible(public.discover_items, public.people, uuid[]), public.disc_need(uuid), public.disc_keys(), public.can_request_media(uuid);
--   (e, se quiser, recriar a política mr2_insert com is_org_member(org_id) no lugar de can_request_media) ; drop table public.discover_settings, public.discover_items;
