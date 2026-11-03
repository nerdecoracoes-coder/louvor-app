-- =====================================================================
-- Supabase Storage: dois "baldes"
--   media   (público para leitura): fotos de perfil, logos, capas, imagens de avisos
--   private (só com login e permissão): anexos do chat, arquivos do time, anexos de músicas
-- Caminhos:
--   media/avatars/<user_id>/...            media/orgs/<org_id>/...
--   media/teams/<org_id>/<team_id>/...     media/songs/<org_id>/...
--   private/chat/<org_id>/<team_id>/...    private/files/<org_id>/<team_id>/...
--   private/songs/<org_id>/<song_id>/...
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 10485760), ('private', 'private', false, 52428800)
on conflict (id) do nothing;

create or replace function public.storage_can_write(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    if f[1] = 'avatars' then return f[2] = auth.uid()::text; end if;
    v_org := f[2]::uuid;
    if f[1] in ('teams','chat','files') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if p_bucket = 'media' then
    if f[1] = 'orgs' then return is_org_admin(v_org); end if;
    if f[1] = 'teams' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
    if f[1] = 'announcements' then return is_org_member(v_org); end if;
  elsif p_bucket = 'private' then
    if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
    if f[1] = 'files' then return team_org(v_team) = v_org and can_manage_team(v_team); end if;
    if f[1] = 'songs' then return is_org_staff(v_org); end if;
  end if;
  return false;
end $$;

create or replace function public.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[] := storage.foldername(p_name); v_org uuid; v_team uuid;
begin
  if auth.uid() is null or array_length(f, 1) is null then return false; end if;
  begin
    v_org := f[2]::uuid;
    if f[1] in ('chat','files') then v_team := f[3]::uuid; end if;
  exception when others then return false; end;
  if f[1] = 'chat' then return team_org(v_team) = v_org and is_team_member(v_team); end if;
  if f[1] = 'files' then return team_org(v_team) = v_org and (is_team_member(v_team) or is_org_admin(v_org)); end if;
  if f[1] = 'songs' then return is_org_member(v_org); end if;
  return false;
end $$;

create policy "media read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');
create policy "media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.storage_can_write(bucket_id, name));
create policy "media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.storage_can_write(bucket_id, name));
create policy "media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.storage_can_write(bucket_id, name));

create policy "private read" on storage.objects for select to authenticated
  using (bucket_id = 'private' and public.storage_can_read(name));
create policy "private write" on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and public.storage_can_write(bucket_id, name));
create policy "private delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private' and public.storage_can_write(bucket_id, name));
