-- =====================================================================
-- Verificação automática da pasta "multitracks" a cada 5 minutos.
-- Rode no SQL Editor do Supabase DEPOIS de publicar as funções.
-- Troque os dois valores marcados abaixo:
--   SEU-PROJETO  -> o identificador do seu projeto (aparece no endereço https://SEU-PROJETO.supabase.co)
--   SEU-SEGREDO  -> o mesmo valor do secret CRON_SECRET das Edge Functions
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('louvor-drive-sync') where exists (select 1 from cron.job where jobname = 'louvor-drive-sync');
select cron.schedule('louvor-drive-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/drive-sync?mode=cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU-SEGREDO'),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000)
$$);

-- Para conferir:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 5;
