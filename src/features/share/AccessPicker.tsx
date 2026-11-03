import type { Access, FileItem, Folder } from '../../domain/types';
import { useLibrary } from '../../state/Library';

export const ACCESS_LABEL: Record<Access, string> = {
  read: 'Nur lesen',
  edit: 'Lesen & bearbeiten',
  delete: 'Lesen, bearbeiten & löschen',
};

/**
 * Was andere Mitglieder mit einem geteilten Eintrag tun dürfen.
 * value null = wie der übergeordnete Ordner. Nur sichtbar für Ersteller und Besitzer.
 */
export function AccessPicker({ item, value, onChange, disabled = false }: { item: Folder | FileItem; value: Access | null; onChange: (v: Access | null) => void; disabled?: boolean }) {
  const { canSetAccess, inheritedAccessOf, isRoot, parentShareOf, online } = useLibrary();
  if (!canSetAccess(item)) return null;
  const isFolder = !('folderId' in item);
  // Ganz oben (nicht in einem anderen geteilten Ordner): nichts darüber, von dem geerbt wird – Standard ist „Nur lesen“.
  const top = isFolder && isRoot(item) && !parentShareOf(item.shareId);
  const inherited = inheritedAccessOf(item);
  const options: (Access | null)[] = top ? [null, 'edit', 'delete'] : [null, 'read', 'edit', 'delete'];
  const label = (v: Access | null) =>
    v === null ? (top ? `${ACCESS_LABEL.read} (Standard)` : `Wie der Ordner (${ACCESS_LABEL[inherited]})`) : ACCESS_LABEL[v];

  return (
    <div className="field">
      <div className="field-label">
        <span>Andere Mitglieder dürfen</span>
      </div>
      <div className="access-options" role="radiogroup">
        {options.map((v) => (
          <button
            key={v ?? 'inherit'}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`access-option${value === v ? ' on' : ''}`}
            onClick={() => onChange(v)}
            disabled={!online || disabled}
          >
            <span className="radio-dot" aria-hidden="true" />
            {label(v)}
          </button>
        ))}
      </div>
      <span className="muted small">
        {`Neues hinzufügen dürfen alle; der Besitzer darf immer alles.${isFolder ? ' Gilt auch für alles, was du darin erstellst – außer du stellst es dort anders ein.' : ''}`}
      </span>
    </div>
  );
}
