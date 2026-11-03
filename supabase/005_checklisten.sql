-- Lernapp: Häkchen in Checklisten (Text-Dokumente).
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.
--
-- Jede Checkliste in einem Dokument ist entweder
--   * "jeder für sich" (scope = eigene Benutzer-ID): nur ich sehe meine Häkchen – auf allen meinen Geräten, oder
--   * "gemeinsam" (scope = 'alle'): alle Mitglieder des geteilten Ordners sehen und setzen dieselben Häkchen.
-- Eine Zeile pro Punkt (item_id = data-id des Listenpunkts im Dokument).

create table if not exists public.checks (
  file_id text not null references public.files on delete cascade,
  scope text not null,
  item_id text not null check (char_length(item_id) between 1 and 40),
  done boolean not null default true,
  updated_by uuid default auth.uid() references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (file_id, scope, item_id)
);

-- Darf ich die Häkchen dieser Datei sehen/setzen? (Mitglied des geteilten Ordners, in dem die Datei liegt)
create or replace function public.can_check(fid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.id = fid and public.is_member(f.share_id));
$$;
grant execute on function public.can_check(text) to authenticated;

-- Wer/wann setzt immer der Server.
create or replace function public.checks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists checks_guard on public.checks;
create trigger checks_guard before insert or update on public.checks
  for each row execute function public.checks_guard();

alter table public.checks enable row level security;

-- Eigene Häkchen: nur ich. Gemeinsame Häkchen: alle Mitglieder.
drop policy if exists "checks_select" on public.checks;
create policy "checks_select" on public.checks for select to authenticated
  using ((scope = (auth.uid())::text or scope = 'alle') and public.can_check(file_id));
drop policy if exists "checks_insert" on public.checks;
create policy "checks_insert" on public.checks for insert to authenticated
  with check ((scope = (auth.uid())::text or scope = 'alle') and public.can_check(file_id));
drop policy if exists "checks_update" on public.checks;
create policy "checks_update" on public.checks for update to authenticated
  using ((scope = (auth.uid())::text or scope = 'alle') and public.can_check(file_id))
  with check ((scope = (auth.uid())::text or scope = 'alle') and public.can_check(file_id));
drop policy if exists "checks_delete" on public.checks;
create policy "checks_delete" on public.checks for delete to authenticated
  using ((scope = (auth.uid())::text or scope = 'alle') and public.can_check(file_id));

grant select, insert, update, delete on public.checks to authenticated;

-- Live-Aktualisierung (andere Geräte/Personen sehen Häkchen sofort).
do $$
begin
  alter publication supabase_realtime add table public.checks;
exception when duplicate_object then null;
end $$;
