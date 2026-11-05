-- =====================================================================
-- Letras para a mídia (05/11/2026): recurso compartilhado entre Louvor e Multimídia.
-- A mídia vê as letras do repertório e guarda a sua própria versão (partes e estilo) sem mexer na original.
-- =====================================================================

create or replace function public.team_feature_preset(p_type text) returns text[]
language sql immutable as $$
  select case p_type
    when 'louvor' then array['repertorio','letras']::text[]
    when 'multimidia' then array['checklist','letras','pedidos','roteiro']::text[]
    when 'diaconal' then array['checklist','roteiro','visitantes']::text[]
    when 'infantil' then array['checklist','criancas']::text[]
    else '{}'::text[] end
$$;

create or replace function public.fill_team_features() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.features is null then new.features := team_feature_preset(new.team_type); end if;
  new.features := array(select distinct x from unnest(new.features) x where x in ('repertorio','roteiro','pedidos','checklist','criancas','visitantes','letras') order by 1);
  if tg_op = 'UPDATE' and new.features is distinct from old.features
     and auth.uid() is not null and not is_org_admin(new.org_id) then
    raise exception 'only_admin_sets_features';
  end if;
  return new;
end $$;

update public.teams set features = array(select distinct x from unnest(coalesce(features,'{}') || array['letras']) x order by 1) where team_type in ('louvor','multimidia');

create table if not exists public.lyric_slides (
  team_id uuid not null references public.teams(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  blocks jsonb,
  style jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, song_id)
);
alter table public.lyric_slides enable row level security;
revoke all on public.lyric_slides from anon;
drop policy if exists ls_select on public.lyric_slides; drop policy if exists ls_write on public.lyric_slides;
create policy ls_select on public.lyric_slides for select to authenticated using (public.is_team_member(team_id) or public.is_org_admin(org_id));
create policy ls_write on public.lyric_slides for all to authenticated
  using (public.is_team_member(team_id) or public.can_manage_team(team_id))
  with check ((public.is_team_member(team_id) or public.can_manage_team(team_id)) and public.team_org(team_id) = org_id and public.team_has_feature(team_id, 'letras')
    and exists (select 1 from public.songs s where s.id = song_id and s.org_id = lyric_slides.org_id));

-- biblioteca de letras para quem é do time (a mídia não vê o resto do repertório)
create or replace function public.lyrics_library(p_team uuid)
returns table (id uuid, title text, artist text, song_key text, lyrics jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.artist, s.song_key, s.lyrics
    from songs s
   where s.org_id = team_org(p_team)
     and s.status <> 'removed'
     and s.lyrics is not null
     and (is_team_member(p_team) or can_manage_team(p_team))
     and team_has_feature(p_team, 'letras')
   order by s.title
$$;
revoke execute on function public.lyrics_library(uuid) from public, anon;
grant execute on function public.lyrics_library(uuid) to authenticated;
