-- Lernapp: Konten & geteilte Ordner.
-- Einmal im Supabase-Dashboard unter "SQL Editor" komplett einfügen und ausführen.

-- ---------- Profile (Benutzernamen) ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.username_taken(name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_taken(text) to anon, authenticated;

-- ---------- Geteilte Ordner ----------
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles on delete cascade,
  root_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.share_members (
  share_id uuid not null references public.shares on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  added_at timestamptz not null default now(),
  primary key (share_id, user_id)
);
create index on public.share_members (user_id);

create table public.folders (
  id text primary key,
  share_id uuid not null references public.shares on delete cascade,
  parent_id text references public.folders on delete cascade,
  name text not null,
  description text,
  image_path text,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);
create unique index folders_one_root on public.folders (share_id) where parent_id is null;
create index on public.folders (share_id);
create index on public.folders (parent_id);

create table public.files (
  id text primary key,
  share_id uuid not null references public.shares on delete cascade,
  folder_id text not null references public.folders on delete cascade,
  name text not null,
  ext text not null default '',
  description text,
  mime text not null default 'application/octet-stream',
  size bigint not null default 0,
  blob_path text not null,
  thumb_path text,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);
create index on public.files (share_id);
create index on public.files (folder_id);

-- Wann jemand einen Ordner zuletzt geöffnet hat (für das "!").
create table public.seen (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  folder_id text not null references public.folders on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);

-- ---------- Hilfsfunktionen ----------
create function public.is_owner(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares where id = s and owner_id = auth.uid());
$$;

create function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares where id = s and owner_id = auth.uid())
      or exists (select 1 from public.share_members where share_id = s and user_id = auth.uid());
$$;

create function public.mark_seen(folder text) returns timestamptz
language sql security definer set search_path = '' as $$
  insert into public.seen (user_id, folder_id, seen_at) values (auth.uid(), folder, now())
  on conflict (user_id, folder_id) do update set seen_at = excluded.seen_at
  returning seen_at;
$$;

-- ---------- Regeln, die nicht umgangen werden können ----------
-- Ersteller/Zeiten setzt immer der Server; Ordner bleiben in ihrem geteilten Ordner; keine Zyklen.
create function public.folders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent_share uuid;
begin
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
create trigger folders_guard before insert or update on public.folders
  for each row execute function public.folders_guard();

create function public.files_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
create trigger files_guard before insert or update on public.files
  for each row execute function public.files_guard();

-- Mitglieder dürfen nur Ordner löschen, in denen ausschließlich eigene Einträge liegen.
create function public.folders_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.shares where id = old.share_id) or public.is_owner(old.share_id) then
    return old;
  end if;
  if exists (select 1 from public.folders where parent_id = old.id and created_by is distinct from auth.uid())
     or exists (select 1 from public.files where folder_id = old.id and created_by is distinct from auth.uid()) then
    raise exception 'Der Ordner enthält Einträge von anderen Personen.';
  end if;
  return old;
end $$;
create trigger folders_delete_guard before delete on public.folders
  for each row execute function public.folders_delete_guard();

-- ---------- Zugriffsrechte (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.shares enable row level security;
alter table public.share_members enable row level security;
alter table public.folders enable row level security;
alter table public.files enable row level security;
alter table public.seen enable row level security;

-- Alle angemeldeten Personen sehen alle Benutzernamen.
create policy "profiles_select" on public.profiles for select to authenticated using (true);

-- owner_id direkt prüfen: sonst scheitert "insert ... returning" (die neue Zeile ist für is_member noch unsichtbar).
create policy "shares_select" on public.shares for select to authenticated using (owner_id = auth.uid() or public.is_member(id));
create policy "shares_insert" on public.shares for insert to authenticated with check (owner_id = auth.uid());
create policy "shares_delete" on public.shares for delete to authenticated using (owner_id = auth.uid());

create policy "members_select" on public.share_members for select to authenticated using (public.is_member(share_id));
create policy "members_insert" on public.share_members for insert to authenticated
  with check (public.is_owner(share_id) and user_id <> auth.uid());
-- Besitzer entfernt Mitglieder, Mitglieder können selbst austreten.
create policy "members_delete" on public.share_members for delete to authenticated
  using (public.is_owner(share_id) or user_id = auth.uid());

create policy "folders_select" on public.folders for select to authenticated using (public.is_member(share_id));
create policy "folders_insert" on public.folders for insert to authenticated
  with check (public.is_member(share_id) and (parent_id is not null or public.is_owner(share_id)));
-- Bearbeiten: Besitzer alles, Mitglieder eigene Ordner und den obersten geteilten Ordner (Name, Beschreibung, Bild).
create policy "folders_update" on public.folders for update to authenticated
  using (public.is_member(share_id) and (public.is_owner(share_id) or created_by = auth.uid() or parent_id is null))
  with check (public.is_member(share_id));
create policy "folders_delete" on public.folders for delete to authenticated
  using (public.is_owner(share_id) or (created_by = auth.uid() and parent_id is not null and public.is_member(share_id)));

create policy "files_select" on public.files for select to authenticated using (public.is_member(share_id));
create policy "files_insert" on public.files for insert to authenticated with check (public.is_member(share_id));
create policy "files_update" on public.files for update to authenticated
  using (public.is_member(share_id) and (public.is_owner(share_id) or created_by = auth.uid()))
  with check (public.is_member(share_id));
create policy "files_delete" on public.files for delete to authenticated
  using (public.is_owner(share_id) or (created_by = auth.uid() and public.is_member(share_id)));

create policy "seen_all" on public.seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Zugriff über die API (Row Level Security oben schränkt ihn ein).
grant select on public.profiles to authenticated;
grant select, insert, delete on public.shares, public.share_members to authenticated;
grant select, insert, update, delete on public.folders, public.files, public.seen to authenticated;
grant execute on function public.mark_seen(text), public.is_member(uuid), public.is_owner(uuid) to authenticated;

-- ---------- Dateispeicher ----------
-- Pfad jeder Datei: <share_id>/<zufällige id>. Limit 50 MB pro Datei (Maximum im kostenlosen Tarif).
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

create policy "files_bucket_select" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "files_bucket_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "files_bucket_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (owner_id = (auth.uid())::text or public.is_owner(((storage.foldername(name))[1])::uuid)));

-- ---------- Live-Aktualisierung ----------
alter publication supabase_realtime add table public.shares, public.share_members, public.folders, public.files;
