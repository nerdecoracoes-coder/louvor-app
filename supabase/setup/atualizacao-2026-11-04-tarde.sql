-- Atualização de 04/11/2026 (pode rodar mais de uma vez): recursos dos times + versão leve das faixas.
-- Cole tudo no SQL Editor do Supabase e clique em Run.
-- =====================================================================
-- Recursos de cada time (04/11/2026)
-- O tipo do time sugere os recursos (Louvor já vem com o repertório), e o administrador pode ajustar.
-- Recursos disponíveis hoje:
--   repertorio  Músicas, player multitrack e integração com o Google Drive
-- O acesso ao repertório passa a depender do recurso do time (e não mais só do tipo).
-- A integração com o Drive pode ser gerenciada pelo administrador e pelos líderes de times com repertório.
-- =====================================================================

alter table public.teams add column if not exists features text[];

-- recursos sugeridos para cada tipo de time
create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case when p_type = 'louvor' then array['repertorio']::text[] else '{}'::text[] end
$$;

update public.teams set features = public.team_feature_preset(team_type) where features is null;

-- novo time sem recursos informados recebe os do tipo; só o administrador altera os recursos de um time
create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;
drop trigger if exists t_fill_team_features on public.teams;
create trigger t_fill_team_features before insert or update on public.teams
  for each row execute function public.fill_team_features();

create or replace function public.team_has_repertoire(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and 'repertorio' = any(features))
$$;

create or replace function public.has_repertoire(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and 'repertorio' = any(t.features)
      and (tm.access_until is null or tm.access_until >= (now() at time zone 'America/Sao_Paulo')::date))
$$;

create or replace function public.is_repertoire_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org) or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where tm.org_id = p_org and tm.user_id = auth.uid() and tm.is_leader and 'repertorio' = any(t.features))
$$;

-- Google Drive: administrador e líderes de times com repertório acompanham e gerenciam a integração
drop policy if exists di_select on public.drive_integrations;
create policy di_select on public.drive_integrations for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists sr_select on public.sync_runs;
create policy sr_select on public.sync_runs for select to authenticated using (public.is_repertoire_staff(org_id));
drop policy if exists se_select on public.sync_events;
create policy se_select on public.sync_events for select to authenticated using (public.is_repertoire_staff(org_id));

-- =====================================================================
-- Versão leve das faixas (04/11/2026)
-- Cada áudio do Drive ganha uma cópia compactada (Opus) no Cloudflare R2, gerada pelo conversor no GitHub.
-- O player usa a versão leve quando ela existe; senão, continua lendo o WAV do Drive.
-- A cópia é identificada pelo arquivo do Drive + conteúdo (md5): a mesma faixa em versões diferentes do
-- projeto reaproveita a mesma cópia. O original no Drive nunca é alterado.
-- =====================================================================

create table if not exists public.light_audio (
  org_id uuid not null references public.organizations(id) on delete cascade,
  drive_file_id text not null,
  src text not null,                 -- md5 do arquivo (ou "s<tamanho>" quando o Drive não informa)
  key text,                          -- caminho no bucket
  info jsonb,                        -- canais, pre-skip, amostras, índice de páginas
  bytes bigint,
  error text,                        -- falha na conversão (nova tentativa depois de um tempo)
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (drive_file_id, src)
);
create index if not exists light_audio_org on public.light_audio (org_id);
alter table public.light_audio enable row level security;
revoke all on public.light_audio from anon;
drop policy if exists la_select on public.light_audio;
create policy la_select on public.light_audio for select to authenticated using (public.has_repertoire(org_id));
-- escrita só pelo servidor (chave de serviço)

-- Fila do conversor: áudios das versões atuais dos projetos que ainda não têm versão leve.
-- Músicas mais recentes primeiro (um envio novo fica leve antes do acervo antigo).
create or replace function public.light_queue(p_limit int default 40)
returns table (org_id uuid, drive_file_id text, src text, name text, size bigint, format jsonb, song_title text)
language sql stable security definer set search_path = public as $$
  select q.org_id, q.drive_file_id, q.src, q.name, q.size, q.format, q.title from (
    select distinct on (pm.drive_file_id, coalesce(pm.md5, 's' || pm.size))
      pm.org_id, pm.drive_file_id, coalesce(pm.md5, 's' || pm.size) as src, pm.name, pm.size, pm.format, s.title, s.last_synced_at
    from project_media pm
    join multitrack_projects p on p.id = pm.project_id and p.is_current
    join songs s on s.id = p.song_id and s.status = 'ready'
    left join light_audio la on la.drive_file_id = pm.drive_file_id and la.src = coalesce(pm.md5, 's' || pm.size)
    where la.drive_file_id is null
       or (la.key is null and la.attempts < 5 and la.updated_at < now() - interval '1 hour' * power(2, la.attempts))
    order by pm.drive_file_id, coalesce(pm.md5, 's' || pm.size), s.last_synced_at desc nulls last
  ) q
  order by q.last_synced_at desc nulls last
  limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.light_queue(int) from public, anon, authenticated;
grant execute on function public.light_queue(int) to service_role;
