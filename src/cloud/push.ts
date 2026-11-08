import { supabase, check } from './supabase';

// Öffentlicher VAPID-Schlüssel (darf im Code stehen). Der private Schlüssel liegt nur als Secret bei der
// Supabase Edge Function "push" (siehe README, Abschnitt „Benachrichtigungen“).
export const VAPID_PUBLIC_KEY = 'BPGQG5v-JR6pu3Iofdaqq-HjgHPtCsjwl_shyxSl6rBoShTQ1wpIlZrsigJukUlQAlOYnc-DB3YOAxiunkcDv_s';

export type PushState =
  | 'unsupported' // Browser kann keine Push-Benachrichtigungen
  | 'ios-install' // iPhone/iPad: geht nur in der installierten App (Home-Bildschirm)
  | 'dev' // Entwicklungsmodus ohne Service Worker
  | 'denied' // im Browser blockiert
  | 'off'
  | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  // Wartet höchstens kurz – sonst hängt die Einstellung, falls der Service Worker (noch) nicht läuft.
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (import.meta.env.DEV) return 'dev';
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  if (!supabase || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('Dieses Gerät hat keine gültige Anmeldung für Benachrichtigungen geliefert.');
  check(
    await supabase.rpc('save_push_subscription', { sub_endpoint: json.endpoint, sub_p256dh: json.keys.p256dh, sub_auth: json.keys.auth }),
  );
}

/** Benachrichtigungen auf diesem Gerät einschalten (fragt den Browser um Erlaubnis). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Dieser Browser unterstützt keine Benachrichtigungen.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Benachrichtigungen sind für die Lernapp blockiert. Erlaube sie in den Website- bzw. App-Einstellungen und versuche es erneut.'
        : 'Ohne deine Erlaubnis kann die Lernapp keine Benachrichtigungen zeigen.',
    );
  }
  const reg = await registration();
  if (!reg) throw new Error('Die App ist noch nicht vollständig geladen. Lade die Seite neu und versuche es erneut.');
  let sub = await reg.pushManager.getSubscription();
  // Mit einem anderen Schlüssel angemeldet (z. B. alter Stand) -> neu anmelden.
  const key = sub?.options.applicationServerKey;
  if (sub && key && new Uint8Array(key).join() !== keyBytes(VAPID_PUBLIC_KEY).join()) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await save(sub);
}

/** Benachrichtigungen auf diesem Gerät ausschalten. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  if (supabase) await supabase.rpc('remove_push_subscription', { sub_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

/** Nach dem Anmelden/App-Start: Gerät (falls eingeschaltet) erneut dem angemeldeten Konto zuordnen. */
export async function syncPush(): Promise<void> {
  try {
    if (import.meta.env.DEV || !pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await save(sub);
  } catch (e) {
    console.warn('Benachrichtigungen konnten nicht abgeglichen werden', e);
  }
}

/** Vor dem Abmelden: Dieses Gerät soll keine Benachrichtigungen für das Konto mehr bekommen. */
export async function forgetPushDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub && supabase) await supabase.rpc('remove_push_subscription', { sub_endpoint: sub.endpoint });
  } catch {
    /* offline o. ä. – der Server räumt abgelaufene Geräte selbst auf */
  }
}

export async function sendTestPush(): Promise<void> {
  if (!supabase) return;
  check(await supabase.rpc('send_test_push'));
}
