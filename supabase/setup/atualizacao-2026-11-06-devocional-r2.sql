-- Devocional: o vídeo original fica no Cloudflare R2 (chave em r2_key), sem ocupar o Supabase.
alter table public.team_devotionals add column if not exists r2_key text;
alter table public.team_devotionals drop constraint if exists team_devotionals_check;
alter table public.team_devotionals add constraint team_devotionals_check check (video_path is not null or video_url is not null or r2_key is not null);
