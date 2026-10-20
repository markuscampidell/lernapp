import { useMemo, useState } from 'react';
import type { Folder } from '../domain/types';
import { childFolders, pathOf } from '../domain/tree';
import { useLibrary } from '../state/Library';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { FolderThumb } from './Thumbs';
import { SearchBox } from './SearchBox';
import { EmptyState } from './EmptyState';

interface Props {
  title: string;
  /** Ordner, in dem die Auswahl startet. */
  startId?: string | null;
  /** Darf "Oberste Ebene" gewählt werden (nur beim Verschieben von Ordnern)? */
  allowRoot?: boolean;
  /** Ordner, die nicht gewählt werden dürfen (z. B. der Ordner selbst beim Verschieben). */
  isDisabled?: (id: string | null) => boolean;
  confirmLabel?: (folder: Folder | null) => string;
  onPick: (id: string | null) => void;
  onClose: () => void;
}

/** Durch die Ordner navigieren und einen Zielordner wählen. */
export function FolderPicker({ title, startId = null, allowRoot, isDisabled, confirmLabel, onPick, onClose }: Props) {
  const { folders } = useLibrary();
  const [current, setCurrent] = useState<string | null>(startId);
  const [query, setQuery] = useState('');

  const folder = current ? folders.find((f) => f.id === current) ?? null : null;
  const path = pathOf(folders, current);
  const kids = childFolders(folders, current);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return folders
      .filter((f) => f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q))
      .map((f) => ({ f, path: pathOf(folders, f.id).map((p) => p.name).join(' / ') }))
      .sort((a, b) => a.path.localeCompare(b.path, 'de'));
  }, [folders, query]);

  const canPick = (current !== null || allowRoot) && !isDisabled?.(current);

  return (
    <Sheet
      title={title}
      onClose={onClose}
      leading={
        current !== null && !results ? (
          <button className="icon-btn" aria-label="Zurück" onClick={() => setCurrent(folder?.parentId ?? null)}>
            <Icon name="back" />
          </button>
        ) : undefined
      }
      footer={
        <button className="btn primary grow" disabled={!canPick} onClick={() => onPick(current)}>
          {confirmLabel ? confirmLabel(folder) : folder ? `„${folder.name}“ wählen` : 'Oberste Ebene wählen'}
        </button>
      }
    >
      <div className="picker">
        <SearchBox value={query} onChange={setQuery} placeholder="Ordner suchen" />
        {results ? (
          results.length === 0 ? (
            <EmptyState title="Keine Treffer" />
          ) : (
            <ul className="list">
              {results.map(({ f, path }) => (
                <li key={f.id}>
                  <button
                    className="card card-btn row-card"
                    onClick={() => {
                      setCurrent(f.id);
                      setQuery('');
                    }}
                  >
                    <FolderThumb folder={f} />
                    <div className="card-main">
                      <strong className="ellipsis">{f.name}</strong>
                      <span className="muted small ellipsis">{path}</span>
                    </div>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
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
            {kids.length === 0 ? (
              <EmptyState title={current ? 'Keine Unterordner' : 'Noch keine Ordner'}>
                {current ? 'Du kannst diesen Ordner wählen.' : 'Lege zuerst im Tab „Ordner“ einen Ordner an.'}
              </EmptyState>
            ) : (
              <ul className="list">
                {kids.map((k) => {
                  const disabled = isDisabled?.(k.id) && childFolders(folders, k.id).length === 0;
                  return (
                    <li key={k.id}>
                      <button className="card card-btn row-card" disabled={disabled} onClick={() => setCurrent(k.id)}>
                        <FolderThumb folder={k} />
                        <div className="card-main">
                          <strong className="ellipsis">{k.name}</strong>
                          {k.description && <span className="muted small ellipsis">{k.description}</span>}
                        </div>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
