-- Lernapp: Rechte einheitlich vererben.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.
--
-- Vorher galt beim obersten geteilten Ordner ohne Einstellung „Lesen & bearbeiten“ – aber nur für ihn selbst,
-- alles darin war „Nur lesen“. Jetzt gilt überall dasselbe: ohne Einstellung wie der Ordner darüber, ganz oben „Nur lesen“.
-- Die Einstellung des obersten Ordners gilt damit auch für alles darin (was dieselbe Person erstellt hat).
-- Eigens geteilte Unterordner erben von dem Ordner, in dem sie liegen.

create or replace function public.inherited_access(fid text, creator uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  cur record;
  i int := 0;
begin
  while fid is not null and i < 64 loop
    select f.parent_id, f.access, f.created_by, f.share_id into cur from public.folders f where f.id = fid;
    if not found or cur.created_by is distinct from creator then return 'read'; end if;
    if cur.access is not null then return cur.access; end if;
    if cur.parent_id is null then
      -- oberster Ordner eines geteilten Ordners: liegt er in einem anderen, dort weiter
      select s.inside into fid from public.shares s where s.id = cur.share_id;
    else
      fid := cur.parent_id;
    end if;
    i := i + 1;
  end loop;
  return 'read';
end $$;

create or replace function public.folder_access(fid text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    f.access,
    public.inherited_access(case when f.parent_id is null then (select s.inside from public.shares s where s.id = f.share_id) else f.parent_id end, f.created_by)
  )
  from public.folders f where f.id = fid;
$$;
