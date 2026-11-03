-- Lernapp: Den obersten Ordner eines geteilten Ordners (Name, Beschreibung, Bild) ändert nur der Besitzer.
-- Die Rechte-Einstellung dort gilt nur für den Inhalt. Nach 007 einmal im Supabase "SQL Editor" ausführen.

drop policy if exists "folders_update" on public.folders;
create policy "folders_update" on public.folders for update to authenticated
  using (
    public.is_member(share_id) and (
      public.is_owner(share_id)
      or (parent_id is not null and (created_by = auth.uid() or public.folder_access(id) in ('edit', 'delete')))
    )
  )
  with check (public.is_member(share_id));
