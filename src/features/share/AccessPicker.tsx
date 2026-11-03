import type { Access, FileItem, Folder } from '../../domain/types';
import { useLibrary } from '../../state/Library';

export const ACCESS_LABEL: Record<Access, string> = {
  read: 'Nur lesen',
  edit: 'Lesen & bearbeiten',
  delete: 'Lesen, bearbeiten & löschen',
};

/**
 * Was andere Mitglieder mit einem geteilten Eintrag tun dürfen – mit kurzer Erklärung pro Möglichkeit.
 * value null = wie der übergeordnete Ordner. Nur sichtbar für Ersteller und Besitzer.
 */
export function AccessPicker({ item, value, onChange, disabled = false }: { item: Folder | FileItem; value: Access | null; onChange: (v: Access | null) => void; disabled?: boolean }) {
  const { canSetAccess, inheritedAccessOf, isRoot, parentShareOf, folders, online } = useLibrary();
  if (!canSetAccess(item)) return null;
  const isFolder = !('folderId' in item);
  const root = isFolder && isRoot(item);
  // Ganz oben (nicht in einem anderen geteilten Ordner): nichts darüber, von dem geerbt wird – Standard ist „Nur lesen“.
  const top = root && !parentShareOf(item.shareId);
  const inherited = inheritedAccessOf(item);
  const parentId = isFolder ? (item as Folder).parentId : (item as FileItem).folderId;
  const parentName = folders.find((f) => f.id === parentId)?.name ?? 'dem Ordner darüber';
  const options: (Access | null)[] = top ? [null, 'edit', 'delete'] : [null, 'read', 'edit', 'delete'];

  const label = (v: Access | null) => (v === null ? (top ? `${ACCESS_LABEL.read} (Standard)` : `Wie der Ordner (${ACCESS_LABEL[inherited]})`) : ACCESS_LABEL[v]);

  /** Was die Möglichkeit konkret bedeutet. */
  const explain = (v: Access | null): string => {
    if (v === null && !top) return `Übernimmt die Einstellung von „${parentName}“ – ändert sie sich dort, ändert sie sich hier mit.`;
    const a = v ?? 'read';
    if (!isFolder) {
      if (a === 'read') return 'Andere können die Datei ansehen, aber nicht ändern.';
      if (a === 'edit') return 'Andere können die Datei auch bearbeiten und umbenennen.';
      return 'Andere können die Datei auch bearbeiten, umbenennen und löschen.';
    }
    if (a === 'read') return 'Andere können alles ansehen und Neues hinzufügen, aber nichts von dir ändern.';
    if (a === 'edit') return root ? 'Andere können auch deine Dateien und Unterordner darin bearbeiten und umbenennen.' : 'Andere können auch diesen Ordner und deine Dateien darin bearbeiten und umbenennen.';
    return root ? 'Andere können deine Dateien und Unterordner darin auch bearbeiten, umbenennen und löschen.' : 'Andere können diesen Ordner und deine Einträge darin auch bearbeiten, umbenennen und löschen.';
  };

  return (
    <div className="field">
      <div className="field-label">
        <span>Andere Mitglieder dürfen</span>
      </div>
      <span className="muted small">
        {root
          ? `Gilt nur für das, was in „${item.name}“ liegt. „${item.name}“ selbst (Name, Bild, Löschen) kann nur der Besitzer ändern.`
          : isFolder
          ? 'Gilt für diesen Ordner und alles darin, was du erstellt hast – außer du stellst es dort anders ein.'
          : 'Gilt für diese Datei.'}
      </span>
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
            <span className="access-text">
              <span>{label(v)}</span>
              <span className="access-desc">{explain(v)}</span>
            </span>
          </button>
        ))}
      </div>
      <span className="muted small">Neues hinzufügen dürfen immer alle. Was andere erstellt haben, stellen sie selbst ein. Der Besitzer darf immer alles.</span>
    </div>
  );
}
