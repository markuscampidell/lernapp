-- Lernapp: Push-Benachrichtigungen (Kommentare, Antworten, neu geteilte Ordner, Übergaben).
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.
-- Vorher die Edge Function "push" anlegen (siehe README, Abschnitt „Benachrichtigungen“).
--
-- Ablauf: Ein Trigger legt pro Empfänger eine Zeile in notifications an. Danach ruft die Datenbank (pg_net)
-- die Edge Function "push" mit der ID auf; die schickt sie an alle Geräte der Person (push_subscriptions).

create extension if not exists pg_net;

-- Adresse der Edge Function "push" (Projekt-Adresse wie in src/cloud/supabase.ts).
create or replace function public.push_function_url() returns text
language sql immutable set search_path = '' as $$
  select 'https://ucihywdrozindftumjng.supabase.co/functions/v1/push';
$$;

-- ---------- Geräte, die Benachrichtigungen bekommen ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000),
  p256dh text not null check (char_length(p256dh) between 10 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
grant select on public.push_subscriptions to authenticated;

-- Dieses Gerät für das angemeldete Konto eintragen. War es vorher bei einem anderen Konto, gehört es jetzt diesem.
create or replace function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet.'; end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth)
    values (auth.uid(), sub_endpoint, sub_p256dh, sub_auth)
    on conflict on constraint push_subscriptions_endpoint_key do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.remove_push_subscription(sub_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions s where s.endpoint = sub_endpoint and s.user_id = auth.uid();
$$;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- ---------- Warteschlange ----------
-- Nur der Server (Trigger, Edge Function) schreibt hier. Die Person darf ihre eigenen lesen (für später, z. B. eine Glocke).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  url text not null default '#ordner',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
create index if not exists notifications_created on public.notifications (created_at);
alter table public.notifications enable row level security;
drop policy if exists "notifications_own" on public.notifications;
create policy "notifications_own" on public.notifications for select to authenticated using (user_id = auth.uid());
grant select on public.notifications to authenticated;

-- Neue Benachrichtigung -> Edge Function aufrufen (nur wenn die Person überhaupt ein Gerät eingetragen hat).
create or replace function public.notifications_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    perform net.http_post(
      url := public.push_function_url(),
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return new;
end $$;
drop trigger if exists notifications_dispatch on public.notifications;
create trigger notifications_dispatch after insert on public.notifications
  for each row execute function public.notifications_dispatch();

-- Benachrichtigung für mehrere Personen anlegen (ohne die Person, die es ausgelöst hat). Räumt nebenbei Altes auf.
create or replace function public.notify(recipients uuid[], kind text, title text, body text, url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where created_at < now() - interval '30 days';
  insert into public.notifications (user_id, kind, title, body, url)
    select distinct r, notify.kind, left(notify.title, 120), left(notify.body, 300), notify.url
    from unnest(recipients) r
    where r is not null and r is distinct from auth.uid()
      and exists (select 1 from public.profiles p where p.id = r);
end $$;
revoke execute on function public.notify(uuid[], text, text, text, text) from public, anon, authenticated;

create or replace function public.my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select username from public.profiles where id = auth.uid()), 'Jemand');
$$;

-- ---------- Auslöser ----------

-- Alle Personen, die einen geteilten Ordner sehen (auch über äußere Ordner). Gleich wie in 010_aenderungen.sql –
-- hier noch einmal, damit diese Datei auch ohne 010 funktioniert.
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

-- Kommentar: an die Person, die die Datei erstellt hat. Antwort: zusätzlich an alle im selben Gespräch.
-- Nur an Personen, die die Datei noch sehen.
create or replace function public.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  people uuid[];
  thread uuid := coalesce(new.parent_id, new.id);
  fname text;
begin
  select id, folder_id, share_id, created_by, name, ext into f from public.files where id = new.file_id;
  if f.id is null then return new; end if;
  select array_agg(distinct x) into people from (
    select f.created_by as x
    union select c.user_id from public.comments c where new.parent_id is not null and (c.id = thread or c.parent_id = thread)
  ) t
  where x in (select public.share_people(f.share_id));
  fname := f.name || case when f.ext <> '' then '.' || f.ext else '' end;
  perform public.notify(
    people,
    'comment',
    case when new.parent_id is null then 'Neuer Kommentar' else 'Neue Antwort' end,
    public.my_name() || ' zu „' || fname || '“: ' || case when char_length(new.body) > 140 then left(new.body, 140) || ' …' else new.body end,
    '#ordner/' || f.folder_id || '/' || f.id
  );
  return new;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.comments_notify();

-- Ordner geteilt: an die neue Person.
create or replace function public.share_members_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  root_name text;
begin
  select fo.name into root_name from public.shares s join public.folders fo on fo.id = s.root_id where s.id = new.share_id;
  perform public.notify(
    array[new.user_id],
    'share',
    'Neuer geteilter Ordner',
    public.my_name() || ' hat ' || coalesce('„' || root_name || '“', 'einen Ordner') || ' mit dir geteilt.',
    '#geteilt'
  );
  return new;
end $$;
drop trigger if exists share_members_notify on public.share_members;
create trigger share_members_notify after insert on public.share_members for each row execute function public.share_members_notify();

-- Übergabe beim Löschen eines Kontos: an die empfangende Person.
create or replace function public.handovers_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(
    array[new.to_user],
    'handover',
    'Ordner übergeben',
    new.from_name || ' hat das Konto gelöscht und dir die eigenen geteilten Ordner übergeben. Du hast 30 Tage Zeit, sie zu übernehmen.',
    '#ordner'
  );
  return new;
end $$;
drop trigger if exists handovers_notify on public.handovers;
create trigger handovers_notify after insert on public.handovers for each row execute function public.handovers_notify();

-- Test aus den Einstellungen: schickt eine Benachrichtigung an die eigenen Geräte.
create or replace function public.send_test_push() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet.'; end if;
  if exists (select 1 from public.notifications where user_id = auth.uid() and kind = 'test' and created_at > now() - interval '10 seconds') then
    raise exception 'Bitte kurz warten.';
  end if;
  insert into public.notifications (user_id, kind, title, body, url)
    values (auth.uid(), 'test', 'Lernapp', 'Benachrichtigungen funktionieren auf diesem Gerät.', '#einstellungen');
end $$;
grant execute on function public.send_test_push() to authenticated;
