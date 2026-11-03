-- Lernapp: Profilbilder.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.
--
-- Bild liegt im öffentlichen Bucket "avatars" unter <benutzer-id>/<zufall>.jpg (klein, 256×256).
-- Wie der Benutzername ist es für alle angemeldeten Personen sichtbar; ändern kann es nur man selbst.

alter table public.profiles add column if not exists avatar_path text
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$');

-- Nur das eigene Profil, und dort nur das Bild.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and (avatar_path is null or split_part(avatar_path, '/', 1) = (auth.uid())::text));
grant update (avatar_path) on public.profiles to authenticated;

-- Speicher: öffentlich lesbar (Bilder werden direkt per Adresse geladen), max. 1 MB, nur Bilder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
-- Auflisten/Lesen über die API nur eigene (öffentliche Adressen funktionieren trotzdem für alle).
drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

-- Neue Profilbilder sofort bei allen anzeigen.
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;
