import { useState } from 'react';
import type { Access, FileItem, Folder } from '../../domain/types';
import { useLibrary } from '../../state/Library';

export const ACCESS_LABEL: Record<Access, string> = {
  read: 'Nur lesen',
  edit: 'Lesen und bearbeiten',
  delete: 'Lesen, bearbeiten und löschen',
};
const FOLDER_LEVELS: Access[] = ['read', 'edit', 'delete'];
/** Dateien: nur lesen oder bearbeiten – ob andere sie löschen dürfen, regelt der Ordner. */
const FILE_LEVELS: Access[] = ['read', 'edit'];
/** Was Mitglieder immer dürfen (unabhängig von der Einstellung). */
export const MEMBERS_MAY = 'Alle Mitglieder dürfen Neues hinzufügen und ihre eigenen Einträge bearbeiten und löschen.';

/**
 * Was andere Mitglieder mit einem geteilten Ordner bzw. einer geteilten Datei tun dürfen (in „Personen“).
 * Einstellen dürfen der Besitzer (alles) und Mitglieder (nur bei dem, was sie selbst erstellt haben) – jede Stufe, strenger oder lockerer.
 * Die Stufe des Ordners darüber ist „wie der Ordner“ (value null = erben). Speichert sofort beim Antippen.
 */
export function AccessPicker({ item }: { item: Folder | FileItem }) {
  const { canSetAccess, inheritedAccessOf, inheritsFromFolder, isRoot, parentShareOf, setAccess, online } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!canSetAccess(item)) return null;

  const isFolder = !('folderId' in item);
  // Ganz oben (nicht in einem anderen geteilten Ordner): nichts darüber – Standard ist „Nur lesen“.
  const top = isFolder && isRoot(item as Folder) && !parentShareOf(item.shareId);
  const inherited: Access = top ? 'read' : inheritedAccessOf(item);
  const current: Access = !isFolder && item.access === 'delete' ? 'edit' : item.access ?? inherited;
  const levels = isFolder ? FOLDER_LEVELS : FILE_LEVELS;
  // Nur wenn der Ordner darüber von derselben Person stammt, übernimmt der Eintrag dessen Einstellung.
  const fromFolder = !top && inheritsFromFolder(item);
  const hint = top ? '' : fromFolder ? ' (wie der Ordner)' : ' (Standard)';

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
      <h3 className="people-group-title">Mitglieder dürfen</h3>
      <div className="access-options" role="radiogroup">
        {levels.map((l) => (
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
                {l === inherited && hint && <span className="muted">{hint}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
      {isFolder && <p className="muted small">{MEMBERS_MAY}</p>}
      {err && <p className="notice critical">{err}</p>}
    </section>
  );
}

/** Für alle, die die Rechte nicht einstellen dürfen: nur ein Satz, was sie selbst dürfen. */
export function AccessNote({ item }: { item: Folder | FileItem }) {
  const { accessOf, othersMayDelete, isRoot } = useLibrary();
  const isFolder = !('folderId' in item);
  const what = isFolder ? (isRoot(item as Folder) ? 'den Inhalt dieses Ordners' : 'diesen Ordner') : 'diese Datei';
  const a = accessOf(item);
  const text =
    a === 'read' ? `Du darfst ${what} nur lesen.` : othersMayDelete(item) ? `Du darfst ${what} lesen, bearbeiten und löschen.` : `Du darfst ${what} lesen und bearbeiten.`;
  return (
    <section className="people-group">
      <h3 className="people-group-title">Deine Rechte</h3>
      <p className="muted">{text}</p>
    </section>
  );
}
