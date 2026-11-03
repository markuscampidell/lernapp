-- Lernapp: Lernstand bei Karteikarten (Wiederholung) und Kommentare an Dateien.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.

-- Darf ich diese Datei sehen? (Mitglied des geteilten Ordners, in dem sie liegt)
create or replace function public.can_see_file(fid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.id = fid and public.is_member(f.share_id));
$$;
grant execute on function public.can_see_file(text) to authenticated;

-- ---------- Lernstand (pro Person, auf allen eigenen Geräten gleich) ----------
-- box 0 = neu/nicht gewusst … 6 = sitzt; due = wann die Karte wieder drankommt.
create table if not exists public.card_progress (
  file_id text not null references public.files on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  card_id text not null check (char_length(card_id) between 1 and 40),
  box int not null default 0 check (box between 0 and 6),
  due timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (file_id, user_id, card_id)
);

alter table public.card_progress enable row level security;
drop policy if exists "progress_own" on public.card_progress;
create policy "progress_own" on public.card_progress for all to authenticated
  using (user_id = auth.uid() and public.can_see_file(file_id))
  with check (user_id = auth.uid() and public.can_see_file(file_id));
grant select, insert, update, delete on public.card_progress to authenticated;

-- ---------- Kommentare ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  file_id text not null references public.files on delete cascade,
  user_id uuid default auth.uid() references public.profiles on delete set null,
  -- Antwort auf einen anderen Kommentar (nur eine Ebene)
  parent_id uuid references public.comments on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists comments_file on public.comments (file_id, created_at);

-- Verfasser und Zeit setzt immer der Server.
create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if new.parent_id is not null and not exists (select 1 from public.comments c where c.id = new.parent_id and c.file_id = new.file_id) then
    raise exception 'Antwort gehört nicht zu dieser Datei.';
  end if;
  return new;
end $$;
drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before insert on public.comments for each row execute function public.comments_guard();

alter table public.comments enable row level security;
drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments for select to authenticated using (public.can_see_file(file_id));
drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert" on public.comments for insert to authenticated with check (public.can_see_file(file_id));
-- Löschen: eigene Kommentare, oder der Besitzer des geteilten Ordners.
drop policy if exists "comments_delete" on public.comments;
create policy "comments_delete" on public.comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.files f where f.id = file_id and public.is_owner(f.share_id)));
grant select, insert, delete on public.comments to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null;
end $$;
