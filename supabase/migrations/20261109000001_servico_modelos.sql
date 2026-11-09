-- Modelos de checklist por função: ponto de partida que cada time pode editar (acrescentar, trocar, remover).
alter table public.teams add column if not exists service_seeded boolean not null default false;

-- (padrão de nome da função, item, minutos antes do início [negativo = antes], posição)
-- padrão nulo = vale para todos os escalados
create or replace function public.service_template()
returns table (pattern text, label text, off int, pos int)
language sql immutable as $$
  values
  (null, 'Chegar ao local', -30, 10),
  (null, 'Conferir a escala e o que você vai fazer', -30, 11),
  (null, 'Participar da oração da equipe', -10, 12),
  (null, 'Tudo pronto para começar', -5, 13),

  ('bateri|percuss', 'Montar a bateria e conferir o banco', -45, 20),
  ('bateri|percuss', 'Limpar a bateria e arrumar os pratos', -40, 21),
  ('bateri|percuss', 'Afinar e conferir pele, pedal e ferragens', -35, 22),
  ('bateri|percuss', 'Preparar o metrônomo/click e o retorno', -30, 23),
  ('bateri|percuss', 'Passagem de som', -25, 24),
  ('bateri|percuss', 'Separar baquetas reserva', null, 25),

  ('viol(ã|a)o|cavaquinho|ukulele', 'Afinar o violão', -35, 20),
  ('viol(ã|a)o|cavaquinho|ukulele', 'Conferir cabo, bateria/pilha e capotraste', -30, 21),
  ('viol(ã|a)o|cavaquinho|ukulele', 'Passagem de som', -25, 22),

  ('guitarra', 'Afinar e conferir os timbres e pedais', -35, 20),
  ('guitarra', 'Conferir cabos, fonte e amplificador', -30, 21),
  ('guitarra', 'Passagem de som', -25, 22),

  ('baixo', 'Afinar e conferir cabo e amplificador', -35, 20),
  ('baixo', 'Ouvir o tom de cada música', -30, 21),
  ('baixo', 'Passagem de som', -25, 22),

  ('teclado|piano|keys|sintetizador', 'Ligar e conferir timbres e pads de cada música', -35, 20),
  ('teclado|piano|keys|sintetizador', 'Conferir cabos, pedal de sustain e fonte', -30, 21),
  ('teclado|piano|keys|sintetizador', 'Passagem de som', -25, 22),

  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Aquecer a voz e beber água', -30, 20),
  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Rever letras e tons das músicas', -30, 21),
  ('vocal|voz|cantor|backing|soprano|contralto|tenor', 'Testar microfone e retorno', -25, 22),

  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Confirmar o repertório e a ordem com a equipe', -45, 20),
  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Alinhar transições e avisos com quem conduz o culto', -25, 21),
  ('dire(ç|c)(ã|a)o|coordena|ministro|dirigente|l(í|i)der', 'Reunir a equipe para orar', -10, 22),

  ('^som$|(á|a)udio|mesa|sonoplast', 'Ligar os equipamentos na ordem certa', -60, 20),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Conferir canais, microfones e cabos', -50, 21),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Passagem de som com todos', -35, 22),
  ('^som$|(á|a)udio|mesa|sonoplast', 'Ajustar o volume ambiente e salvar a cena', -15, 23),

  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Abrir o programa e carregar letras e slides', -45, 20),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Testar projetor/TV e os fundos', -35, 21),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Conferir a ordem das músicas e os avisos', -25, 22),
  ('proje(ç|c)|m(í|i)dia|slide|letra|propres|holyrics', 'Alinhar com o louvor', -15, 23),

  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Carregar baterias e conferir cartão/armazenamento', -60, 20),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Posicionar câmeras e conferir o enquadramento', -50, 21),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Testar o áudio e a internet', -40, 22),
  ('transmiss|corte|c(â|a)mera|v(í|i)deo|live|stream|foto', 'Iniciar a transmissão/gravação', -5, 23),

  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Abrir as portas e conferir o ambiente', -40, 20),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Conferir materiais e informativos', -30, 21),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Posicionar-se nos pontos combinados', -20, 22),
  ('portaria|recep|acolh|diac|visitante|estacion|seguran', 'Receber quem chega com um sorriso', -10, 23),

  ('ofert', 'Conferir cestas, envelopes e maquininha', -30, 20),
  ('ofert', 'Combinar o momento do ofertório com a equipe', -15, 21),

  ('auxiliar', 'Perguntar ao líder onde ajudar', -35, 20),
  ('auxiliar', 'Ajudar na montagem e na organização', -30, 21),

  ('ilumina', 'Ligar a iluminação e testar as cenas', -45, 20),
  ('ilumina', 'Conferir os focos no palco e no púlpito', -30, 21),
  ('ilumina', 'Alinhar as cenas com a ordem do culto', -15, 22),

  ('santa ceia', 'Preparar os elementos e os utensílios', -40, 20),
  ('santa ceia', 'Combinar o momento com quem conduz', -20, 21),

  ('altar', 'Conferir o altar e o púlpito (água, Bíblia, microfone)', -30, 20),
  ('altar', 'Ficar atento a quem precisa de apoio', -10, 21),

  ('ber(ç|c)(á|a)rio', 'Preparar o ambiente e conferir os itens de cuidado', -40, 20),
  ('ber(ç|c)(á|a)rio', 'Receber as famílias com atenção', -10, 21),

  ('introdu', 'Rever os pontos da introdução', -30, 20),

  ('introdu', 'Alinhar com a banda a entrada', -20, 21),

  ('professor|(á|a)rea kids|kids|crian', 'Rever a lição e o material', -45, 20),
  ('professor|(á|a)rea kids|kids|crian', 'Preparar a sala', -30, 21),
  ('professor|(á|a)rea kids|kids|crian', 'Receber as crianças e as famílias', -10, 22)
$$;

-- Cria o ponto de partida do time uma única vez (qualquer membro do time pode disparar).
create or replace function public.ensure_service_checklist(p_team uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; t record;
begin
  if not (public.is_team_member(p_team) or public.is_org_admin(public.team_org(p_team))) then
    raise exception 'sem permissão';
  end if;
  select * into t from public.teams where id = p_team for update;
  if t.service_seeded then return 0; end if;
  insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
  select t.org_id, p_team, null, s.pos, s.label, s.off from public.service_template() s where s.pattern is null;
  get diagnostics n = row_count;
  insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
  select t.org_id, p_team, r.id, s.pos, s.label, s.off
  from public.music_roles r
  join public.service_template() s on s.pattern is not null and r.name ~* s.pattern
  where r.org_id = t.org_id and (r.team_type is null or r.team_type = t.team_type);
  update public.teams set service_seeded = true where id = p_team;
  return n;
end $$;

-- Líder: devolve o modelo de uma função (ou de "todos", com p_role nulo), sem repetir itens que já existem.
create or replace function public.restore_service_template(p_team uuid, p_role uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; t record; r record;
begin
  if not public.can_manage_team(p_team) then raise exception 'sem permissão'; end if;
  select * into t from public.teams where id = p_team;
  if p_role is null then
    insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
    select t.org_id, p_team, null, s.pos, s.label, s.off from public.service_template() s
    where s.pattern is null and not exists (select 1 from public.role_checklist_items i where i.team_id = p_team and i.role_id is null and i.label = s.label);
  else
    select * into r from public.music_roles where id = p_role and org_id = t.org_id;
    if not found then raise exception 'função inválida'; end if;
    insert into public.role_checklist_items (org_id, team_id, role_id, position, label, offset_min)
    select t.org_id, p_team, r.id, s.pos, s.label, s.off from public.service_template() s
    where s.pattern is not null and r.name ~* s.pattern
      and not exists (select 1 from public.role_checklist_items i where i.team_id = p_team and i.role_id = r.id and i.label = s.label);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ensure_service_checklist(uuid), public.restore_service_template(uuid, uuid) from public, anon;
grant execute on function public.ensure_service_checklist(uuid), public.restore_service_template(uuid, uuid) to authenticated;

-- verificação:
-- select count(*) as itens_do_modelo from public.service_template();
