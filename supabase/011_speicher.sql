-- Lernapp: Belegten Server-Speicher anzeigen (Einstellungen) und vor Uploads prüfen.
-- Nach den anderen Dateien einmal im Supabase "SQL Editor" ausführen.

-- Summe aller gespeicherten Dateien (alle Buckets, alle Konten) in Bytes.
-- security definer: Jede Person sieht nur ihre eigenen Dateien, braucht hier aber die Gesamtsumme.
-- Es wird nur diese eine Zahl verraten – nicht, wem welche Dateien gehören.
create or replace function public.storage_usage() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o;
$$;
revoke execute on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
