-- Lernapp: mehr Benachrichtigungen (Nov 2026).
-- Nach 012_benachrichtigungen.sql (und 013_sicherheit.sql) einmal im Supabase "SQL Editor" ausführen.
--
-- Neu:
-- * Jemand legt eine Datei oder einen Ordner in einem Ordner an, den DU erstellt hast -> Benachrichtigung an dich.
-- * Jemand ändert eine Datei oder einen Ordner, den DU erstellt hast (Inhalt, Name, Beschreibung, Bild, Ort)
--   -> Benachrichtigung an dich.
-- Damit es nicht zu viele werden: höchstens eine solche Nachricht pro Ordner bzw. Eintrag alle 15 Minuten.

-- Gab es für diese Person zu diesem Ziel gerade schon eine Nachricht dieser Art?
create or replace function public.recently_notified(person uuid, what text, target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notifications n
    where n.user_id = person and n.kind = what and n.url = target and n.created_at > now() - interval '15 minutes'
  );
$$;

create or replace function public.file_label(f public.files) returns text
language sql immutable set search_path = '' as $$
  select '„' || f.name || case when f.ext <> '' then '.' || f.ext else '' end || '“';
$$;

-- ---------- Neue Einträge ----------
create or replace function public.items_new_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent record;
  target text;
  what text;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'files' then
    select id, name, created_by, share_id into parent from public.folders where id = new.folder_id;
    what := 'die Datei ' || public.file_label(new);
  else
    if new.parent_id is null then return new; end if;
    select id, name, created_by, share_id into parent from public.folders where id = new.parent_id;
    what := 'den Ordner „' || new.name || '“';
  end if;
  if parent.id is null or parent.created_by is null or parent.created_by = auth.uid() then return new; end if;
  if parent.created_by not in (select public.share_people(parent.share_id)) then return new; end if;
  target := '#ordner/' || parent.id;
  if public.recently_notified(parent.created_by, 'new_item', target) then return new; end if;
  perform public.notify(
    array[parent.created_by],
    'new_item',
    'Neu in „' || parent.name || '“',
    public.my_name() || ' hat ' || what || ' hinzugefügt.',
    target
  );
  return new;
end $$;

drop trigger if exists files_new_notify on public.files;
create trigger files_new_notify after insert on public.files for each row execute function public.items_new_notify();
drop trigger if exists folders_new_notify on public.folders;
create trigger folders_new_notify after insert on public.folders for each row execute function public.items_new_notify();

-- ---------- Änderungen an eigenen Einträgen ----------
create or replace function public.files_change_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target text;
  what text;
begin
  if auth.uid() is null or new.created_by is null or new.created_by = auth.uid() then return new; end if;
  if new.blob_path is distinct from old.blob_path then what := 'geändert';
  elsif new.name is distinct from old.name or new.ext is distinct from old.ext then what := 'umbenannt (vorher „' || old.name || '“)';
  elsif new.description is distinct from old.description then what := 'die Beschreibung geändert';
  elsif new.folder_id is distinct from old.folder_id then what := 'verschoben';
  else return new;
  end if;
  if new.created_by not in (select public.share_people(new.share_id)) then return new; end if;
  target := '#ordner/' || new.folder_id || '/' || new.id;
  if public.recently_notified(new.created_by, 'change', target) then return new; end if;
  perform public.notify(
    array[new.created_by],
    'change',
    'Deine Datei wurde geändert',
    public.my_name() || ' hat ' || public.file_label(new) || ' ' || what || '.',
    target
  );
  return new;
end $$;

create or replace function public.folders_change_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target text;
  what text;
begin
  if auth.uid() is null or new.created_by is null or new.created_by = auth.uid() then return new; end if;
  if new.name is distinct from old.name then what := 'umbenannt (vorher „' || old.name || '“)';
  elsif new.description is distinct from old.description then what := 'die Beschreibung geändert';
  elsif new.image_path is distinct from old.image_path then what := 'das Bild geändert';
  elsif new.parent_id is distinct from old.parent_id then what := 'verschoben';
  else return new;
  end if;
  if new.created_by not in (select public.share_people(new.share_id)) then return new; end if;
  target := '#ordner/' || new.id;
  if public.recently_notified(new.created_by, 'change', target) then return new; end if;
  perform public.notify(
    array[new.created_by],
    'change',
    'Dein Ordner wurde geändert',
    public.my_name() || ' hat den Ordner „' || new.name || '“ ' || what || '.',
    target
  );
  return new;
end $$;

drop trigger if exists files_change_notify on public.files;
create trigger files_change_notify after update on public.files for each row execute function public.files_change_notify();
drop trigger if exists folders_change_notify on public.folders;
create trigger folders_change_notify after update on public.folders for each row execute function public.folders_change_notify();

-- Nur für die Trigger, nicht direkt aufrufbar.
revoke execute on function public.recently_notified(uuid, text, text), public.file_label(public.files),
  public.items_new_notify(), public.files_change_notify(), public.folders_change_notify()
  from public, anon, authenticated;
