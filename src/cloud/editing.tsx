// Wer bearbeitet gerade eine geteilte Datei? Über Supabase Realtime "Presence" (nichts wird gespeichert).
import { useEffect, useState } from 'react';
import type { FileItem } from '../domain/types';
import { newId } from '../lib/id';
import { useAuth } from './auth';
import { supabase } from './supabase';

export interface Editor {
  key: string;
  userId: string;
  username: string;
  /** Seit wann (ms) diese Person die Datei im Editor offen hat. */
  since: number;
  /** Dasselbe Konto in einem anderen Fenster/auf einem anderen Gerät. */
  self: boolean;
}

// Eine Kennung pro Fenster: so fällt auch dasselbe Konto in zwei Fenstern auf.
const TAB = newId();

/**
 * Meldet, dass ich diese geteilte Datei gerade bearbeite, und liefert alle anderen, die sie auch bearbeiten.
 * `mine` = Zeitpunkt, seit dem ich sie offen habe (zum Vergleich, wer zuerst da war).
 */
export function useEditors(file?: FileItem | null): { others: Editor[]; mine: number } {
  const { user } = useAuth();
  const [others, setOthers] = useState<Editor[]>([]);
  const [mine] = useState(() => Date.now());
  const fileId = file?.shareId ? file.id : null;

  useEffect(() => {
    if (!fileId || !user || !supabase) return;
    const client = supabase;
    const channel = client.channel(`edit-${fileId}`, { config: { presence: { key: TAB } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ userId: string; username: string; since: number }>();
      const list: Editor[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === TAB) continue;
        const m = metas[0];
        if (!m) continue;
        list.push({ key, userId: m.userId, username: m.username, since: Number(m.since) || 0, self: m.userId === user.id });
      }
      list.sort((a, b) => a.since - b.since);
      setOthers(list);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track({ userId: user.id, username: user.username, since: mine }).catch(() => {});
    });
    return () => {
      setOthers([]);
      channel.untrack().catch(() => {});
      client.removeChannel(channel);
    };
  }, [fileId, user, mine]);

  return { others, mine };
}

export const editorName = (e: Editor) => (e.self ? 'Du (in einem anderen Fenster oder auf einem anderen Gerät)' : e.username || 'Jemand');

/** "Anna", "Anna und Ben", "Anna, Ben und Cem" */
export function namesOf(list: Editor[]): string {
  const names = [...new Set(list.map(editorName))];
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

const verb = (list: Editor[]) => (list.length === 1 && !list[0].self ? 'bearbeitet' : list.length === 1 ? 'bearbeitest' : 'bearbeiten');

/** Hinweis-Zeile für Bearbeiten-Ansichten (nicht blockierend). */
export function EditingNotice({ others }: { others: Editor[] }) {
  if (!others.length) return null;
  return (
    <p className="notice warning" role="status">
      ⚠️ {namesOf(others)} {verb(others)} diese Datei gerade auch. Wenn ihr beide speichert, überschreibt der eine die Änderungen des anderen.
    </p>
  );
}

/** Sperre beim Öffnen, wenn schon jemand anderes die Datei bearbeitet. Bearbeiten ist erst nach erneutem Öffnen möglich. */
export function EditingLock({ others, onClose }: { others: Editor[]; onClose: () => void }) {
  const done = others.length === 0;
  return (
    <div className="edit-lock" role="alertdialog" aria-modal="true" aria-label="Datei wird gerade bearbeitet">
      <div className="card edit-lock-card">
        <strong>{done ? '✅ Bearbeitung beendet' : '⚠️ Wird gerade bearbeitet'}</strong>
        {done ? (
          <p>Die andere Person ist fertig. Schließe den Editor und öffne die Datei neu, damit du die neueste Version bearbeitest.</p>
        ) : (
          <>
            <p>
              {namesOf(others)} {verb(others)} diese Datei gerade. Damit keine Änderungen verloren gehen, kann sie nur eine Person gleichzeitig bearbeiten.
            </p>
            <p className="muted small">Du kannst sie bearbeiten, sobald die andere Bearbeitung beendet ist.</p>
          </>
        )}
        <button className="btn primary" onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  );
}
