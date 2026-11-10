-- Repertório da escala enviado ao Ministério de Multimídia.
-- mm_sent_at: quando o Louvor confirmou que o repertório está pronto; mm_sig: assinatura das músicas/versões/tons no envio;
-- mm_changed: o repertório foi alterado depois do envio (a Multimídia espera um novo envio).
alter table public.schedules
  add column if not exists mm_sent_at timestamptz,
  add column if not exists mm_sent_by uuid references auth.users(id) on delete set null,
  add column if not exists mm_sig text,
  add column if not exists mm_changed boolean not null default false;

-- envia (ou reenvia) o repertório da escala publicada; avisa todos os times de Multimídia da igreja
create or replace function public.send_repertoire(p_schedule uuid, p_sig text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype; resent boolean;
begin
  select * into s from schedules where id = p_schedule;
  if not found or not public.can_manage_team(s.team_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'published' then raise exception 'publique a escala antes de enviar o repertório' using errcode = '22023'; end if;
  resent := s.mm_sent_at is not null;
  update schedules set mm_sent_at = now(), mm_sent_by = auth.uid(), mm_sig = p_sig, mm_changed = false where id = p_schedule;
  perform public.notify_user(u.user_id, s.org_id, 'repertoire',
    case when resent then 'Repertório atualizado: ' else 'Repertório recebido: ' end || s.title,
    to_char(s.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'), '#/repertorio-culto/' || s.id, jsonb_build_object('schedule_id', s.id))
  from (select distinct tm.user_id from team_members tm join teams t on t.id = tm.team_id
        where t.org_id = s.org_id and t.team_type = 'multimidia' and tm.user_id <> auth.uid()) u;
end $$;

-- o repertório já enviado foi alterado: a Multimídia é avisada e espera o novo envio
create or replace function public.mark_repertoire_changed(p_schedule uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s schedules%rowtype;
begin
  select * into s from schedules where id = p_schedule;
  if not found or not public.can_manage_team(s.team_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.mm_sent_at is null or s.mm_changed then return; end if;
  update schedules set mm_changed = true where id = p_schedule;
  perform public.notify_user(u.user_id, s.org_id, 'repertoire', 'Repertório alterado: ' || s.title,
    'O Louvor mudou o repertório. Aguarde o novo envio.', '#/repertorio-culto/' || s.id, jsonb_build_object('schedule_id', s.id))
  from (select distinct tm.user_id from team_members tm join teams t on t.id = tm.team_id
        where t.org_id = s.org_id and t.team_type = 'multimidia' and tm.user_id <> auth.uid()) u;
end $$;

-- repertórios recebidos (de hoje em diante) ou um específico; só para quem é de um time de Multimídia da igreja ou administra
create or replace function public.media_repertoires(p_schedule uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at), '[]'::jsonb) from (
    select s.id, s.title, s.starts_at, s.location, t.name as team_name, s.mm_sent_at, s.mm_changed,
      (select coalesce(jsonb_agg(jsonb_build_object('position', ss.position, 'title', ss.title_snapshot, 'artist', ss.artist_snapshot, 'key', ss.song_key,
          'version', ss.version_name, 'bpm', coalesce(ss.bpm, so.bpm), 'notes', ss.notes) order by ss.position), '[]'::jsonb)
         from schedule_songs ss left join songs so on so.id = ss.song_id where ss.schedule_id = s.id) as songs
    from schedules s join teams t on t.id = s.team_id
    where s.mm_sent_at is not null and s.status = 'published'
      and ((p_schedule is null and s.starts_at >= now() - interval '1 day') or s.id = p_schedule)
      and (public.is_org_admin(s.org_id) or exists (select 1 from team_members tm join teams mt on mt.id = tm.team_id
            where tm.user_id = auth.uid() and mt.org_id = s.org_id and mt.team_type = 'multimidia'))
  ) x
$$;
revoke execute on function public.send_repertoire(uuid, text), public.mark_repertoire_changed(uuid), public.media_repertoires(uuid) from public, anon;
grant execute on function public.send_repertoire(uuid, text), public.mark_repertoire_changed(uuid), public.media_repertoires(uuid) to authenticated;

-- verificação:
-- select exists (select 1 from information_schema.columns where table_name='schedules' and column_name='mm_sent_at') as colunas,
--   to_regprocedure('public.send_repertoire(uuid,text)') is not null as enviar, to_regprocedure('public.media_repertoires(uuid)') is not null as ler;
