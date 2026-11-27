-- =====================================================================
-- Agendamento de webhooks e do aviso no celular (push): a cada minuto.
-- Rode no SQL Editor DEPOIS de publicar as funcoes (Actions -> Publicar no Supabase).
-- Troque so o valor SEU-SEGREDO pelo mesmo valor do secret CRON_SECRET (o mesmo do agendamento do Drive).
-- Pode rodar de novo sem problema (remove e recria os agendamentos).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('somos-webhooks', 'somos-push');

select cron.schedule('somos-webhooks', '* * * * *', $$
  select net.http_post(
    url := 'https://vqjcnrkbajgtlflklkfx.supabase.co/functions/v1/webhook-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU-SEGREDO'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$$);

select cron.schedule('somos-push', '* * * * *', $$
  select net.http_post(
    url := 'https://vqjcnrkbajgtlflklkfx.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU-SEGREDO'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$$);

-- Conferir (deve listar os dois agendamentos, ativos):
select jobname, schedule, active from cron.job where jobname in ('somos-webhooks', 'somos-push') order by jobname;
-- Depois de 2 minutos, ver as execucoes:
--   select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 6;
