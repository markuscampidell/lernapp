import { useMemo, useState } from 'react';
import { childFolders, filesIn, pathOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { EmptyState } from '../../components/EmptyState';
import { fullName } from '../../lib/files';

interface Props {
  folderIds: string[];
  fileIds: string[];
  onDone: (folderIds: string[], fileIds: string[]) => void;
  onClose: () => void;
}

/** Ordner (inkl. Unterordner) und/oder einzelne Dateien als Quellen für die KI auswählen. */
export function SourcePicker({ folderIds, fileIds, onDone, onClose }: Props) {
  const { folders, files } = useLibrary();
  const [current, setCurrent] = useState<string | null>(null);
  const [selFolders, setSelFolders] = useState(() => new Set(folderIds));
  const [selFiles, setSelFiles] = useState(() => new Set(fileIds));

  const folder = current ? folders.find((f) => f.id === current) : undefined;
  const path = pathOf(folders, current);
  const kids = childFolders(folders, current);
  const ownFiles = current ? filesIn(files, current) : [];

  // Ordner, die schon über einen gewählten Oberordner enthalten sind.
  const covered = useMemo(() => {
    const s = new Set<string>();
    selFolders.forEach((id) => subtreeIds(folders, id).forEach((x) => s.add(x)));
    return s;
  }, [selFolders, folders]);

  const fileCount = useMemo(() => {
    const ids = new Set(selFiles);
    files.forEach((f) => covered.has(f.folderId) && ids.add(f.id));
    return ids.size;
  }, [covered, selFiles, files]);

  const toggleFolder = (id: string) =>
    setSelFolders((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleFile = (id: string) =>
    setSelFiles((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const done = () => {
    // Doppelte entfernen: Unterordner/Dateien, die schon in einem gewählten Ordner liegen.
    const top = [...selFolders].filter((id) => !pathOf(folders, id).slice(0, -1).some((p) => selFolders.has(p.id)));
    const topCovered = new Set<string>();
    top.forEach((id) => subtreeIds(folders, id).forEach((x) => topCovered.add(x)));
    const fs = [...selFiles].filter((id) => {
      const f = files.find((x) => x.id === id);
      return f && !topCovered.has(f.folderId);
    });
    onDone(top, fs);
  };

  return (
    <Sheet
      title="Unterlagen wählen"
      onClose={onClose}
      leading={
        current !== null ? (
          <button className="icon-btn" aria-label="Zurück" onClick={() => setCurrent(folder?.parentId ?? null)}>
            <Icon name="back" />
          </button>
        ) : undefined
      }
      footer={
        <button className="btn primary grow" disabled={fileCount === 0} onClick={done}>
          {fileCount === 0 ? 'Nichts gewählt' : `${fileCount} Datei${fileCount === 1 ? '' : 'en'} übernehmen`}
        </button>
      }
    >
      <div className="picker">
        <p className="muted small">Tippe auf den Kreis, um einen ganzen Ordner (mit Unterordnern) oder einzelne Dateien zu wählen.</p>
        <nav className="crumbs" aria-label="Pfad">
          <button onClick={() => setCurrent(null)}>
            <Icon name="home" size={16} /> Ordner
          </button>
          {path.map((p) => (
            <span key={p.id} className="crumb">
              <Icon name="chevron" size={14} />
              <button onClick={() => setCurrent(p.id)}>{p.name}</button>
            </span>
          ))}
        </nav>
        {kids.length === 0 && ownFiles.length === 0 ? (
          <EmptyState title={current ? 'Dieser Ordner ist leer' : 'Noch keine Ordner'} />
        ) : (
          <ul className="list">
            {kids.map((k) => {
              const inherited = covered.has(k.id) && !selFolders.has(k.id);
              const on = selFolders.has(k.id) || inherited;
              return (
                <li key={k.id} className="card pick-row">
                  <button className={`tick${on ? ' on' : ''}`} aria-label={`${k.name} wählen`} aria-pressed={on} disabled={inherited} onClick={() => toggleFolder(k.id)}>
                    {on && <Icon name="check" size={16} />}
                  </button>
                  <button className="pick-main" onClick={() => setCurrent(k.id)}>
                    <FolderThumb folder={k} />
                    <span className="card-main">
                      <strong className="ellipsis">{k.name}</strong>
                      <span className="muted small">{files.filter((f) => subtreeIds(folders, k.id).has(f.folderId)).length} Dateien</span>
                    </span>
                    <Icon name="chevron" />
                  </button>
                </li>
              );
            })}
            {ownFiles.map((f) => {
              const inherited = covered.has(f.folderId);
              const on = selFiles.has(f.id) || inherited;
              return (
                <li key={f.id} className="card pick-row">
                  <button className={`tick${on ? ' on' : ''}`} aria-label={`${fullName(f)} wählen`} aria-pressed={on} disabled={inherited} onClick={() => toggleFile(f.id)}>
                    {on && <Icon name="check" size={16} />}
                  </button>
                  <button className="pick-main" disabled={inherited} onClick={() => toggleFile(f.id)}>
                    <FileThumb file={f} />
                    <span className="card-main">
                      <strong className="ellipsis">{fullName(f)}</strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
