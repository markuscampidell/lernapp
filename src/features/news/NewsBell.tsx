import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { fetchNews, type NewsItem } from '../../cloud/remote';
import { cloudEnabled } from '../../cloud/supabase';
import { afterBack, navigate } from '../../lib/router';
import { useLibrary } from '../../state/Library';
import { ago } from '../comments/Comments';

/** Wann die Glocke zuletzt geöffnet wurde (pro Konto, auf diesem Gerät). */
const seenKey = (userId: string) => `lernapp-neuigkeiten-gesehen-${userId}`;
const readSeen = (userId: string) => {
  try {
    return Number(localStorage.getItem(seenKey(userId))) || 0;
  } catch {
    return 0;
  }
};

const ICON: Record<string, IconName> = { comment: 'comment', share: 'users', handover: 'folder', new_item: 'plus', change: 'edit' };

/** Kommentar-Neuigkeiten öffnen die Datei gleich mit offenen Kommentaren. */
const target = (n: NewsItem) => (n.kind === 'comment' && /^#ordner\/[^/]+\/[^/]+$/.test(n.url) ? `${n.url}/kommentare` : n.url);

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

  if (!cloudEnabled || !me) return null;
  const unread = (items ?? []).filter((n) => Date.parse(n.createdAt) > seen).length;

  const show = () => {
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
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className={`card card-btn news-item${Date.parse(n.createdAt) > seenAtOpen ? ' new' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      afterBack(() => navigate(target(n)));
                    }}
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
