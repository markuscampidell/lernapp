import { useEffect, useRef, useState } from 'react';

// Hash-Routen: #ordner, #ordner/<id>, #hochladen, #ki, #einstellungen
export type Tab = 'ordner' | 'hochladen' | 'ki' | 'einstellungen';
export interface Route {
  tab: Tab;
  folderId: string | null;
}

const TABS: Tab[] = ['ordner', 'hochladen', 'ki', 'einstellungen'];

export function parseHash(hash = window.location.hash): Route {
  const [tab, id] = hash.replace(/^#/, '').split('/');
  if (!TABS.includes(tab as Tab)) return { tab: 'ordner', folderId: null };
  // #ordner/<id> = geöffneter Ordner, #ki/<id> = Ordner, der der KI als Quelle vorgeschlagen wird
  return { tab: tab as Tab, folderId: (tab === 'ordner' || tab === 'ki') && id ? decodeURIComponent(id) : null };
}

export const folderHash = (id: string | null) => (id ? `#ordner/${encodeURIComponent(id)}` : '#ordner');

const EVENT = 'lernapp:route';
const emit = () => window.dispatchEvent(new Event(EVENT));

/** Neue Seite im Verlauf (Zurück-Taste des Handys führt zurück). */
export function navigate(hash: string, state?: Record<string, unknown>) {
  if (window.location.hash === hash) return;
  history.pushState(state ?? null, '', hash);
  emit();
}

/** Aktuelle Seite ersetzen (kein neuer Verlaufseintrag). */
export function replace(hash: string) {
  history.replaceState(null, '', hash);
  emit();
}

/** In einen Unterordner gehen – merkt sich, dass "Zurück" einfach history.back() sein darf. */
export const openFolder = (id: string) => navigate(folderHash(id), { fromParent: true });

/** Eine Ebene nach oben. */
export function goUp(parentId: string | null) {
  if ((history.state as { fromParent?: boolean } | null)?.fromParent) history.back();
  else replace(folderHash(parentId));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener(EVENT, on);
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
    };
  }, []);
  return route;
}

// ---------- Zurück-Taste schließt Dialoge ----------
// Jeder offene Dialog legt einen Verlaufseintrag an. Die Zurück-Taste (Android) schließt so den obersten
// Dialog statt die Seite zu verlassen. Wird ein Dialog per Knopf geschlossen, gehen wir selbst einen Schritt zurück.
let modalDepth = 0;
let pendingBacks = 0;
const afterBackQueue: (() => void)[] = [];

window.addEventListener('popstate', () => {
  if (pendingBacks > 0) pendingBacks--;
  if (pendingBacks === 0) afterBackQueue.splice(0).forEach((fn) => fn());
});

// Escape schließt den obersten Dialog.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalDepth > 0) history.back();
});

/** Führt fn aus, sobald alle ausstehenden history.back()-Aufrufe erledigt sind (z. B. nach dem Schließen eines Dialogs navigieren). */
export function afterBack(fn: () => void) {
  // Kurz warten, bis React den Dialog abgebaut hat (der dabei history.back() auslöst).
  setTimeout(() => {
    if (pendingBacks > 0) afterBackQueue.push(fn);
    else fn();
  }, 60);
}

export function useBackToClose(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const depth = ++modalDepth;
    let closedByBack = false;
    history.pushState({ ...(history.state ?? {}), modal: depth }, '');
    const onPop = () => {
      const cur = (history.state as { modal?: number } | null)?.modal ?? 0;
      if (cur < depth && !closedByBack) {
        closedByBack = true;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      modalDepth--;
      // Per Knopf geschlossen: unseren Verlaufseintrag wieder entfernen.
      if (!closedByBack && (history.state as { modal?: number } | null)?.modal === depth) {
        pendingBacks++;
        history.back();
      }
    };
  }, []);
}
