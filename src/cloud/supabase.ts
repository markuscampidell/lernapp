import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Öffentliche Projekt-Adresse und "publishable"/"anon"-Schlüssel aus Supabase (Project Settings → API Keys).
// Beide dürfen im Code stehen – geschützt wird alles durch die Regeln in supabase/schema.sql.
export const SUPABASE_URL = 'https://ucihywdrozindftumjng.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ixeXvCXR-kQKJJM0hsOCOQ_RmTeRpn_';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lernapp-auth' },
    })
  : null;

/** Speicher-Bucket für geteilte Dateien (siehe schema.sql). */
export const BUCKET = 'files';
/** Maximale Dateigröße im kostenlosen Supabase-Tarif. */
export const MAX_UPLOAD = 50 * 1024 * 1024;

// Anmeldung nur mit Benutzername: Supabase braucht intern eine E-Mail-Adresse, wir bilden sie aus dem Namen.
// Es werden keine E-Mails verschickt ("Confirm email" ist in Supabase ausgeschaltet).
const USER_DOMAIN = 'lernapp.invalid';
export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${USER_DOMAIN}`;
export const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
export const MIN_PASSWORD = 6;

/** Wirft bei Supabase-Fehlern eine verständliche Meldung. */
export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message));
  return res.data;
}

export function friendly(msg: string): string {
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Keine Verbindung zum Server – bist du online?';
  if (/row-level security|permission denied|violates row-level/i.test(msg)) return 'Dazu hast du keine Berechtigung.';
  if (/exceeded the maximum allowed size|Payload too large|too large/i.test(msg)) return 'Die Datei ist zu groß (max. 50 MB in geteilten Ordnern).';
  if (/JWT|session/i.test(msg)) return 'Deine Anmeldung ist abgelaufen – bitte neu anmelden.';
  return msg;
}
