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
