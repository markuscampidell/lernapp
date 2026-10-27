import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { MAX_DEPTH, SHARED_ROOT } from '../../domain/types';
import { childFolders, depthOf, filesIn, pathOf, scopeOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { afterBack, folderHash, goUp, openFolder, replace, useBackToClose } from '../../lib/router';
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
import { ShareSheet } from '../share/ShareSheet';
import { AccountCard } from '../account/AccountCard';
import { cloudEnabled } from '../../cloud/supabase';

const norm = (s: string) => s.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function FoldersView({ folderId }: { folderId: string | null }) {
  const { folders, files } = useLibrary();
  const sharedRoot = folderId === SHARED_ROOT;
  const folder = folderId && !sharedRoot ? folders.find((f) => f.id === folderId) : undefined;

  // Unbekannte ID in der URL (z. B. gelöscht oder nicht mehr geteilt) -> zur Übersicht.
  useEffect(() => {
    if (folderId && !sharedRoot && !folder) replace('#ordner');
  }, [folderId, folder, sharedRoot]);
  // Geschweifte Klammern sind wichtig: Neuere Browser geben bei scrollTo ein Promise zurück,
  // das React sonst als Aufräumfunktion aufrufen würde (-> Absturz beim Tabwechsel).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [folderId]);

  if (folderId && !sharedRoot && !folder) return null;
  return <FolderPage key={folderId ?? 'root'} folder={folder ?? null} scope={sharedRoot ? 'shared' : 'mine'} folders={folders} files={files} />;
}

interface Selection {
  folders: Set<string>;
  files: Set<string>;
}

function FolderPage({ folder, scope: rootScope, folders, files }: { folder: Folder | null; scope: 'mine' | 'shared'; folders: Folder[]; files: FileItem[] }) {
  const lib = useLibrary();
  const { deleteMany, moveMany, deleteProblem, moveProblem, canModify, canAddIn, canEditFolder, isRoot, isOwner, isOrphan, isNewSince, me } = lib;
  // Was gerade verschoben wird (öffnet die Ordnerauswahl).
  const [moving, setMoving] = useState<{ folders: string[]; files: string[]; fromSelection: boolean } | null>(null);
  const [query, setQuery] = useState('');
  // Auswahlmodus (nur Touch: durch langes Drücken). null = aus.
  const [sel, setSel] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<'newFolder' | 'edit' | 'note' | 'add' | 'share' | null>(null);
  const [viewing, setViewing] = useState<FileItem | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const id = folder?.id ?? (rootScope === 'shared' ? SHARED_ROOT : null);
  const scope = folder ? scopeOf(folders, folder.id) : rootScope;
  const path = pathOf(folders, folder?.id ?? null);
  const depth = folder ? depthOf(folders, folder.id) : 0;
  const canSub = depth < MAX_DEPTH;
  const subfolders = childFolders(folders, id);
  const ownFiles = folder ? filesIn(files, folder.id) : [];
  const remote = !!folder?.shareId;
  const orphan = folder ? isOrphan(folder.id) : false;
  const canAdd = !!folder && !orphan && canAddIn(folder.id);
  const showShare = cloudEnabled && !!folder && !orphan && (!folder.shareId || isRoot(folder));
  // Bei Unterordnern geteilter Ordner verwaltet "Personen" den obersten geteilten Ordner.
  const shareTarget = folder?.shareId ? folders.find((f) => f.id === lib.shareOf(folder)?.rootId) : folder;

  // "Neu"-Markierung: Stand vom Öffnen merken, dann als gesehen markieren.
  const [since] = useState(() => (folder ? lib.seenAt(folder.id) : undefined));
  const hasNewDirect =
    remote && !!folder && [...subfolders, ...ownFiles].some((x) => isNewSince(x, lib.seenAt(folder.id)));
  const { markSeen } = lib;
  const remoteId = folder?.shareId ? folder.id : null;
  useEffect(() => {
    if (remoteId) markSeen(remoteId);
  }, [remoteId, hasNewDirect, markSeen]);

  // Suche: auf oberster Ebene alles, in einem Ordner nur darin (inkl. aller Unterordner).
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    const inside = new Set<string>();
    if (folder) subtreeIds(folders, folder.id).forEach((x) => inside.add(x));
    else childFolders(folders, id).forEach((top) => subtreeIds(folders, top.id).forEach((x) => inside.add(x)));
    const inScope = (fid: string) => inside.has(fid);
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
  }, [query, folders, files, folder, id]);

  // Aktuell sichtbare Einträge (für "Alle auswählen").
  const visibleFolders = results ? results.folders.map((r) => r.f) : subfolders;
  const visibleFiles = results ? results.files.map((r) => r.f) : ownFiles;

  /** Fragt nach und löscht. Nennt mitgelöschte Unterordner/Dateien. */
  const confirmAndDelete = async (folderIds: string[], fileIds: string[]) => {
    const problem = deleteProblem(folderIds, fileIds);
    if (problem) {
      alert(problem);
      return false;
    }
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
    const sharedRoots = folderIds.map((fid) => folders.find((f) => f.id === fid)).filter((f) => isRoot(f));
    if (sharedRoots.length) msg += `\n\n${sharedRoots.map((f) => `„${f!.name}“`).join(', ')} ist geteilt und wird für alle Mitglieder gelöscht.`;
    if (!confirm(msg)) return false;
    try {
      await deleteMany(folderIds, fileIds);
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
      return false;
    }
  };

  const mayDelete = (kind: 'folders' | 'files', itemId: string) => !deleteProblem(kind === 'folders' ? [itemId] : [], kind === 'files' ? [itemId] : []);
  const mayMove = (kind: 'folders' | 'files', itemId: string) => {
    const item = kind === 'folders' ? folders.find((f) => f.id === itemId) : files.find((f) => f.id === itemId);
    if (!item) return false;
    if (kind === 'folders' && isRoot(item as Folder)) return isOwner(item.shareId);
    return canModify(item) && (!item.shareId || lib.online);
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
    onDelete: mayDelete(kind, itemId) ? () => confirmAndDelete(kind === 'folders' ? [itemId] : [], kind === 'files' ? [itemId] : []) : undefined,
    onMove: mayMove(kind, itemId)
      ? () => setMoving({ folders: kind === 'folders' ? [itemId] : [], files: kind === 'files' ? [itemId] : [], fromSelection: false })
      : undefined,
  });
  const newProp = (item: Folder | FileItem) => ({ isNew: isNewSince(item, since) });

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
          onMove={() => {
            // Rechte vorab prüfen (mit dem aktuellen Ordner als Probe-Ziel; das echte Ziel wird erst gewählt).
            const problem = moveProblem([...sel.folders], [...sel.files], folder?.id ?? null);
            if (problem) return alert(problem);
            setMoving({ folders: [...sel.folders], files: [...sel.files], fromSelection: true });
          }}
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
              <button onClick={() => replace(scope === 'shared' ? '#geteilt' : '#ordner')}>{scope === 'shared' ? 'Geteilte Ordner' : 'Meine Ordner'}</button>
              {path.slice(0, -1).map((p) => (
                <span key={p.id} className="crumb">
                  <Icon name="chevron" size={14} />
                  <button onClick={() => replace(`#ordner/${encodeURIComponent(p.id)}`)}>{p.name}</button>
                </span>
              ))}
            </nav>
            {showShare && (
              <button className="icon-btn" aria-label={remote ? 'Personen' : 'Teilen'} title={remote ? 'Personen' : 'Teilen'} onClick={() => setSheet('share')}>
                <Icon name="users" />
              </button>
            )}
            {canEditFolder(folder) && (
              <button className="icon-btn" aria-label="Ordner bearbeiten" title="Bearbeiten" onClick={() => setSheet('edit')}>
                <Icon name="edit" />
              </button>
            )}
          </div>
          <header className="folder-head">
            <FolderThumb folder={folder} size="lg" />
            <div className="grow">
              <h1 className="break">{folder.name}</h1>
              {folder.description && <p className="muted">{folder.description}</p>}
            </div>
          </header>
          <SharedInfo folder={folder} onPeople={() => setSheet('share')} />
          <div className="action-row">
            <button className="btn primary" onClick={() => pickFiles()} disabled={!canAdd}>
              <Icon name="upload" size={18} /> Dateien
            </button>
            <button className="btn ghost" onClick={() => setSheet('newFolder')} disabled={!canAdd || !canSub} title={canSub ? undefined : 'Maximale Tiefe erreicht'}>
              <Icon name="folderPlus" size={18} /> Unterordner
            </button>
            <button className="btn ghost" onClick={() => setSheet('note')} disabled={!canAdd}>
              <Icon name="text" size={18} /> Notiz
            </button>
          </div>
          {!canSub && <p className="muted small">Maximale Ordnertiefe ({MAX_DEPTH} Ebenen) erreicht – hier sind keine weiteren Unterordner möglich.</p>}
        </>
      ) : (
        <>
          <header className="view-header">
            <h1>Ordner</h1>
            {scope === 'mine' && (
              <button className="btn primary" onClick={() => setSheet('newFolder')}>
                <Icon name="plus" /> Neuer Ordner
              </button>
            )}
          </header>
          {cloudEnabled && <ScopeSwitch scope={scope} />}
        </>
      )}
      {!folder && scope === 'shared' && <SharedRootIntro />}

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
          {!folder && scope === 'mine' && subfolders.length === 0 && (
            <EmptyState title="Noch keine Ordner">
              Lege einen Ordner an, z. B. für ein Fach oder eine Vorlesung. Darin kannst du Unterordner und Dateien sammeln.
            </EmptyState>
          )}
          {!folder && scope === 'shared' && me && subfolders.length === 0 && (
            <EmptyState title="Noch keine geteilten Ordner">
              Öffne einen deiner Ordner und tippe oben auf <Icon name="users" size={14} />, um ihn zu teilen. Wenn jemand einen Ordner mit dir teilt
              (dein Benutzername: <strong>{me.username}</strong>), erscheint er hier.
            </EmptyState>
          )}
          {folder && orphan && (
            <p className="notice warning">
              {me
                ? 'Dieser geteilte Ordner ist nicht mehr verfügbar – er wurde gelöscht oder du hast keinen Zugriff mehr. Du kannst ihn löschen.'
                : 'Das ist ein geteilter Ordner. Melde dich unter „Geteilte Ordner“ an, um seinen Inhalt zu sehen.'}
            </p>
          )}
          {folder && !orphan && subfolders.length === 0 && ownFiles.length === 0 && (
            <EmptyState title="Dieser Ordner ist leer">Füge Dateien hinzu (Text, Bilder, PDFs, Präsentationen …) oder lege Unterordner an.</EmptyState>
          )}
          {subfolders.length > 0 && (
            <>
              {folder && <h3 className="section-title">Unterordner</h3>}
              {!folder && scope === 'shared' && !lib.online && <p className="notice warning">Offline – geteilte Ordner sind gerade nur lesbar.</p>}
              <ul className="list">
                {subfolders.map((f) => (
                  <li key={f.id}>
                    <FolderCard folder={f} {...newProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
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
                    <FileCard file={f} {...newProp(f)} {...itemProps('files', f.id, () => setViewing(f))} />
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

      {sheet === 'share' && shareTarget && <ShareSheet folder={shareTarget} onClose={() => setSheet(null)} />}
      {sheet === 'newFolder' && (
        <FolderEditorSheet parentId={folder?.id ?? null} onClose={() => setSheet(null)} onCreated={(f) => afterBack(() => openFolder(f.id))} />
      )}
      {sheet === 'edit' && folder && (
        <FolderEditorSheet folder={folder} onClose={() => setSheet(null)} onDeleted={() => afterBack(() => replace(folderHash(folder.parentId)))} />
      )}
      {sheet === 'note' && folder && <NoteSheet folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'add' && folder && (
        <AddFilesSheet folder={folder} items={staged} onChange={setStaged} onMore={() => pickFiles()} onClose={() => setSheet(null)} />
      )}
      {moving && (
        <FolderPicker
          title={`${moving.folders.length + moving.files.length === 1 ? '' : `${moving.folders.length + moving.files.length} Einträge `}verschieben nach`}
          startId={folder?.id ?? null}
          allowRoot={moving.files.length === 0}
          isDisabled={(target) => !!moveProblem(moving.folders, moving.files, target)}
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
    let saved = 0;
    try {
      await addFiles(
        folder.id,
        items.map((i) => ({ file: i.file, filename: i.file.name, name: i.name, description: i.description })),
        (n) => setDone((saved = n)),
      );
      onChange([]);
      onClose();
    } catch (e) {
      console.error(e);
      setErr(folder.shareId && e instanceof Error ? e.message : 'Speichern fehlgeschlagen – evtl. ist der Gerätespeicher voll.');
      // Bereits Gespeichertes aus der Liste nehmen, damit es beim erneuten Versuch nicht doppelt landet.
      if (saved) onChange(items.slice(saved));
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

/** Umschalter „Meine Ordner“ / „Geteilte Ordner“ mit "!" bei Neuem. */
function ScopeSwitch({ scope }: { scope: 'mine' | 'shared' }) {
  const { folders, unread } = useLibrary();
  const has = (s: 'mine' | 'shared') => childFolders(folders, s === 'shared' ? SHARED_ROOT : null).some((f) => unread.has(f.id));
  return (
    <div className="segmented" role="tablist" aria-label="Ordner-Bereich">
      {(['mine', 'shared'] as const).map((s) => (
        <button key={s} role="tab" aria-selected={scope === s} className={scope === s ? 'active' : ''} onClick={() => replace(s === 'shared' ? '#geteilt' : '#ordner')}>
          {s === 'shared' ? 'Geteilte Ordner' : 'Meine Ordner'}
          {has(s) && <span className="unread-dot">!</span>}
        </button>
      ))}
    </div>
  );
}

/** Oben in „Geteilte Ordner“: Anmeldung bzw. Hinweise. */
function SharedRootIntro() {
  const { me } = useLibrary();
  if (me) return null;
  return (
    <>
      <p className="muted">
        Teile Ordner mit anderen: Alle können darin Dateien und Unterordner hinzufügen. Dafür brauchst du ein Konto.
      </p>
      <AccountCard />
    </>
  );
}

/** Info-Zeile bei geteilten Ordnern. */
function SharedInfo({ folder, onPeople }: { folder: Folder; onPeople: () => void }) {
  const { isRoot, shareOf, members, userName, me, folders, online } = useLibrary();
  if (!folder.shareId) return null;
  const share = shareOf(folder);
  if (!share) return null;
  const count = members.filter((m) => m.shareId === share.id).length + 1;
  const owner = share.ownerId === me?.id ? 'dir' : userName(share.ownerId);
  const root = folders.find((f) => f.id === share.rootId);
  return (
    <>
      <button className="share-info" onClick={onPeople}>
        <Icon name="users" size={18} />
        <span className="grow">
          {isRoot(folder) ? `Geteilt von ${owner} · ${count} ${count === 1 ? 'Person' : 'Personen'}` : `In „${root?.name ?? '…'}“ (geteilt von ${owner}) · erstellt von ${folder.createdBy === me?.id ? 'dir' : userName(folder.createdBy)}`}
        </span>
        <span className="link">Personen</span>
      </button>
      {!online && (
        <p className="notice warning">
          <Icon name="cloudOff" size={18} /> Offline – du kannst geöffnete Dateien ansehen, aber nichts ändern.
        </p>
      )}
    </>
  );
}
