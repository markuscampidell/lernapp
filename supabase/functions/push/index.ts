// Lernapp: Push-Benachrichtigungen verschicken (Supabase Edge Function "push").
//
// Die Datenbank (supabase/012_benachrichtigungen.sql) legt für jede Benachrichtigung eine Zeile in
// public.notifications an und ruft danach diese Funktion mit { "id": "<id>" } auf. Die Funktion holt sich die
// Zeile selbst (nur unversendete), schickt sie an alle Geräte der Person und markiert sie als versendet.
// Dadurch braucht der Aufruf kein Passwort: Mehr als eine vorhandene Benachrichtigung einmal zustellen kann niemand.
//
// Secrets (Dashboard → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
// "Verify JWT" muss für diese Funktion AUS sein (die Datenbank schickt keinen Schlüssel mit).

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = 'https://markuscampidell.github.io/lernapp/';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(APP_URL, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST erwartet' }, 405);
  let id: unknown;
  try {
    ({ id } = await req.json());
  } catch {
    return json({ error: 'Ungültige Anfrage' }, 400);
  }
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Ungültige ID' }, 400);

  // Beanspruchen: nur eine Zeile, die noch nicht versendet wurde (doppelte Aufrufe schicken nichts doppelt).
  const { data: n, error } = await db
    .from('notifications')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
    .is('sent_at', null)
    .select('id, user_id, kind, title, body, url')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!n) return json({ sent: 0, skipped: true });

  const { data: subs, error: subErr } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', n.user_id);
  if (subErr) return json({ error: subErr.message }, 500);

  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: `${n.kind}-${n.id}` });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        // web-push verschlüsselt und signiert nur; verschickt wird mit fetch (läuft in Deno am zuverlässigsten).
        const r = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 24 * 3,
          urgency: 'normal',
        });
        const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, String(v)]));
        delete headers['Content-Length'];
        const res = await fetch(r.endpoint, { method: 'POST', headers, body: r.body });
        await res.body?.cancel();
        // Abo abgelaufen oder vom Browser zurückgezogen -> entfernen.
        if (res.status === 404 || res.status === 410) gone.push(s.id);
        else if (res.ok) sent++;
        else console.error('Push fehlgeschlagen', res.status);
      } catch (e) {
        console.error('Push fehlgeschlagen', (e as Error).message);
      }
    }),
  );
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
  return json({ sent, removed: gone.length });
});
