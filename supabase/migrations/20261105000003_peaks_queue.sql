-- Fila das faixas já convertidas que ainda não têm a forma de onda pronta (gerada pelo conversor no GitHub).
create or replace function public.peaks_queue(p_limit int default 30)
returns table (org_id uuid, drive_file_id text, src text, key text, bytes bigint, info jsonb)
language sql stable security definer set search_path = public as $$
  select la.org_id, la.drive_file_id, la.src, la.key, la.bytes, la.info
  from light_audio la
  where la.key is not null and la.info is not null and la.info->'peaks' is null
  order by la.updated_at desc
  limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.peaks_queue(int) from public, anon, authenticated;
grant execute on function public.peaks_queue(int) to service_role;
