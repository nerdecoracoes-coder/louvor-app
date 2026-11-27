-- Push imediato: ao criar um aviso na fila, chama a funcao push-send na hora (o agendamento de 1 min continua como reserva).
-- Nunca quebra a criacao de notificacoes: qualquer falha aqui e ignorada. Sem configuracao (url + segredo) nao faz nada.
create table if not exists public.push_cfg (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.push_cfg enable row level security;
revoke all on public.push_cfg from anon, authenticated;

-- Uso: select public.push_instant_set('https://<projeto>.supabase.co/functions/v1/push-send', '<CRON_SECRET>');  (rodar no SQL Editor)
create or replace function public.push_instant_set(p_url text, p_secret text) returns text language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_url, '') !~ '^https://[a-z0-9.-]+\.supabase\.co/functions/v1/push-send$' then raise exception 'push_url_invalid'; end if;
  if length(coalesce(p_secret, '')) < 16 then raise exception 'push_secret_short'; end if;
  insert into push_cfg (key, value) values ('url', p_url), ('secret', p_secret)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'push imediato configurado';
end $$;
revoke execute on function public.push_instant_set(text, text) from public, anon, authenticated;

-- um disparo por transacao: os demais avisos da mesma transacao ja estao visiveis quando a funcao rodar
create or replace function public.push_kick() returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text; v_last timestamptz;
begin
  begin
    select value into v_url from push_cfg where key = 'url';
    select value into v_secret from push_cfg where key = 'secret';
    if v_url is null or v_secret is null then return new; end if;
    select updated_at into v_last from push_cfg where key = 'kick';
    if v_last is not null and v_last >= now() then return new; end if;
    insert into push_cfg (key, value, updated_at) values ('kick', '1', now()) on conflict (key) do update set updated_at = excluded.updated_at;
    execute format('select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 5000)',
      v_url, jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret)::text, '{}');
  exception when others then null;
  end;
  return new;
end $$;
revoke execute on function public.push_kick() from public, anon, authenticated;
drop trigger if exists push_kick_trg on public.push_outbox;
create trigger push_kick_trg after insert on public.push_outbox for each row execute function public.push_kick();

-- Verificacao (deve retornar true):
select to_regclass('public.push_cfg') is not null
   and exists (select 1 from pg_trigger where tgname = 'push_kick_trg' and not tgisinternal)
   and to_regprocedure('public.push_instant_set(text,text)') is not null as push_imediato_ok;
