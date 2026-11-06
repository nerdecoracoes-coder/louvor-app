-- Padrão da letra na tela (margens, alinhamento, posição do nome da parte e do rodapé), por time.
alter table public.teams add column if not exists slide_layout jsonb;
