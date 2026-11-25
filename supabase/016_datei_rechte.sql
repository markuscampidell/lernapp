-- Lernapp: Dateien haben nur noch zwei Stufen: „Nur lesen“ und „Lesen und bearbeiten“.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen. Kann gefahrlos mehrmals ausgeführt werden.
--
-- „Löschen“ ist eine Einstellung des Ordners: Steht der Ordner auf „Lesen, bearbeiten und löschen“,
-- dürfen Mitglieder die Dateien darin (derselben Person) löschen – außer die Datei selbst steht auf „Nur lesen“.
-- Dateien, die bisher selbst auf „löschen“ standen, gelten ab jetzt als „Lesen und bearbeiten“.

update public.files set access = 'edit' where access = 'delete';
alter table public.files drop constraint if exists files_access_two_levels;
alter table public.files add constraint files_access_two_levels check (access is null or access in ('read', 'edit'));

-- Was andere mit einer Datei tun dürfen: 'read' oder 'edit' (ein geerbtes 'delete' zählt hier als 'edit').
create or replace function public.file_access(fid text) returns text
language sql stable security definer set search_path = '' as $$
  select case when a = 'delete' then 'edit' else a end
  from (
    select coalesce(f.access, public.inherited_access(f.folder_id, f.created_by)) as a
    from public.files f where f.id = fid
  ) x;
$$;

-- Dürfen andere Mitglieder diese Datei löschen? Nur wenn der Ordner es erlaubt und die Datei nicht auf „Nur lesen“ steht.
create or replace function public.file_deletable(fid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(f.access, 'edit') <> 'read' and public.inherited_access(f.folder_id, f.created_by) = 'delete'
  from public.files f where f.id = fid;
$$;

revoke execute on function public.file_deletable(text) from public, anon;
grant execute on function public.file_access(text), public.file_deletable(text) to authenticated;

drop policy if exists "files_delete" on public.files;
create policy "files_delete" on public.files for delete to authenticated
  using (public.is_owner(share_id) or (public.is_member(share_id) and (created_by = auth.uid() or coalesce(public.file_deletable(id), false))));

-- Ordner löschen (Mitglieder): alles darin muss von ihnen sein oder für andere „löschen“ erlauben.
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
      and x.created_by is distinct from auth.uid() and not coalesce(public.file_deletable(x.id), false)
  ) then
    raise exception 'Der Ordner enthält Einträge von anderen, die du nicht löschen darfst.';
  end if;
  return old;
end $$;
