-- Lernapp: Sicherheits-Update (Nov 2026).
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen. Kann gefahrlos mehrmals ausgeführt werden.
--
-- 1. Datenbank-Funktionen sind nicht mehr für jeden im Internet aufrufbar (vorher: auch ohne Anmeldung).
-- 2. Dateien gelöschter geteilter Ordner kann nicht mehr jede angemeldete Person sehen oder herunterladen.
-- 3. Abgelaufene Übergaben räumt nur noch die Person auf, an die sie gingen.

-- ---------- 1. Wer darf welche Funktion aufrufen ----------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Ohne Anmeldung: nur prüfen, ob ein Benutzername frei ist (beim Registrieren).
grant execute on function public.username_taken(text) to anon, authenticated;

-- Angemeldet: was die App direkt aufruft oder was in den Zugriffsregeln steht.
grant execute on function
  public.is_member(uuid),
  public.is_owner(uuid),
  public.folder_access(text),
  public.file_access(text),
  public.object_unused(text),
  public.share_exists(text),
  public.can_check(text),
  public.can_see_file(text),
  public.mark_seen(text),
  public.mark_changes_seen(text),
  public.delete_own_account(uuid),
  public.storage_usage(),
  public.save_push_subscription(text, text, text),
  public.remove_push_subscription(text),
  public.send_test_push()
to authenticated;

-- ---------- 2. Dateien gelöschter geteilter Ordner ----------
-- Vorher durfte jede angemeldete Person Dateien lesen und auflisten, deren geteilter Ordner nicht mehr existiert.
drop policy if exists "files_bucket_select_orphans" on storage.objects;
drop policy if exists "files_bucket_delete_orphans" on storage.objects;
-- Eigene Uploads darf man immer lesen und löschen (z. B. Aufräumen nach dem Austreten).
drop policy if exists "files_bucket_select_own" on storage.objects;
create policy "files_bucket_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'files' and owner_id = (auth.uid())::text);

-- ---------- 3. Abgelaufene Übergaben ----------
-- Speicherpfade meiner abgelaufenen Übergaben. Die geteilten Ordner gehören seit der Übergabe mir,
-- deshalb darf ich die Dateien löschen, solange es die Ordner noch gibt. Danach expire_handovers() aufrufen.
create or replace function public.expired_handover_paths() returns text[]
language sql stable security definer set search_path = '' as $$
  with ids as (
    select hs.share_id from public.handover_shares hs join public.handovers h on h.id = hs.handover_id
    where h.to_user = auth.uid() and h.expires_at < now()
  )
  select coalesce(array_agg(p), '{}') from (
    select image_path as p from public.folders where share_id in (select share_id from ids) and image_path is not null
    union all select blob_path from public.files where share_id in (select share_id from ids)
    union all select thumb_path from public.files where share_id in (select share_id from ids) and thumb_path is not null
  ) x;
$$;

-- Löscht nur noch meine eigenen abgelaufenen Übergaben samt den geteilten Ordnern darin.
create or replace function public.expire_handovers() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
begin
  if auth.uid() is null then return '{}'; end if;
  select array_agg(distinct hs.share_id) into ids
    from public.handover_shares hs join public.handovers h on h.id = hs.handover_id
    where h.to_user = auth.uid() and h.expires_at < now();
  if ids is not null then
    delete from public.shares where id = any (ids) and owner_id = auth.uid();
  end if;
  delete from public.handovers where to_user = auth.uid() and expires_at < now();
  return '{}';
end $$;

grant execute on function public.expired_handover_paths(), public.expire_handovers() to authenticated;
