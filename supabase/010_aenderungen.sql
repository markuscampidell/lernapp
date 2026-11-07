-- Lernapp: „Was hat sich geändert?“ bei geteilten Dateien.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.
--
-- Wer den Inhalt einer geteilten Datei speichert, hinterlegt eine kurze Zusammenfassung (z. B. +120 Wörter, −1 Bild).
-- Alle anderen sehen sie einmal beim nächsten Öffnen. Haben alle mit Zugriff sie gesehen, wird sie gelöscht
-- (spätestens nach 30 Tagen).

create table if not exists public.file_changes (
  id uuid primary key default gen_random_uuid(),
  file_id text not null references public.files on delete cascade,
  user_id uuid default auth.uid() references public.profiles on delete set null,
  -- [{"unit":"word","added":120,"removed":3,"changed":0}, …]
  summary jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array' and pg_column_size(summary) < 4000),
  created_at timestamptz not null default now()
);
create index if not exists file_changes_file on public.file_changes (file_id);

create table if not exists public.file_change_seen (
  change_id uuid not null references public.file_changes on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  primary key (change_id, user_id)
);

-- Verfasser und Zeit setzt der Server.
create or replace function public.file_changes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists file_changes_guard on public.file_changes;
create trigger file_changes_guard before insert on public.file_changes for each row execute function public.file_changes_guard();

-- Alle Personen, die einen geteilten Ordner sehen (Besitzer und Mitglieder, auch über äußere geteilte Ordner).
create or replace function public.share_people(s uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive up(id) as (
    select s
    union
    select f.share_id from up
      join public.shares sh on sh.id = up.id
      join public.folders f on f.id = sh.inside
  )
  select x.owner_id from up join public.shares x on x.id = up.id
  union
  select m.user_id from up join public.share_members m on m.share_id = up.id;
$$;

-- Änderungen einer Datei als gesehen markieren und aufräumen, was alle gesehen haben.
create or replace function public.mark_changes_seen(fid text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  select share_id into sid from public.files where id = fid;
  if sid is null or not public.is_member(sid) then return; end if;
  insert into public.file_change_seen (change_id, user_id)
    select c.id, auth.uid() from public.file_changes c where c.file_id = fid and c.user_id is distinct from auth.uid()
  on conflict do nothing;
  delete from public.file_changes c
  where c.file_id = fid and (
    c.created_at < now() - interval '30 days'
    or not exists (
      select 1 from public.share_people(sid) p
      where p is distinct from c.user_id
        and not exists (select 1 from public.file_change_seen s where s.change_id = c.id and s.user_id = p)
    )
  );
end $$;
grant execute on function public.mark_changes_seen(text) to authenticated;

alter table public.file_changes enable row level security;
alter table public.file_change_seen enable row level security;

drop policy if exists "changes_select" on public.file_changes;
create policy "changes_select" on public.file_changes for select to authenticated
  using (exists (select 1 from public.files f where f.id = file_id and public.is_member(f.share_id)));
drop policy if exists "changes_insert" on public.file_changes;
create policy "changes_insert" on public.file_changes for insert to authenticated
  with check (exists (select 1 from public.files f where f.id = file_id and public.is_member(f.share_id)));

drop policy if exists "change_seen_own" on public.file_change_seen;
create policy "change_seen_own" on public.file_change_seen for select to authenticated using (user_id = auth.uid());

grant select, insert on public.file_changes to authenticated;
grant select on public.file_change_seen to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.file_changes;
exception when duplicate_object then null;
end $$;
