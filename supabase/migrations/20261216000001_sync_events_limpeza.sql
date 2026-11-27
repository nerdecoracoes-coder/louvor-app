-- Limpeza automatica do registro da sincronizacao do Drive (sync_events/sync_runs): so serve para a tela de diagnostico (ultimos 60 eventos).
-- Mantem 3 dias de eventos e 14 dias de rodadas. Nao mexe em musicas, projetos, faixas nem em nenhum dado dos usuarios.
create or replace function public.sync_purge() returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  delete from sync_events where created_at < now() - interval '3 days'; get diagnostics a = row_count;
  delete from sync_runs where started_at < now() - interval '14 days' and status <> 'running'; get diagnostics b = row_count;
  return jsonb_build_object('events', a, 'runs', b);
end $$;
revoke execute on function public.sync_purge() from public, anon, authenticated;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'somos-sync-limpeza';
  perform cron.schedule('somos-sync-limpeza', '41 3 * * *', 'select public.sync_purge()');
exception when others then raise notice 'pg_cron indisponivel: %', sqlerrm;
end $$;
