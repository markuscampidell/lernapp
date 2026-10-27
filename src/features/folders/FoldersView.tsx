import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { MAX_DEPTH } from '../../domain/types';
import { canMoveFolder, childFolders, depthOf, filesIn, pathOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { afterBack, goUp, openFolder, replace, useBackToClose } from '../../lib/router';
import { DOCUMENT_ACCEPT, fileKind, fullName, isTouchDevice, KIND_LABEL } from '../../lib/files';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { SearchBox } from '../../components/SearchBox';
import { FolderThumb } from '../../components/Thumbs';
import { FileStager, stage, type StagedFile } from '../../components/FileStager';
import { Sheet } from '../../components/Sheet';
import { FolderPicker } from '../../components/FolderPicker';
import { FileCard, FolderCard } from './Cards';
import { FolderEditorSheet } from './FolderEditorSheet';
import { FileViewer } from './FileViewer';
import { NoteSheet } from './NoteSheet';

const norm = (s: string) => s.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function FoldersView({ folderId }: { folderId: string | null }) {
  const { folders, files } = useLibrary();
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;

  // Unbekannte ID in der URL (z. B. gelöscht) -> zur Übersicht.
  useEffect(() => {
    if (folderId && !folder) replace('#ordner');
  }, [folderId, folder]);
  // Geschweifte Klammern sind wichtig: Neuere Browser geben bei scrollTo ein Promise zurück,
  // das React sonst als Aufräumfunktion aufrufen würde (-> Absturz beim Tabwechsel).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [folderId]);

  if (folderId && !folder) return null;
  return <FolderPage key={folderId ?? 'root'} folder={folder ?? null} folders={folders} files={files} />;
}

interface Selection {
  folders: Set<string>;
  files: Set<string>;
}

function FolderPage({ folder, folders, files }: { folder: Folder | null; folders: Folder[]; files: FileItem[] }) {
  const { deleteMany, moveMany } = useLibrary();
  // Was gerade verschoben wird (öffnet die Ordnerauswahl).
  const [moving, setMoving] = useState<{ folders: string[]; files: string[]; fromSelection: boolean } | null>(null);
  const [query, setQuery] = useState('');
  // Auswahlmodus (nur Touch: durch langes Drücken). null = aus.
  const [sel, setSel] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<'newFolder' | 'edit' | 'note' | 'add' | null>(null);
  const [viewing, setViewing] = useState<FileItem | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const id = folder?.id ?? null;
  const path = pathOf(folders, id);
  const depth = folder ? depthOf(folders, folder.id) : 0;
  const canSub = depth < MAX_DEPTH;
  const subfolders = childFolders(folders, id);
  const ownFiles = folder ? filesIn(files, folder.id) : [];

  // Suche: auf oberster Ebene alles, in einem Ordner nur darin (inkl. aller Unterordner).
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    const scope = folder ? subtreeIds(folders, folder.id) : null;
    const inScope = (fid: string) => !scope || scope.has(fid);
    const label = (fid: string) => {
      const p = pathOf(folders, fid);
      const rel = folder ? p.slice(p.findIndex((x) => x.id === folder.id) + 1) : p;
      return rel.map((x) => x.name).join(' / ');
    };
    const terms = q.split(/\s+/);
    const hit = (...fields: (string | undefined)[]) => {
      const hay = norm(fields.filter(Boolean).join(' '));
      return terms.every((t) => hay.includes(t));
    };
    const fs = folders
      .filter((f) => f.id !== folder?.id && inScope(f.id) && hit(f.name, f.description))
      .map((f) => ({ f, path: label(f.parentId ?? '') }));
    const fi = files
      .filter((f) => inScope(f.folderId) && hit(f.name, f.ext, f.description, KIND_LABEL[fileKind(f)]))
      .map((f) => ({ f, path: label(f.folderId) }));
    return { folders: fs, files: fi };
  }, [query, folders, files, folder]);

  // Aktuell sichtbare Einträge (für "Alle auswählen").
  const visibleFolders = results ? results.folders.map((r) => r.f) : subfolders;
  const visibleFiles = results ? results.files.map((r) => r.f) : ownFiles;

  /** Fragt nach und löscht. Nennt mitgelöschte Unterordner/Dateien. */
  const confirmAndDelete = async (folderIds: string[], fileIds: string[]) => {
    const inFolders = new Set<string>();
    folderIds.forEach((fid) => subtreeIds(folders, fid).forEach((x) => inFolders.add(x)));
    const fileSet = new Set(fileIds);
    const totalFiles = files.filter((f) => fileSet.has(f.id) || inFolders.has(f.folderId)).length;
    const subCount = inFolders.size - folderIds.length;
    let msg: string;
    if (folderIds.length + fileIds.length === 1) {
      const name = folderIds.length ? folders.find((f) => f.id === folderIds[0])?.name : fullName(files.find((f) => f.id === fileIds[0])!);
      msg = `„${name}“ löschen?`;
    } else {
      const parts = [folderIds.length && `${folderIds.length} Ordner`, fileIds.length && `${fileIds.length} Datei${fileIds.length === 1 ? '' : 'en'}`].filter(Boolean);
      msg = `${parts.join(' und ')} löschen?`;
    }
    const extraFiles = totalFiles - fileIds.length;
    const extra = [subCount > 0 && `${subCount} Unterordner`, extraFiles > 0 && `${extraFiles} Datei${extraFiles === 1 ? '' : 'en'}`].filter(Boolean);
    if (extra.length) msg += ` Darin enthalten sind ${extra.join(' und ')}, die ebenfalls gelöscht werden.`;
    if (!confirm(msg)) return false;
    await deleteMany(folderIds, fileIds);
    return true;
  };

  const toggle = (kind: 'folders' | 'files', itemId: string) =>
    setSel((prev) => {
      const next: Selection = { folders: new Set(prev?.folders), files: new Set(prev?.files) };
      if (next[kind].has(itemId)) next[kind].delete(itemId);
      else next[kind].add(itemId);
      return next.folders.size + next.files.size === 0 ? null : next;
    });

  const itemProps = (kind: 'folders' | 'files', itemId: string, open: () => void) => ({
    selecting: !!sel,
    selected: !!sel?.[kind].has(itemId),
    onClick: sel ? () => toggle(kind, itemId) : open,
    onLongPress: isTouchDevice ? () => toggle(kind, itemId) : undefined,
    onDelete: () => confirmAndDelete(kind === 'folders' ? [itemId] : [], kind === 'files' ? [itemId] : []),
    onMove: () => setMoving({ folders: kind === 'folders' ? [itemId] : [], files: kind === 'files' ? [itemId] : [], fromSelection: false }),
  });

  // Ein Eingabefeld für beide Knöpfe; nur der erlaubte Dateityp wechselt.
  const pickFiles = (accept: string | undefined = DOCUMENT_ACCEPT) => {
    const el = fileInput.current;
    if (!el) return;
    if (accept) el.accept = accept;
    else el.removeAttribute('accept');
    el.click();
  };

  return (
    <section className="view">
      {sel && (
        <SelectionBar
          count={sel.folders.size + sel.files.size}
          allSelected={visibleFolders.every((f) => sel.folders.has(f.id)) && visibleFiles.every((f) => sel.files.has(f.id))}
          onAll={(all) =>
            setSel(all ? { folders: new Set(visibleFolders.map((f) => f.id)), files: new Set(visibleFiles.map((f) => f.id)) } : null)
          }
          onDelete={async () => {
            if (await confirmAndDelete([...sel.folders], [...sel.files])) setSel(null);
          }}
          onMove={() => setMoving({ folders: [...sel.folders], files: [...sel.files], fromSelection: true })}
          onClose={() => setSel(null)}
        />
      )}
      {folder ? (
        <>
          <div className="folder-top">
            <button className="icon-btn" aria-label="Zurück" onClick={() => goUp(folder.parentId)}>
              <Icon name="back" />
            </button>
            <nav className="crumbs grow" aria-label="Pfad">
              <button onClick={() => replace('#ordner')}>Ordner</button>
              {path.slice(0, -1).map((p) => (
                <span key={p.id} className="crumb">
                  <Icon name="chevron" size={14} />
                  <button onClick={() => replace(`#ordner/${encodeURIComponent(p.id)}`)}>{p.name}</button>
                </span>
              ))}
            </nav>
            <button className="icon-btn" aria-label="Ordner bearbeiten" title="Bearbeiten" onClick={() => setSheet('edit')}>
              <Icon name="edit" />
            </button>
          </div>
          <header className="folder-head">
            <FolderThumb folder={folder} size="lg" />
            <div className="grow">
              <h1 className="break">{folder.name}</h1>
              {folder.description && <p className="muted">{folder.description}</p>}
            </div>
          </header>
          <div className="action-row">
            <button className="btn primary" onClick={() => pickFiles()}>
              <Icon name="upload" size={18} /> Dateien
            </button>
            <button className="btn ghost" onClick={() => setSheet('newFolder')} disabled={!canSub} title={canSub ? undefined : 'Maximale Tiefe erreicht'}>
              <Icon name="folderPlus" size={18} /> Unterordner
            </button>
            <button className="btn ghost" onClick={() => setSheet('note')}>
              <Icon name="text" size={18} /> Notiz
            </button>
          </div>
          {!canSub && <p className="muted small">Maximale Ordnertiefe ({MAX_DEPTH} Ebenen) erreicht – hier sind keine weiteren Unterordner möglich.</p>}
        </>
      ) : (
        <header className="view-header">
          <h1>Ordner</h1>
          <button className="btn primary" onClick={() => setSheet('newFolder')}>
            <Icon name="plus" /> Neuer Ordner
          </button>
        </header>
      )}

      {(subfolders.length > 0 || ownFiles.length > 0 || query) && (
        <SearchBox value={query} onChange={setQuery} placeholder={folder ? `In „${folder.name}“ suchen` : 'Alles durchsuchen'} />
      )}

      {results ? (
        results.folders.length + results.files.length === 0 ? (
          <EmptyState title="Keine Treffer">Gesucht wird in Namen, Beschreibungen und Dateitypen.</EmptyState>
        ) : (
          <>
            {results.folders.length > 0 && (
              <>
                <h3 className="section-title">Ordner</h3>
                <ul className="list">
                  {results.folders.map(({ f, path }) => (
                    <li key={f.id}>
                      <FolderCard folder={f} path={path || undefined} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {results.files.length > 0 && (
              <>
                <h3 className="section-title">Dateien</h3>
                <ul className="list">
                  {results.files.map(({ f, path }) => (
                    <li key={f.id}>
                      <FileCard file={f} path={path || undefined} {...itemProps('files', f.id, () => setViewing(f))} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      ) : (
        <>
          {!folder && subfolders.length === 0 && (
            <EmptyState title="Noch keine Ordner">
              Lege einen Ordner an, z. B. für ein Fach oder eine Vorlesung. Darin kannst du Unterordner und Dateien sammeln.
            </EmptyState>
          )}
          {folder && subfolders.length === 0 && ownFiles.length === 0 && (
            <EmptyState title="Dieser Ordner ist leer">Füge Dateien hinzu (Text, Bilder, PDFs, Präsentationen …) oder lege Unterordner an.</EmptyState>
          )}
          {subfolders.length > 0 && (
            <>
              {folder && <h3 className="section-title">Unterordner</h3>}
              <ul className="list">
                {subfolders.map((f) => (
                  <li key={f.id}>
                    <FolderCard folder={f} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {ownFiles.length > 0 && (
            <>
              <h3 className="section-title">Dateien</h3>
              <ul className="list">
                {ownFiles.map((f) => (
                  <li key={f.id}>
                    <FileCard file={f} {...itemProps('files', f.id, () => setViewing(f))} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (list && list.length) {
            const added = stage(list);
            setStaged((prev) => (sheet === 'add' ? [...prev, ...added] : added));
            setSheet('add');
          }
          e.target.value = '';
        }}
      />

      {sheet === 'newFolder' && (
        <FolderEditorSheet parentId={id} onClose={() => setSheet(null)} onCreated={(f) => afterBack(() => openFolder(f.id))} />
      )}
      {sheet === 'edit' && folder && (
        <FolderEditorSheet folder={folder} onClose={() => setSheet(null)} onDeleted={() => afterBack(() => replace(folder.parentId ? `#ordner/${encodeURIComponent(folder.parentId)}` : '#ordner'))} />
      )}
      {sheet === 'note' && folder && <NoteSheet folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'add' && folder && (
        <AddFilesSheet folder={folder} items={staged} onChange={setStaged} onMore={() => pickFiles()} onClose={() => setSheet(null)} />
      )}
      {moving && (
        <FolderPicker
          title={`${moving.folders.length + moving.files.length === 1 ? '' : `${moving.folders.length + moving.files.length} Einträge `}verschieben nach`}
          startId={id}
          allowRoot={moving.files.length === 0}
          isDisabled={(target) =>
            (target === null && moving.files.length > 0) ||
            moving.folders.some((fid) => !canMoveFolder(folders, fid, target))
          }
          confirmLabel={(f) => (f ? `Nach „${f.name}“ verschieben` : 'Auf oberste Ebene verschieben')}
          onPick={async (target) => {
            const m = moving;
            setMoving(null);
            try {
              await moveMany(m.folders, m.files, target);
              if (m.fromSelection) setSel(null);
            } catch (e) {
              alert(e instanceof Error ? e.message : 'Verschieben fehlgeschlagen.');
            }
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

function AddFilesSheet({
  folder,
  items,
  onChange,
  onMore,
  onClose,
}: {
  folder: Folder;
  items: StagedFile[];
  onChange: (s: StagedFile[]) => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const { addFiles } = useLibrary();
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const busy = done !== null;

  useEffect(() => {
    if (items.length === 0 && !busy) onClose();
  }, [items.length, busy, onClose]);

  const save = async () => {
    setDone(0);
    setErr(null);
    try {
      await addFiles(
        folder.id,
        items.map((i) => ({ file: i.file, filename: i.file.name, name: i.name, description: i.description })),
        setDone,
      );
      onChange([]);
      onClose();
    } catch (e) {
      console.error(e);
      setErr('Speichern fehlgeschlagen – evtl. ist der Gerätespeicher voll.');
      setDone(null);
    }
  };

  return (
    <Sheet
      title={`${items.length} Datei${items.length === 1 ? '' : 'en'} hinzufügen`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn ghost" onClick={onMore} disabled={busy}>
            <Icon name="plus" size={18} /> Mehr
          </button>
          <button className="btn primary grow" onClick={save} disabled={busy || items.some((i) => !i.name.trim())}>
            {busy ? `Speichert … ${done}/${items.length}` : `In „${folder.name}“ speichern`}
          </button>
        </>
      }
    >
      <FileStager items={items} onChange={onChange} disabled={busy} />
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}

function SelectionBar({
  count,
  allSelected,
  onAll,
  onDelete,
  onMove,
  onClose,
}: {
  count: number;
  allSelected: boolean;
  onAll: (all: boolean) => void;
  onDelete: () => void;
  onMove: () => void;
  onClose: () => void;
}) {
  // Zurück-Taste beendet den Auswahlmodus.
  useBackToClose(onClose);
  return (
    <div className="select-bar" role="toolbar" aria-label="Auswahl">
      <button className="icon-btn" aria-label="Auswahl beenden" onClick={onClose}>
        <Icon name="close" />
      </button>
      <strong className="grow">{count} ausgewählt</strong>
      <button className="btn ghost small" onClick={() => onAll(!allSelected)}>
        {allSelected ? 'Keine' : 'Alle'}
      </button>
      <button className="icon-btn" aria-label="Verschieben" title="Verschieben" onClick={onMove}>
        <Icon name="move" />
      </button>
      <button className="icon-btn danger-icon" aria-label="Löschen" title="Löschen" onClick={onDelete}>
        <Icon name="trash" />
      </button>
    </div>
  );
}
