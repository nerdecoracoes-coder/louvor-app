-- Ícone escolhido para cada função (microfone, violão, bateria...). Vazio = ícone automático pelo nome.
alter table public.music_roles add column if not exists icon text check (icon is null or icon ~ '^[a-z]{2,20}$');
