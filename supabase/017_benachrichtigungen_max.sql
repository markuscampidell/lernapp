-- Neuigkeiten (Glocke): pro Person höchstens die neuesten 100 behalten – ältere werden gelöscht.
-- (Zusätzlich wie bisher: alles älter als 30 Tage fliegt raus.)
-- Einmal im Supabase SQL-Editor ausführen.

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
  -- Bei den Empfängern nur die neuesten 100 behalten.
  delete from public.notifications n
    using (
      select id from (
        select id, row_number() over (partition by user_id order by created_at desc, id desc) as nr
        from public.notifications
        where user_id = any(recipients)
      ) ranked
      where nr > 100
    ) old
    where n.id = old.id;
end $$;
revoke execute on function public.notify(uuid[], text, text, text, text) from public, anon, authenticated;

-- Einmal aufräumen: bei allen nur die neuesten 100.
delete from public.notifications n
  using (
    select id from (
      select id, row_number() over (partition by user_id order by created_at desc, id desc) as nr
      from public.notifications
    ) ranked
    where nr > 100
  ) old
  where n.id = old.id;
