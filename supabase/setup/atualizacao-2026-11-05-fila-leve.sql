-- A fila de conversão da versão leve passa a atender primeiro as músicas das próximas escalas
-- (a mais próxima primeiro); o restante segue pela sincronização mais recente.
create or replace function public.light_queue(p_limit int default 40)
returns table (org_id uuid, drive_file_id text, src text, name text, size bigint, format jsonb, song_title text)
language sql stable security definer set search_path = public as $$
  select q.org_id, q.drive_file_id, q.src, q.name, q.size, q.format, q.title from (
    select distinct on (pm.drive_file_id, coalesce(pm.md5, 's' || pm.size))
      pm.org_id, pm.drive_file_id, coalesce(pm.md5, 's' || pm.size) as src, pm.name, pm.size, pm.format, s.title, s.last_synced_at,
      (select min(sc.starts_at) from schedule_songs ss join schedules sc on sc.id = ss.schedule_id
        where ss.song_id = s.id and sc.starts_at >= now() - interval '1 day') as next_use
    from project_media pm
    join multitrack_projects p on p.id = pm.project_id and p.is_current
    join songs s on s.id = p.song_id and s.status = 'ready'
    left join light_audio la on la.drive_file_id = pm.drive_file_id and la.src = coalesce(pm.md5, 's' || pm.size)
    where la.drive_file_id is null
       or (la.key is null and la.attempts < 5 and la.updated_at < now() - interval '1 hour' * power(2, la.attempts))
    order by pm.drive_file_id, coalesce(pm.md5, 's' || pm.size), s.last_synced_at desc nulls last
  ) q
  order by q.next_use asc nulls last, q.last_synced_at desc nulls last
  limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.light_queue(int) from public, anon, authenticated;
grant execute on function public.light_queue(int) to service_role;
