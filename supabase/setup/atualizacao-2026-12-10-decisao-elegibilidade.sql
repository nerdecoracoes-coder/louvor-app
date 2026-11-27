-- =====================================================================
-- SOMOS — Correção: "Decidi seguir a Jesus" só para visitante/frequentador sem decisão registrada. Membro nunca vê.
--  * decision_eligible(org): regra única, consultada pelo menu, pelo card da Home e pelo backend do formulário (convert_self_get/submit).
--      - a ficha vinculada à conta precisa ter classificação visitante ou frequentador (se qualquer ficha da conta for membro: não);
--      - não pode existir decisão registrada (não anulada) em nenhuma ficha da conta nem feita pela própria conta;
--      - permissão ministerial (líder, voluntário, time) não entra na regra.
--  * O atalho manual (people.menu_decision) deixa de ter efeito: marcas antigas são limpas e person_menu_decision_set passa a recusar. O histórico de decisões não é tocado.
-- =====================================================================
create or replace function public.decision_eligible(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role <> 'guest')
    and exists (select 1 from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') and classification in ('visitor','attender'))
    and not exists (select 1 from people where org_id = p_org and user_id = auth.uid() and classification = 'member')
    and not exists (select 1 from faith_decisions d where d.org_id = p_org and d.voided_at is null
                     and (d.self_user = auth.uid() or d.person_id in (select id from people where org_id = p_org and user_id = auth.uid())))
$$;
revoke execute on function public.decision_eligible(uuid) from public, anon;
grant execute on function public.decision_eligible(uuid) to authenticated;

update public.people set menu_decision = false where menu_decision;
create or replace function public.person_menu_decision_set(p_person uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'decision_rule_fixed';
end $$;

create or replace function public.convert_self_get(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pe people;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if not public.decision_eligible(p_org) then raise exception 'decision_unavailable'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  return jsonb_build_object('person', case when pe.id is null then null else jsonb_build_object('id', pe.id, 'full_name', pe.full_name) end,
                            'name', coalesce(pe.full_name, public.welcome_name(p_org, auth.uid())));
end $$;
create or replace function public.convert_self_submit(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pe people; c jsonb; v_day date; v_origin text; v_wants boolean := case lower(coalesce(p->>'wants_followup', '')) when 'true' then true else null end; v_id uuid; v_ex uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from org_members where org_id = p_org and user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if not public.decision_eligible(p_org) then raise exception 'decision_unavailable'; end if;
  select * into pe from people where org_id = p_org and user_id = auth.uid() and status in ('active','inactive','pending') order by created_at limit 1;
  if pe.id is not null and not coalesce((p->>'confirm_identity')::boolean, false) then raise exception 'confirm_identity'; end if;
  v_name := coalesce(pe.full_name, nullif(trim(coalesce(p->>'name', '')), ''), public.welcome_name(p_org, auth.uid()));
  v_origin := case when p->>'origin' in ('culto','celula','evento','transmissao','outro') then p->>'origin' else 'outro' end;
  c := public.conv_clean(jsonb_build_object('name', v_name, 'phone', p->>'phone', 'email', p->>'email', 'place', p->>'place', 'origin', v_origin, 'consent', coalesce(p->>'consent', 'unknown')));
  begin v_day := coalesce(nullif(p->>'decided_on', '')::date, public.conv_today()); exception when others then raise exception 'invalid_date'; end;
  if v_day > public.conv_today() or v_day < public.conv_today() - 365 then raise exception 'invalid_date'; end if;
  select id into v_ex from faith_decisions where org_id = p_org and voided_at is null and decided_on = v_day and ((pe.id is not null and person_id = pe.id) or self_user = auth.uid()) limit 1;
  if v_ex is not null then return jsonb_build_object('ok', true, 'repeated', true); end if;
  insert into faith_decisions (org_id, person_id, display_name, decided_on, place, origin, source, phone, email, contact_consent, consent_at, wants_followup, fu_status, self_user, registered_by, linked_at, linked_by)
  values (p_org, pe.id, c->>'name', v_day, c->>'place', c->>'origin', 'app', c->>'phone', c->>'email', c->>'consent', case when c->>'consent' <> 'unknown' then now() end, v_wants,
          case when v_wants is true then 'offered' else 'registered' end, auth.uid(), auth.uid(), case when pe.id is not null then now() end, case when pe.id is not null then auth.uid() end)
  returning id into v_id;
  perform public.conv_log(v_id, p_org, 'register', jsonb_build_object('mode', 'app', 'person_id', pe.id));
  perform public.conv_history(v_id);
  if pe.id is null then perform public.conv_notify(p_org, 'link', 'Decisão de fé aguardando associação', 'Registrada pela própria pessoa no app. Escolha a ficha para concluir.', '#/novos-convertidos');
  else perform public.conv_notify(p_org, 'view', 'Nova decisão de fé registrada', null, '#/novos-convertidos/' || v_id); end if;
  if v_wants is true then perform public.conv_notify(p_org, 'assign', 'Uma pessoa pediu acompanhamento', null, '#/novos-convertidos/' || v_id); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

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

grant execute on function public.convert_self_get(uuid), public.convert_self_submit(uuid, jsonb), public.my_menu(uuid), public.home_discover(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Para desfazer: reaplicar as versões anteriores de my_menu, home_discover, convert_self_get/submit e person_menu_decision_set (migrações 20261209000002, 20261207000001, 20261130000001, 20261205000002).
-- ---------------------------------------------------------------------
-- Verificação (deve retornar true):
select to_regprocedure('public.decision_eligible(uuid)') is not null
   and pg_get_functiondef('public.my_menu(uuid)'::regprocedure) like '%decision_eligible%'
   and pg_get_functiondef('public.home_discover(uuid)'::regprocedure) like '%decision_eligible%'
   and pg_get_functiondef('public.convert_self_submit(uuid,jsonb)'::regprocedure) like '%decision_unavailable%' as decisao_regra_ok;
