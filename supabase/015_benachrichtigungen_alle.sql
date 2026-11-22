-- Lernapp: Benachrichtigungen für alle Mitglieder + eigene Auswahl (Nov 2026).
-- Nach 014_mehr_benachrichtigungen.sql einmal im Supabase "SQL Editor" ausführen.
--
-- Neu:
-- * Neue Datei / neuer Ordner in einem geteilten Ordner -> an ALLE, die ihn sehen (bisher nur an die Person,
--   die den Ordner erstellt hat).
-- * Jemand ändert den Inhalt einer Datei in einem geteilten Ordner -> an alle anderen Mitglieder
--   (Art "update", anfangs AUS – sonst wird es bei vielen kleinen Korrekturen schnell zu viel).
-- * Jede Person wählt selbst, worüber sie benachrichtigt wird (Tabelle notification_prefs). Ohne eigene Wahl gilt:
--   alles an, außer "update". Abgewählte Arten landen weder als Push noch in der Glocke.
-- Weiterhin höchstens eine Nachricht pro Art und Ordner/Datei alle 15 Minuten und Person.

-- ---------- Auswahl pro Person ----------
create table if not exists public.notification_prefs (
  user_id uuid primary key references public.profiles on delete cascade default auth.uid(),
  new_items boolean not null default true,      -- Neues in geteilten Ordnern
  own_changes boolean not null default true,    -- Änderungen an eigenen Dateien/Ordnern
  other_changes boolean not null default false, -- Änderungen an anderen Dateien in geteilten Ordnern
  comments boolean not null default true,       -- Kommentare und Antworten
  shares boolean not null default true,         -- Ordner mit mir geteilt
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "notification_prefs_own" on public.notification_prefs;
create policy "notification_prefs_own" on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notification_prefs to authenticated;

-- Möchte diese Person Nachrichten dieser Art? (Übergaben und Tests immer.)
create or replace function public.wants_notification(person uuid, what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case what
       when 'new_item' then p.new_items
       when 'change' then p.own_changes
       when 'update' then p.other_changes
       when 'comment' then p.comments
       when 'share' then p.shares
       else true
     end
     from public.notification_prefs p where p.user_id = person),
    what <> 'update'
  );
$$;

-- notify() wie bisher, aber nur an Personen, die diese Art möchten.
create or replace function public.notify(recipients uuid[], kind text, title text, body text, url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where created_at < now() - interval '30 days';
  insert into public.notifications (user_id, kind, title, body, url)
    select distinct r, notify.kind, left(notify.title, 120), left(notify.body, 300), notify.url
    from unnest(recipients) r
    where r is not null and r is distinct from auth.uid()
      and exists (select 1 from public.profiles p where p.id = r)
      and public.wants_notification(r, notify.kind);
end $$;
revoke execute on function public.notify(uuid[], text, text, text, text) from public, anon, authenticated;

-- ---------- Neue Einträge: an alle, die den Ordner sehen ----------
create or replace function public.items_new_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent record;
  target text;
  what text;
  people uuid[];
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'files' then
    select id, name, share_id into parent from public.folders where id = new.folder_id;
    what := 'die Datei ' || public.file_label(new);
  else
    if new.parent_id is null then return new; end if;
    select id, name, share_id into parent from public.folders where id = new.parent_id;
    what := 'den Ordner „' || new.name || '“';
  end if;
  if parent.id is null or parent.share_id is null then return new; end if;
  target := '#ordner/' || parent.id;
  select array_agg(p) into people
    from public.share_people(parent.share_id) p
    where p <> auth.uid() and not public.recently_notified(p, 'new_item', target);
  if people is null then return new; end if;
  perform public.notify(people, 'new_item', 'Neu in „' || parent.name || '“', public.my_name() || ' hat ' || what || ' hinzugefügt.', target);
  return new;
end $$;

-- ---------- Datei geändert: an die Person, die sie erstellt hat ("change"), und an alle anderen ("update") ----------
create or replace function public.files_change_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target text;
  what text;
  others uuid[];
begin
  if auth.uid() is null then return new; end if;
  if new.blob_path is distinct from old.blob_path then what := 'geändert';
  elsif new.name is distinct from old.name or new.ext is distinct from old.ext then what := 'umbenannt (vorher „' || old.name || '“)';
  elsif new.description is distinct from old.description then what := 'die Beschreibung geändert';
  elsif new.folder_id is distinct from old.folder_id then what := 'verschoben';
  else return new;
  end if;
  target := '#ordner/' || new.folder_id || '/' || new.id;

  -- Eigene Datei, von jemand anderem geändert
  if new.created_by is not null and new.created_by <> auth.uid()
     and new.created_by in (select public.share_people(new.share_id))
     and not public.recently_notified(new.created_by, 'change', target) then
    perform public.notify(array[new.created_by], 'change', 'Deine Datei wurde geändert',
      public.my_name() || ' hat ' || public.file_label(new) || ' ' || what || '.', target);
  end if;

  -- Alle anderen Mitglieder: nur bei neuem Inhalt (z. B. Zusammenfassung überarbeitet)
  if new.blob_path is distinct from old.blob_path and new.share_id is not null then
    select array_agg(p) into others
      from public.share_people(new.share_id) p
      where p <> auth.uid() and p is distinct from new.created_by and not public.recently_notified(p, 'update', target);
    if others is not null then
      perform public.notify(others, 'update', 'Aktualisiert: ' || public.file_label(new),
        public.my_name() || ' hat ' || public.file_label(new) || ' überarbeitet.', target);
    end if;
  end if;
  return new;
end $$;

-- Trigger bleiben dieselben (aus 014) – nur die Funktionen sind neu.
revoke execute on function public.wants_notification(uuid, text), public.items_new_notify(), public.files_change_notify()
  from public, anon, authenticated;
