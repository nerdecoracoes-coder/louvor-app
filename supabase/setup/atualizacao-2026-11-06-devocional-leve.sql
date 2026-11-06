-- Devocional: miniatura, tamanho e prazo da cópia guardada no app (a cópia permanente irá para o Drive).
alter table public.team_devotionals add column if not exists thumb text;
alter table public.team_devotionals add column if not exists video_bytes bigint;
alter table public.team_devotionals add column if not exists video_expires_at timestamptz;
