import { useState } from 'react';
import type { Access, FileItem, Folder } from '../../domain/types';
import { useLibrary } from '../../state/Library';

export const ACCESS_LABEL: Record<Access, string> = {
  read: 'Nur lesen',
  edit: 'Lesen und bearbeiten',
  delete: 'Lesen, bearbeiten und löschen',
};
const LEVELS: Access[] = ['read', 'edit', 'delete'];

/**
 * Was andere Mitglieder mit einem geteilten Ordner bzw. einer geteilten Datei tun dürfen (in „Personen“).
 * Einstellen dürfen der Besitzer (alles) und Mitglieder (nur bei dem, was sie selbst erstellt haben) – jede Stufe, strenger oder lockerer.
 * Die Stufe des Ordners darüber ist „wie der Ordner“ (value null = erben). Speichert sofort beim Antippen.
 */
export function AccessPicker({ item }: { item: Folder | FileItem }) {
  const { canSetAccess, inheritedAccessOf, isRoot, parentShareOf, setAccess, online } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!canSetAccess(item)) return null;

  const isFolder = !('folderId' in item);
  // Ganz oben (nicht in einem anderen geteilten Ordner): nichts darüber – Standard ist „Nur lesen“.
  const top = isFolder && isRoot(item as Folder) && !parentShareOf(item.shareId);
  const inherited: Access = top ? 'read' : inheritedAccessOf(item);
  const current: Access = item.access ?? inherited;

  const pick = async (l: Access) => {
    const next = l === inherited ? null : l;
    if (next === (item.access ?? null)) return;
    setBusy(true);
    setErr(null);
    try {
      await setAccess(item, next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="people-group">
      <h3 className="people-group-title">Andere Mitglieder dürfen</h3>
      <div className="access-options" role="radiogroup">
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={current === l}
            className={`access-option${current === l ? ' on' : ''}`}
            onClick={() => pick(l)}
            disabled={!online || busy}
          >
            <span className="radio-dot" aria-hidden="true" />
            <span className="access-text">
              <span>
                {ACCESS_LABEL[l]}
                {l === inherited && !top && <span className="muted"> (wie der Ordner)</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">Neues hinzufügen dürfen alle Mitglieder.</p>
      {err && <p className="notice critical">{err}</p>}
    </section>
  );
}
