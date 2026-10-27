-- Lernapp: Rechte pro Datei/Ordner für die anderen Mitglieder.
-- Nach schema.sql einmal im Supabase "SQL Editor" ausführen.
--
-- access: 'read' (nur lesen), 'edit' (lesen & bearbeiten), 'delete' (lesen, bearbeiten & löschen)
--         oder NULL = wie der übergeordnete Ordner derselben Person (Standard: nur lesen).
-- Der oberste geteilte Ordner ohne Einstellung gilt als 'edit' (Mitglieder dürfen ihn umbenennen).
-- Hinzufügen ist in jedem Ordner erlaubt; der Besitzer darf immer alles.

alter table public.folders add column if not exists access text check (access in ('read', 'edit', 'delete'));
alter table public.files add column if not exists access text check (access in ('read', 'edit', 'delete'));

-- Einstellung von Ordnern erben – nur solange sie von derselben Person stammen.
create or replace function public.inherited_access(fid text, creator uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  cur record;
  i int := 0;
begin
  while fid is not null and i < 64 loop
    select parent_id, access, created_by into cur from public.folders where id = fid;
    if not found or cur.created_by is distinct from creator then return 'read'; end if;
    if cur.access is not null then return cur.access; end if;
    fid := cur.parent_id;
    i := i + 1;
  end loop;
  return 'read';
end $$;

create or replace function public.folder_access(fid text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(f.access, case when f.parent_id is null then 'edit' else public.inherited_access(f.parent_id, f.created_by) end)
  from public.folders f where f.id = fid;
$$;

create or replace function public.file_access(fid text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(f.access, public.inherited_access(f.folder_id, f.created_by))
  from public.files f where f.id = fid;
$$;

grant execute on function public.inherited_access(text, uuid), public.folder_access(text), public.file_access(text) to authenticated;

-- Rechte ändern dürfen nur die Person, die den Eintrag erstellt hat, und der Besitzer.
create or replace function public.access_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.access is distinct from old.access and not (old.created_by = auth.uid() or public.is_owner(old.share_id)) then
    raise exception 'Nur die Person, die den Eintrag erstellt hat, oder der Besitzer kann die Rechte ändern.';
  end if;
  return new;
end $$;
drop trigger if exists folders_access_guard on public.folders;
create trigger folders_access_guard before update on public.folders for each row execute function public.access_guard();
drop trigger if exists files_access_guard on public.files;
create trigger files_access_guard before update on public.files for each row execute function public.access_guard();

-- Ordner löschen (Mitglieder): alles darin muss von ihnen sein oder für andere "löschen" erlauben.
-- Wird nur für den direkt gelöschten Ordner geprüft (pg_trigger_depth = 1), nicht für mitgelöschte Inhalte.
create or replace function public.folders_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  if not exists (select 1 from public.shares where id = old.share_id) or public.is_owner(old.share_id) then
    return old;
  end if;
  if exists (
    with recursive sub as (
      select id from public.folders where parent_id = old.id
      union all
      select f.id from public.folders f join sub on f.parent_id = sub.id
    )
    select 1 from public.folders f join sub on f.id = sub.id
    where f.created_by is distinct from auth.uid() and public.folder_access(f.id) <> 'delete'
    union all
    select 1 from public.files x
    where (x.folder_id = old.id or x.folder_id in (select id from sub))
      and x.created_by is distinct from auth.uid() and public.file_access(x.id) <> 'delete'
  ) then
    raise exception 'Der Ordner enthält Einträge von anderen, die du nicht löschen darfst.';
  end if;
  return old;
end $$;

drop policy if exists "folders_update" on public.folders;
create policy "folders_update" on public.folders for update to authenticated
  using (public.is_member(share_id) and (public.is_owner(share_id) or created_by = auth.uid() or public.folder_access(id) in ('edit', 'delete')))
  with check (public.is_member(share_id));
drop policy if exists "folders_delete" on public.folders;
create policy "folders_delete" on public.folders for delete to authenticated
  using (public.is_owner(share_id) or (public.is_member(share_id) and parent_id is not null and (created_by = auth.uid() or public.folder_access(id) = 'delete')));

drop policy if exists "files_update" on public.files;
create policy "files_update" on public.files for update to authenticated
  using (public.is_member(share_id) and (public.is_owner(share_id) or created_by = auth.uid() or public.file_access(id) in ('edit', 'delete')))
  with check (public.is_member(share_id));
drop policy if exists "files_delete" on public.files;
create policy "files_delete" on public.files for delete to authenticated
  using (public.is_owner(share_id) or (public.is_member(share_id) and (created_by = auth.uid() or public.file_access(id) = 'delete')));

-- Speicher: Mitglieder dürfen Dateien entfernen, auf die kein Eintrag mehr verweist
-- (z. B. nach dem Löschen/Ersetzen einer fremden Datei, die sie bearbeiten/löschen dürfen).
create or replace function public.object_unused(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.files where blob_path = path or thumb_path = path)
     and not exists (select 1 from public.folders where image_path = path);
$$;
grant execute on function public.object_unused(text) to authenticated;

drop policy if exists "files_bucket_delete" on storage.objects;
create policy "files_bucket_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'files' and (
      owner_id = (auth.uid())::text
      or public.is_owner(((storage.foldername(name))[1])::uuid)
      or (public.is_member(((storage.foldername(name))[1])::uuid) and public.object_unused(name))
    )
  );
