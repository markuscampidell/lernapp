-- Lernapp: Konto löschen & geteilte Ordner an eine Person übergeben.
-- Nach schema.sql, 002_rechte.sql und 003_verschachtelt.sql einmal im Supabase "SQL Editor" ausführen.
--
-- Beim Löschen des eigenen Kontos wählt man eine Person (oder niemanden):
--  * niemand: Die App löscht alle eigenen geteilten Ordner, dann das Konto.
--  * Person:  Die eigenen geteilten Ordner gehören ab sofort dieser Person, sind aber als "Übergabe" markiert.
--             Die anderen Mitglieder sehen sie weiter. Die Person sieht einen Hinweis und kann
--             übernehmen (weiter geteilt oder in "Meine Ordner" auf ihr Gerät) oder ablehnen (= löschen).
--             Nach 30 Tagen ohne Entscheidung wird alles gelöscht.

create table if not exists public.handovers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references public.profiles on delete set null,
  from_name text not null,
  to_user uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists handovers_to on public.handovers (to_user);

create table if not exists public.handover_shares (
  handover_id uuid not null references public.handovers on delete cascade,
  share_id uuid not null references public.shares on delete cascade,
  primary key (handover_id, share_id)
);
create index if not exists handover_shares_share on public.handover_shares (share_id);

alter table public.handovers enable row level security;
alter table public.handover_shares enable row level security;

drop policy if exists "handovers_select" on public.handovers;
create policy "handovers_select" on public.handovers for select to authenticated using (to_user = auth.uid());
-- Übernehmen/Ablehnen: Die empfangende Person entfernt den Hinweis.
drop policy if exists "handovers_delete" on public.handovers;
create policy "handovers_delete" on public.handovers for delete to authenticated using (to_user = auth.uid());
drop policy if exists "handover_shares_select" on public.handover_shares;
create policy "handover_shares_select" on public.handover_shares for select to authenticated
  using (exists (select 1 from public.handovers h where h.id = handover_id and h.to_user = auth.uid()));

grant select, delete on public.handovers to authenticated;
grant select on public.handover_shares to authenticated;

-- Besitzerwechsel nur im Rahmen einer Übergabe (sonst wie bisher: nur "inside" darf sich ändern).
create or replace function public.shares_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_share uuid;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.root_id := old.root_id;
    new.created_at := old.created_at;
    if new.owner_id is distinct from old.owner_id and old.owner_id = auth.uid() and exists (
      select 1 from public.handover_shares hs join public.handovers h on h.id = hs.handover_id
      where hs.share_id = old.id and h.from_user = old.owner_id and h.to_user = new.owner_id
    ) then
      return new;
    end if;
    new.owner_id := old.owner_id;
  end if;
  if new.inside is null then return new; end if;
  select f.share_id into target_share from public.folders f join public.shares s on s.id = f.share_id
    where f.id = new.inside and s.owner_id = new.owner_id;
  if target_share is null then
    raise exception 'Ein geteilter Ordner kann nur in einem eigenen geteilten Ordner liegen.';
  end if;
  if exists (
    with recursive up(id) as (
      select target_share
      union
      select f.share_id from up
        join public.shares sh on sh.id = up.id
        join public.folders f on f.id = sh.inside
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'Ein geteilter Ordner kann nicht in sich selbst liegen.';
  end if;
  return new;
end $$;

-- Beim Löschen eines Kontos setzt die Datenbank "erstellt von"/"geändert von" auf leer.
-- Das passiert in einem verschachtelten Trigger (pg_trigger_depth > 1) – dann die Regeln unten nicht anwenden,
-- sonst würden sie den alten Wert zurückschreiben und das Löschen scheitern lassen.
create or replace function public.folders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent_share uuid;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.share_id <> old.share_id then
      raise exception 'Ein Ordner kann nicht in einen anderen geteilten Ordner wechseln.';
    end if;
    if (old.parent_id is null) <> (new.parent_id is null) then
      raise exception 'Der oberste geteilte Ordner kann nicht verschoben werden.';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.parent_id is null then
    if not exists (select 1 from public.shares where id = new.share_id and root_id = new.id) then
      raise exception 'Ungültiger oberster Ordner.';
    end if;
  else
    select share_id into parent_share from public.folders where id = new.parent_id;
    if parent_share is distinct from new.share_id then
      raise exception 'Der Zielordner gehört nicht zu diesem geteilten Ordner.';
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id and exists (
      with recursive sub as (
        select id from public.folders where id = new.id
        union all
        select f.id from public.folders f join sub on f.parent_id = sub.id
      )
      select 1 from sub where id = new.parent_id
    ) then
      raise exception 'Ein Ordner kann nicht in sich selbst verschoben werden.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.files_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.share_id <> old.share_id then
      raise exception 'Eine Datei kann nicht in einen anderen geteilten Ordner wechseln.';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if not exists (select 1 from public.folders where id = new.folder_id and share_id = new.share_id) then
    raise exception 'Der Zielordner gehört nicht zu diesem geteilten Ordner.';
  end if;
  return new;
end $$;

-- Eigenes Konto löschen. recipient = Person, die die eigenen geteilten Ordner bekommt (null = niemand).
create or replace function public.delete_own_account(recipient uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  h uuid;
  my_name text;
begin
  if me is null then raise exception 'Nicht angemeldet.'; end if;
  if recipient = me then raise exception 'Du kannst die Ordner nicht an dich selbst übergeben.'; end if;
  if recipient is not null and exists (select 1 from public.shares where owner_id = me) then
    if not exists (select 1 from public.profiles where id = recipient) then
      raise exception 'Diese Person gibt es nicht mehr.';
    end if;
    select username into my_name from public.profiles where id = me;
    insert into public.handovers (from_user, from_name, to_user) values (me, coalesce(my_name, '?'), recipient) returning id into h;
    insert into public.handover_shares (handover_id, share_id) select h, id from public.shares where owner_id = me;
    -- Die neue Besitzerin / der neue Besitzer ist kein zusätzliches Mitglied mehr.
    delete from public.share_members m using public.shares s
      where s.id = m.share_id and s.owner_id = me and m.user_id = recipient;
    update public.shares set owner_id = recipient where owner_id = me;
  end if;
  -- Profil, Mitgliedschaften usw. werden mitgelöscht; eigene Einträge in fremden Ordnern bleiben (ohne Namen).
  delete from auth.users where id = me;
end $$;
grant execute on function public.delete_own_account(uuid) to authenticated;

-- Abgelaufene Übergaben löschen. Gibt die Speicherpfade zurück, die die App danach aus dem Dateispeicher entfernt.
create or replace function public.expire_handovers() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  paths text[];
begin
  select array_agg(distinct hs.share_id) into ids
    from public.handover_shares hs join public.handovers h on h.id = hs.handover_id
    where h.expires_at < now();
  if ids is null then
    delete from public.handovers where expires_at < now();
    return '{}';
  end if;
  select coalesce(array_agg(p), '{}') into paths from (
    select image_path as p from public.folders where share_id = any (ids) and image_path is not null
    union all select blob_path from public.files where share_id = any (ids)
    union all select thumb_path from public.files where share_id = any (ids) and thumb_path is not null
  ) x;
  delete from public.shares where id = any (ids);
  delete from public.handovers where expires_at < now();
  return paths;
end $$;
grant execute on function public.expire_handovers() to authenticated;

-- Dateispeicher: Dateien eines geteilten Ordners, den es nicht mehr gibt, darf man entfernen
-- (Entfernen braucht im Speicher auch Leserecht).
create or replace function public.share_exists(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares where id::text = s);
$$;
grant execute on function public.share_exists(text) to authenticated;

drop policy if exists "files_bucket_select_orphans" on storage.objects;
create policy "files_bucket_select_orphans" on storage.objects for select to authenticated
  using (bucket_id = 'files' and not public.share_exists((storage.foldername(name))[1]));
drop policy if exists "files_bucket_delete_orphans" on storage.objects;
create policy "files_bucket_delete_orphans" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and not public.share_exists((storage.foldername(name))[1]));

do $$ begin
  alter publication supabase_realtime add table public.handovers;
exception when duplicate_object then null;
end $$;
