-- Tela da projeção (proporção dos slides) escolhida pela igreja, por time.
alter table public.teams add column if not exists slide_ratio text check (slide_ratio is null or char_length(slide_ratio) <= 16);
