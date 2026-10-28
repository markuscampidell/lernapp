-- Lernapp: geteilte Ordner in geteilten Ordnern.
-- Nach schema.sql und 002_rechte.sql einmal im Supabase "SQL Editor" ausführen.
--
-- Liegt ein geteilter Ordner (innen) in einem anderen geteilten Ordner (außen), sehen ihn alle Personen von außen mit.
-- Personen, mit denen nur der innere Ordner geteilt ist, sehen weiterhin nur diesen.
-- shares.inside = Ordner (im äußeren geteilten Ordner), in dem der oberste Ordner dieses geteilten Ordners liegt.

alter table public.shares add column if not exists inside text references public.folders (id) on delete set null;
create index if not exists shares_inside on public.shares (inside);

-- Mitglied = Besitzer/Mitglied dieses geteilten Ordners oder eines Ordners, in dem er (auch über mehrere Ebenen) liegt.
create or replace function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive up(id) as (
    select s
    union
    select f.share_id from up
      join public.shares sh on sh.id = up.id
      join public.folders f on f.id = sh.inside
  )
  select exists (select 1 from up join public.shares x on x.id = up.id where x.owner_id = auth.uid())
      or exists (select 1 from up join public.share_members m on m.share_id = up.id where m.user_id = auth.uid());
$$;

-- Nur "inside" darf sich ändern – und nur in einen eigenen anderen geteilten Ordner, ohne Kreis.
create or replace function public.shares_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_share uuid;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.root_id := old.root_id;
    new.created_at := old.created_at;
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
drop trigger if exists shares_guard on public.shares;
create trigger shares_guard before insert or update on public.shares
  for each row execute function public.shares_guard();

drop policy if exists "shares_update" on public.shares;
create policy "shares_update" on public.shares for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant update (inside) on public.shares to authenticated;
