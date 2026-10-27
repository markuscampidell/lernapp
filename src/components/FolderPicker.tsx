import { useMemo, useState } from 'react';
import type { Folder } from '../domain/types';
import { SHARED_ROOT } from '../domain/types';
import { childFolders, pathOf, scopeOf } from '../domain/tree';
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
  const { folders, canAddIn } = useLibrary();
  const [current, setCurrent] = useState<string | null>(startId);
  const [query, setQuery] = useState('');

  const inShared = current === SHARED_ROOT;
  const folder = current && !inShared ? folders.find((f) => f.id === current) ?? null : null;
  const path = inShared ? [] : pathOf(folders, current);
  const kids = childFolders(folders, current);
  const sharedTops = childFolders(folders, SHARED_ROOT);
  const scope = scopeOf(folders, current);
  // Gesperrt: vom Aufrufer ausgeschlossen oder (geteilt & offline) nicht beschreibbar.
  const blocked = (id: string | null) => !!isDisabled?.(id) || (id !== null && !canAddIn(id));

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return folders
      .filter((f) => f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q))
      .map((f) => ({ f, path: pathOf(folders, f.id).map((p) => p.name).join(' / ') }))
      .sort((a, b) => a.path.localeCompare(b.path, 'de'));
  }, [folders, query]);

  const canPick = !inShared && (current !== null || allowRoot) && !blocked(current);

  return (
    <Sheet
      title={title}
      onClose={onClose}
      leading={
        current !== null && !results ? (
          <button className="icon-btn" aria-label="Zurück" onClick={() => setCurrent(inShared ? null : folder?.parentId ?? null)}>
            <Icon name="back" />
          </button>
        ) : undefined
      }
      footer={
        <button className="btn primary grow" disabled={!canPick} onClick={() => onPick(current)}>
          {inShared ? 'Einen geteilten Ordner öffnen' : confirmLabel ? confirmLabel(folder) : folder ? `„${folder.name}“ wählen` : 'Oberste Ebene wählen'}
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
              {scope === 'shared' && (
                <span className="crumb">
                  <Icon name="chevron" size={14} />
                  <button onClick={() => setCurrent(SHARED_ROOT)}>Geteilte Ordner</button>
                </span>
              )}
              {path.map((p) => (
                <span key={p.id} className="crumb">
                  <Icon name="chevron" size={14} />
                  <button onClick={() => setCurrent(p.id)}>{p.name}</button>
                </span>
              ))}
            </nav>
            {current === null && sharedTops.length > 0 && (
              <button className="card card-btn row-card" onClick={() => setCurrent(SHARED_ROOT)}>
                <span className="thumb folder-thumb">
                  <Icon name="users" size={22} />
                </span>
                <div className="card-main">
                  <strong className="ellipsis">Geteilte Ordner</strong>
                  <span className="muted small ellipsis">{sharedTops.length} geteilt mit dir</span>
                </div>
                <Icon name="chevron" />
              </button>
            )}
            {kids.length === 0 ? (
              <EmptyState title={current ? 'Keine Unterordner' : 'Noch keine Ordner'}>
                {current ? 'Du kannst diesen Ordner wählen.' : 'Lege zuerst im Tab „Ordner“ einen Ordner an.'}
              </EmptyState>
            ) : (
              <ul className="list">
                {kids.map((k) => {
                  const disabled = blocked(k.id) && childFolders(folders, k.id).length === 0;
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
