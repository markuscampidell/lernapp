import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { fetchNews, type NewsItem } from '../../cloud/remote';
import { cloudEnabled } from '../../cloud/supabase';
import { afterBack, navigate } from '../../lib/router';
import { useLibrary } from '../../state/Library';
import { ago } from '../comments/Comments';
import { onVisited, visitedAt } from './visits';
import { consumeBellRequest, startTrail } from './trail';

/** Wann die Glocke zuletzt geöffnet wurde (pro Konto, auf diesem Gerät). */
const seenKey = (userId: string) => `lernapp-neuigkeiten-gesehen-${userId}`;
const readSeen = (userId: string) => {
  try {
    return Number(localStorage.getItem(seenKey(userId))) || 0;
  } catch {
    return 0;
  }
};

const ICON: Record<string, IconName> = { comment: 'comment', share: 'users', handover: 'folder', new_item: 'plus', change: 'edit', update: 'edit' };

/** Kommentar-Neuigkeiten öffnen die Datei gleich mit offenen Kommentaren. */
const target = (n: NewsItem) => (n.kind === 'comment' && /^#ordner\/[^/]+\/[^/]+$/.test(n.url) ? `${n.url}/kommentare` : n.url);

/**
 * Schon selbst geöffnet (Ordner, Datei bzw. deren Kommentare), nachdem die Neuigkeit entstand?
 * Die Übergabe (#ordner) zählt nie – die muss man in der Glocke sehen.
 */
const visited = (n: NewsItem) => n.url !== '#ordner' && visitedAt(target(n)) >= Date.parse(n.createdAt);

/** Glocke in der Ordner-Übersicht: neue Kommentare, neu geteilte Ordner, Neues in eigenen Ordnern, Änderungen an eigenen Einträgen, Übergaben. */
export function NewsBell() {
  const { me, online } = useLibrary();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => (me ? readSeen(me.id) : 0));
  // Stand beim Öffnen: was davor neu war, bleibt in der Liste markiert.
  const [seenAtOpen, setSeenAtOpen] = useState(0);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNews());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Neuigkeiten konnten nicht geladen werden.');
    }
  }, []);

  useEffect(() => {
    if (!me || !online) return;
    load();
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    const timer = setInterval(onFocus, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(timer);
    };
  }, [me, online, load]);

  useEffect(() => setSeen(me ? readSeen(me.id) : 0), [me]);
  // Beim Öffnen von Ordnern/Dateien neu zählen.
  const [, setVisits] = useState(0);
  useEffect(() => onVisited(() => setVisits((v) => v + 1)), []);

  const isUnread = (n: NewsItem, since: number) => Date.parse(n.createdAt) > since && !visited(n);
  const unread = (items ?? []).filter((n) => isUnread(n, seen)).length;
  // Zahl am App-Symbol = ungelesene Neuigkeiten (nur installierte App, wo der Browser das kann).
  useEffect(() => {
    if (!items || !me) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
    // Gelesen: auch die Benachrichtigungen in der Leiste wegräumen.
    if (!unread) void navigator.serviceWorker?.getRegistration().then((r) => r?.getNotifications().then((l) => l.forEach((n) => n.close())));
  }, [unread, items, me]);

  const show = useCallback(() => {
    if (!me) return;
    setSeenAtOpen(seen);
    setOpen(true);
    load();
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(seenKey(me.id), String(now));
    } catch {
      /* egal */
    }
  }, [me, seen, load]);

  // Über „Neuigkeiten“ unten (nach dem Antippen einer Neuigkeit) zurückgekommen: Glocke gleich öffnen.
  useEffect(() => {
    if (me && consumeBellRequest()) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  if (!cloudEnabled || !me) return null;

  /** Antippen: hinspringen und unten „Neuigkeiten“/„Nächste“ anbieten (die übrigen ungelesenen, in dieser Reihenfolge). */
  const openItem = (n: NewsItem, i: number) => {
    const rest = (items ?? [])
      .slice(i + 1)
      .filter((x) => x.url !== '#ordner' && isUnread(x, seenAtOpen))
      .map((x) => ({ url: target(x), createdAt: x.createdAt }));
    setOpen(false);
    afterBack(() => {
      startTrail(rest);
      navigate(target(n));
    });
  };

  return (
    <>
      <button className="icon-btn badge-btn bell-btn" aria-label={unread ? `Neuigkeiten (${unread} neu)` : 'Neuigkeiten'} title="Neuigkeiten" onClick={show}>
        <Icon name="bell" size={24} />
        {unread > 0 && <span className="count-badge unread">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Sheet title="Neuigkeiten" onClose={() => setOpen(false)}>
          {err && <p className="notice warning">{err}</p>}
          {items === null && !err && <p className="muted small">Lädt …</p>}
          {items && items.length === 0 && <p className="muted">Noch keine Neuigkeiten.</p>}
          {items && items.length > 0 && (
            <ul className="list news-list">
              {items.map((n, i) => (
                <li key={n.id}>
                  <button
                    className={`card card-btn news-item${isUnread(n, seenAtOpen) ? ' new' : ''}`}
                    onClick={() => openItem(n, i)}
                  >
                    <span className="news-icon">
                      <Icon name={ICON[n.kind] ?? 'bell'} size={18} />
                    </span>
                    <span className="news-text">
                      <strong>{n.title}</strong>
                      <span className="break">{n.body}</span>
                      <span className="muted small">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </>
  );
}
