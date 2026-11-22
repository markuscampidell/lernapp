import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { MAX_DEPTH, SHARED_ROOT } from '../../domain/types';
import { childFolders, depthOf, filesIn, pathOf, scopeOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { afterBack, folderHash, goUp, navigate, openFolder, replace, useBackToClose } from '../../lib/router';
import { DOCUMENT_ACCEPT, fileKind, fullName, isTouchDevice, KIND_LABEL } from '../../lib/files';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { SearchBox } from '../../components/SearchBox';
import { FolderThumb } from '../../components/Thumbs';
import { FileStager, stage, type StagedFile } from '../../components/FileStager';
import { Sheet } from '../../components/Sheet';
import { FolderPicker } from '../../components/FolderPicker';
import { FileCard, FolderCard } from './Cards';
import { AudioRecorder } from '../upload/AudioRecorder';
import { useCardButtons } from '../../lib/cardButtons';
import { FolderEditorSheet } from './FolderEditorSheet';
import { FileViewer } from './FileViewer';
import { MAX_NOTE_EDIT, NoteEditor, NoteSheet } from './NoteSheet';
import { AiSheet } from '../ai/AiSheet';
import type { AiResult } from '../ai/recipes';
import { ShareSheet } from '../share/ShareSheet';
import { CardsEditor } from '../study/CardsEditor';
import { QuizEditor } from '../study/QuizEditor';
import { DocEditor } from '../docs/DocEditor';
import { ChartEditor } from '../charts/ChartEditor';
import { parseChart } from '../charts/chart';
import { WheelEditor } from '../wheel/WheelEditor';
import { parseWheel } from '../wheel/wheel';
import { GapsEditor } from '../gaps/GapsEditor';
import { parseGapsDoc } from '../gaps/gaps';
import { FileEditorSheet } from './FileEditorSheet';
import { parseCards, parseQuiz } from '../study/format';
import { loadBlob } from '../../storage/blobs';
import type { IconName } from '../../components/Icon';
import { cloudEnabled } from '../../cloud/supabase';
import { NewsBell } from '../news/NewsBell';

const norm = (s: string) => s.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function FoldersView({ folderId, fileId, openComments }: { folderId: string | null; fileId?: string; openComments?: boolean }) {
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
  return (
    <FolderPage key={folderId ?? 'root'} folder={folder ?? null} scope={sharedRoot ? 'shared' : 'mine'} folders={folders} files={files} openFileId={fileId} openComments={openComments} />
  );
}

interface Selection {
  folders: Set<string>;
  files: Set<string>;
}

function FolderPage({
  folder,
  scope: rootScope,
  folders,
  files,
  openFileId,
  openComments,
}: {
  folder: Folder | null;
  scope: 'mine' | 'shared';
  folders: Folder[];
  files: FileItem[];
  openFileId?: string;
  openComments?: boolean;
}) {
  const lib = useLibrary();
  const { deleteMany, moveMany, deleteProblem, moveProblem, canModify, canAddIn, isRoot, isOrphan, isNewSince, me } = lib;
  // Was gerade verschoben wird (öffnet die Ordnerauswahl).
  const [moving, setMoving] = useState<{ folders: string[]; files: string[]; fromSelection: boolean } | null>(null);
  const [query, setQuery] = useState('');
  // Auswahlmodus (nur Touch: durch langes Drücken). null = aus.
  const [sel, setSel] = useState<Selection | null>(null);
  // Zuletzt geschlossene Datei kurz umrahmen (5 s sichtbar, 1 s ausblenden), damit man sieht, wo man war.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef(0);
  const flashCard = (fileId: string) => {
    window.clearTimeout(flashTimer.current);
    setFlashId(null);
    window.setTimeout(() => {
      // Kein Fokus-Rahmen des Browsers zusätzlich (der ginge nur um einen Teil der Karte, durch die Knöpfe).
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFlashId(fileId);
      flashTimer.current = window.setTimeout(() => setFlashId(null), 6000);
    }, 30);
  };
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  // Welche Knöpfe an den Karten stehen (Einstellungen, pro Gerät).
  const buttons = useCardButtons();
  // „Personen“ eines Eintrags in der Liste (Knopf an der Karte).
  const [peopleFor, setPeopleFor] = useState<{ folder?: Folder; file?: FileItem } | null>(null);
  const [sheet, setSheet] = useState<'menu' | 'audio' | 'newFolder' | 'edit' | 'note' | 'add' | 'share' | 'cards' | 'quiz' | 'doc' | 'chart' | 'wheel' | 'gaps' | 'ai' | null>(null);
  // Ergebnis von „Mit KI erstellen“ – öffnet den passenden Editor mit dem Inhalt.
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<FileItem | null>(null);
  // Datei, die mit offenen Kommentaren aufgeht (aus den Neuigkeiten).
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  // Bearbeiten direkt aus der Liste (ohne die Datei zu öffnen).
  const [editing, setEditing] = useState<
    { kind: 'folder'; folder: Folder } | { kind: 'file'; file: FileItem } | { kind: 'cards' | 'quiz' | 'doc' | 'chart' | 'wheel' | 'gaps' | 'note'; file: FileItem; text: string } | null
  >(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // #ordner/<ordner>/<datei> (z. B. aus einer Benachrichtigung): Datei gleich öffnen, Adresse auf den Ordner zurücksetzen.
  useEffect(() => {
    if (!openFileId || !folder) return;
    replace(folderHash(folder.id));
    const target = files.find((f) => f.id === openFileId && f.folderId === folder.id);
    if (target) {
      setCommentsFor(openComments ? target.id : null);
      setViewing(target);
    }
  }, [openFileId, openComments]);

  const id = folder?.id ?? (rootScope === 'shared' ? SHARED_ROOT : null);
  const path = pathOf(folders, folder?.id ?? null);
  const depth = folder ? depthOf(folders, folder.id) : 0;
  const canSub = depth < MAX_DEPTH;
  const subfolders = childFolders(folders, id);
  // Übersicht: eigene Ordner und darunter „Geteilt mit dir“ in einer Liste (kein Umschalter mehr).
  const sharedTops = !folder && cloudEnabled ? childFolders(folders, SHARED_ROOT) : [];
  const ownFiles = folder ? filesIn(files, folder.id) : [];
  const remote = !!folder?.shareId;
  const orphan = folder ? isOrphan(folder.id) : false;
  const canAdd = !!folder && !orphan && canAddIn(folder.id);
  // „Personen“ gibt es in jedem Ordner: wer ihn sieht (auch über übergeordnete Ordner) und – als Besitzer – Personen hinzufügen.
  const showShare = cloudEnabled && !!folder && !orphan;

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
    else [...subfolders, ...sharedTops].forEach((top) => subtreeIds(folders, top.id).forEach((x) => inside.add(x)));
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
  }, [query, folders, files, folder, id, subfolders, sharedTops]);


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

  // Auswahl nie gemischt aus „Meine Ordner“ und „Geteilt mit dir“ (z. B. auf der Übersicht oder in Suchergebnissen).
  const scopeOfItem = (kind: 'folders' | 'files', itemId: string) =>
    scopeOf(folders, kind === 'folders' ? itemId : files.find((f) => f.id === itemId)?.folderId ?? null);
  const selScope = (() => {
    if (!sel) return null;
    const f = sel.folders.values().next();
    if (!f.done) return scopeOfItem('folders', f.value);
    const fi = sel.files.values().next();
    return fi.done ? null : scopeOfItem('files', fi.value);
  })();
  const isBlocked = (kind: 'folders' | 'files', itemId: string) => !!selScope && scopeOfItem(kind, itemId) !== selScope;

  const toggle = (kind: 'folders' | 'files', itemId: string) =>
    setSel((prev) => {
      const next: Selection = { folders: new Set(prev?.folders), files: new Set(prev?.files) };
      if (!next[kind].has(itemId) && isBlocked(kind, itemId)) return prev;
      if (next[kind].has(itemId)) next[kind].delete(itemId);
      else next[kind].add(itemId);
      return next.folders.size + next.files.size === 0 ? null : next;
    });

  const itemProps = (kind: 'folders' | 'files', itemId: string, open: () => void) => ({
    selecting: !!sel,
    selected: !!sel?.[kind].has(itemId),
    blocked: isBlocked(kind, itemId),
    flash: kind === 'files' && flashId === itemId,
    onClick: sel ? () => toggle(kind, itemId) : open,
    onLongPress: () => toggle(kind, itemId),
    onPeople: buttons.people && cloudEnabled && !isOrphan(kind === 'folders' ? itemId : files.find((f) => f.id === itemId)?.folderId ?? '')
      ? () => setPeopleFor(kind === 'folders' ? { folder: folders.find((f) => f.id === itemId) } : { file: files.find((f) => f.id === itemId) })
      : undefined,
    onMove: (() => {
      if (!buttons.move) return undefined;
      const ids: [string[], string[]] = kind === 'folders' ? [[itemId], []] : [[], [itemId]];
      // Nur anzeigen, wenn man den Eintrag überhaupt verschieben darf (Probe-Ziel: aktueller Ordner).
      if (moveProblem(ids[0], ids[1], folder?.id ?? null)) return undefined;
      return () => setMoving({ folders: ids[0], files: ids[1], fromSelection: false });
    })(),
    onInfo: !buttons.info ? undefined : () => {
      const item = kind === 'folders' ? folders.find((f) => f.id === itemId) : files.find((f) => f.id === itemId);
      if (!item) return;
      setEditing('folderId' in item ? { kind: 'file', file: item } : { kind: 'folder', folder: item });
    },
  });
  const newProp = (item: Folder | FileItem) => ({ isNew: isNewSince(item, since) });

  /** Rechts im Bereichs-Titel: Anzahl und – im Auswahlmodus, nur in einem Ordner – „Alle“/„Keine“ für genau diesen Bereich. */
  const sectionEnd = (kind: 'folders' | 'files', items: { id: string }[], showCount = true) => {
    const ids = items.map((x) => x.id).filter((x) => !isBlocked(kind, x));
    const pick = !!sel && !!folder && ids.length >= 2;
    const all = pick && ids.every((x) => sel![kind].has(x));
    if (!pick && !showCount) return null;
    return (
      <span className="section-end">
        {showCount && <span className="section-count">{items.length}</span>}
        {pick && (
          <button
            type="button"
            className="btn primary small section-all"
            onClick={() =>
              setSel((prev) => {
                const next: Selection = { folders: new Set(prev?.folders), files: new Set(prev?.files) };
                ids.forEach((x) => (all ? next[kind].delete(x) : next[kind].add(x)));
                return next.folders.size + next.files.size === 0 ? null : next;
              })
            }
          >
            {all ? 'Keine' : 'Alle'}
          </button>
        )}
      </span>
    );
  };

  /** Karteikarten/Quiz/Dokumente/Diagramme öffnen direkt den Inhalts-Editor, andere Dateien Name/Beschreibung/Ort. */
  const startEdit = async (item: Folder | FileItem) => {
    if (!('folderId' in item)) return setEditing({ kind: 'folder', folder: item });
    const k = fileKind(item);
    const editor = k === 'flashcards' ? 'cards' : k === 'quiz' ? 'quiz' : k === 'richtext' ? 'doc' : k === 'chart' ? 'chart' : k === 'wheel' ? 'wheel' : k === 'gaps' ? 'gaps' : k === 'text' ? 'note' : null;
    if (!editor) return setEditing({ kind: 'file', file: item });
    const blob = await loadBlob(item.blobId);
    if (!blob) return alert('Die Datei konnte nicht geladen werden – bist du online?');
    setEditing({ kind: editor, file: item, text: await blob.text() });
  };
  // ✏️ nur für Dateien mit bearbeitbarem Inhalt (Karteikarten, Quiz, Text-Dokumente, Diagramme).
  const editProp = (item: Folder | FileItem) => ({
    onEdit:
      'folderId' in item && (['flashcards', 'quiz', 'richtext', 'chart', 'wheel', 'gaps'].includes(fileKind(item)) || (fileKind(item) === 'text' && item.size <= MAX_NOTE_EDIT)) && canModify(item) && (!item.shareId || lib.online)
        ? () => startEdit(item)
        : undefined,
  });

  // Ein Eingabefeld für beide Knöpfe; nur der erlaubte Dateityp wechselt.
  const pickFiles = (accept: string | undefined = DOCUMENT_ACCEPT) => {
    const el = fileInput.current;
    if (!el) return;
    if (accept) el.accept = accept;
    else el.removeAttribute('accept');
    el.click();
  };

  // Obere Leiste (Zurück, Pfad) und "Hinzufügen" bleiben beim Scrollen oben – die zweite sitzt direkt unter der ersten.
  const topBar = useRef<HTMLDivElement>(null);
  const [topH, setTopH] = useState(0);
  // Darunter (nur in Ordnern): Hinzufügen/Unterordner und Suchen. Die Bereichs-Titel („Meine Ordner“, „Dateien“ …)
  // kleben direkt unter beiden Leisten.
  const secondBar = useRef<HTMLDivElement>(null);
  const [secondH, setSecondH] = useState(0);
  useEffect(() => {
    const el = topBar.current;
    const el2 = secondBar.current;
    const ro = new ResizeObserver(() => {
      setTopH(el?.offsetHeight ?? 0);
      setSecondH(el2?.offsetHeight ?? 0);
    });
    if (el) ro.observe(el);
    if (el2) ro.observe(el2);
    if (!el2) setSecondH(0);
    return () => ro.disconnect();
  }, [!!folder]);


  // Suchfeld: bleibt beim Scrollen oben (in der festen Leiste).
  const searchBox = (subfolders.length > 0 || sharedTops.length > 0 || ownFiles.length > 0 || query) && (
    <SearchBox value={query} onChange={setQuery} placeholder="Suchen" />
  );

  return (
    <section className="view" style={{ '--sticky-top': `${topH}px`, '--titles-top': `${topH + secondH}px` } as React.CSSProperties}>
      {sel && (
        <SelectionBar
          count={sel.folders.size + sel.files.size}
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
          <div className="sticky-bar" ref={topBar}>
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
            {showShare && (
              <button className="icon-btn" aria-label="Personen" title="Personen" onClick={() => setSheet('share')}>
                <Icon name="users" />
              </button>
            )}
            <button className="icon-btn" aria-label="Ordner-Details" title="Details" onClick={() => setSheet('edit')}>
              <Icon name="info" />
            </button>
          </div>
          </div>
          <header className="folder-head">
            <FolderThumb folder={folder} size="lg" expand />
            <div className="grow">
              <h1 className="break">{folder.name}</h1>
              {folder.description && <p className="muted break">{folder.description}</p>}
            </div>
          </header>
          <SharedInfo folder={folder} onPeople={() => setSheet('share')} />
          {/* Im Auswahlmodus: Hinzufügen/Unterordner ausblenden, Suche bleibt */}
          <div className="sticky-bar sticky-second sticky-stack" ref={secondBar}>
          <div className={`fold${sel ? ' folded' : ''}`} aria-hidden={!!sel || undefined}>
          <div className="action-row">
            <button className="btn primary add-btn" onClick={() => setSheet('menu')} disabled={!canAdd}>
              <Icon name="plus" size={18} />
              <span className="add-btn-text">
                Hinzufügen
                <small>Dateien, Text-Dokumente, Karteikarten, Quiz …</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
            <button className="btn ghost" onClick={() => setSheet('newFolder')} disabled={!canAdd || !canSub} title={canSub ? undefined : 'Maximale Tiefe erreicht'}>
              <Icon name="folderPlus" size={18} /> Unterordner
            </button>
          </div>
          </div>
          {searchBox}
          </div>
          {!canSub && !sel && <p className="muted small">Maximale Ordnertiefe ({MAX_DEPTH} Ebenen) erreicht – hier sind keine weiteren Unterordner möglich.</p>}
        </>
      ) : (
        <>
          <div className="sticky-bar" ref={topBar}>
          <header className="view-header">
            <h1>Ordner</h1>
            <div className={`view-header-actions fade${sel ? ' faded' : ''}`} aria-hidden={!!sel || undefined}>
              <NewsBell />
              <button className="btn primary" onClick={() => setSheet('newFolder')}>
                <Icon name="plus" /> Ordner
              </button>
            </div>
          </header>
          {searchBox}
          </div>
        </>
      )}

      {results ? (
        results.folders.length + results.files.length === 0 ? (
          <EmptyState title="Keine Treffer">Gesucht wird in Namen, Beschreibungen und Dateitypen.</EmptyState>
        ) : (
          <>
            {results.folders.length > 0 && (
              <>
                <h3 className="section-title">Ordner{sectionEnd('folders', results.folders.map((r) => r.f), false)}</h3>
                <ul className="list">
                  {results.folders.map(({ f, path }) => (
                    <li key={f.id}>
                      <FolderCard folder={f} path={path || undefined} {...editProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {results.files.length > 0 && (
              <>
                <h3 className="section-title">Dateien{sectionEnd('files', results.files.map((r) => r.f), false)}</h3>
                <ul className="list">
                  {results.files.map(({ f, path }) => (
                    <li key={f.id}>
                      <FileCard file={f} path={path || undefined} {...editProp(f)} {...itemProps('files', f.id, () => setViewing(f))} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      ) : (
        <>
          {!folder && !cloudEnabled && subfolders.length === 0 && (
            <EmptyState title="Noch keine Ordner">
              Lege einen Ordner an, z. B. für ein Fach oder eine Vorlesung. Darin kannst du Unterordner und Dateien sammeln.
            </EmptyState>
          )}
          {folder && orphan && (
            <p className="notice warning">
              {me
                ? 'Dieser geteilte Ordner ist nicht mehr verfügbar – er wurde gelöscht oder du hast keinen Zugriff mehr. Du kannst ihn löschen.'
                : 'Das ist ein geteilter Ordner. Melde dich in den Einstellungen an, um seinen Inhalt zu sehen.'}
            </p>
          )}
          {folder && !orphan && subfolders.length === 0 && ownFiles.length === 0 && (
            <EmptyState title="Dieser Ordner ist leer">Füge Dateien hinzu (Text, Bilder, PDFs, Präsentationen …) oder lege Unterordner an.</EmptyState>
          )}
          {!folder && cloudEnabled ? (
            // Übersicht: „Meine Ordner“ und „Geteilt mit dir“ – am PC nebeneinander, am Handy untereinander.
            <div className="split">
              <section className="split-pane" aria-label="Meine Ordner">
                <h3 className="section-title sticky-bar pane-title">Meine Ordner{subfolders.length > 0 && <span className="section-count">{subfolders.length}</span>}</h3>
                {subfolders.length === 0 ? (
                  <p className="muted small">Noch keine Ordner. Lege oben mit „Neuer Ordner“ einen an, z. B. für ein Fach.</p>
                ) : (
                  <ul className="list">
                    {subfolders.map((f) => (
                      <li key={f.id}>
                        <FolderCard folder={f} {...newProp(f)} {...editProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className={`split-pane${me && sharedTops.length === 0 ? ' pc-only' : ''}`} aria-label="Geteilt mit dir">
                <h3 className="section-title sticky-bar pane-title">Geteilt mit dir{sharedTops.length > 0 && <span className="section-count">{sharedTops.length}</span>}</h3>
                {!me ? (
                  <p className="muted small">
                    Melde dich in den <button className="link" onClick={() => navigate('#einstellungen')}>Einstellungen</button> an, um Ordner mit anderen zu teilen.
                  </p>
                ) : sharedTops.length === 0 ? (
                  <p className="muted small">Noch nichts mit dir geteilt.</p>
                ) : (
                  <>
                    {!lib.online && <p className="notice warning">Offline – geteilte Ordner sind gerade nur lesbar.</p>}
                    <ul className="list">
                      {sharedTops.map((f) => (
                        <li key={f.id}>
                          <FolderCard folder={f} {...newProp(f)} {...editProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>
          ) : folder && subfolders.length > 0 && ownFiles.length > 0 ? (
            // Beides vorhanden: zwei Bereiche (Handy: untereinander, PC: nebeneinander), Titel bleiben beim Scrollen oben.
            <div className="split">
              <section className="split-pane" aria-label="Unterordner">
                <h3 className="section-title sticky-bar pane-title">Unterordner{sectionEnd('folders', subfolders)}</h3>
                <ul className="list">
                  {subfolders.map((f) => (
                    <li key={f.id}>
                      <FolderCard folder={f} {...newProp(f)} {...editProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                    </li>
                  ))}
                </ul>
              </section>
              <section className="split-pane" aria-label="Dateien">
                <h3 className="section-title sticky-bar pane-title">Dateien{sectionEnd('files', ownFiles)}</h3>
                <ul className="list">
                  {ownFiles.map((f) => (
                    <li key={f.id}>
                      <FileCard file={f} {...newProp(f)} {...editProp(f)} {...itemProps('files', f.id, () => setViewing(f))} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : (
          <>
          {subfolders.length > 0 && (
            <>
              {folder && <h3 className="section-title">Unterordner{sectionEnd('folders', subfolders, false)}</h3>}
              <ul className="list">
                {subfolders.map((f) => (
                  <li key={f.id}>
                    <FolderCard folder={f} {...newProp(f)} {...editProp(f)} {...itemProps('folders', f.id, () => openFolder(f.id))} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {ownFiles.length > 0 && (
            <>
              <h3 className="section-title">Dateien{sectionEnd('files', ownFiles, false)}</h3>
              <ul className="list">
                {ownFiles.map((f) => (
                  <li key={f.id}>
                    <FileCard file={f} {...newProp(f)} {...editProp(f)} {...itemProps('files', f.id, () => setViewing(f))} />
                  </li>
                ))}
              </ul>
            </>
          )}
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

      {([
        [cameraInput, 'image/*'],
        [videoInput, 'video/*'],
      ] as const).map(([ref, accept]) => (
        <input
          key={accept}
          ref={ref}
          type="file"
          accept={accept}
          capture="environment"
          hidden
          onChange={(e) => {
            const list = e.target.files;
            if (list && list.length) {
              setStaged(stage(list));
              setSheet('add');
            }
            e.target.value = '';
          }}
        />
      ))}

      {sheet === 'menu' && folder && (
        <AddMenu
          onClose={() => setSheet(null)}
          onPick={(choice) => {
            // Dateiauswahl muss direkt im Klick geöffnet werden (sonst blockiert der Browser sie).
            if (choice === 'files') pickFiles();
            if (choice === 'camera') cameraInput.current?.click();
            if (choice === 'video') videoInput.current?.click();
            setSheet(null);
            if (choice !== 'files' && choice !== 'camera' && choice !== 'video') afterBack(() => setSheet(choice));
          }}
        />
      )}
      {sheet === 'doc' && folder && <DocEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'share' && folder && <ShareSheet folder={folder} onClose={() => setSheet(null)} />}
      {peopleFor && (peopleFor.folder || peopleFor.file) && (
        <ShareSheet folder={peopleFor.folder} file={peopleFor.file} onClose={() => setPeopleFor(null)} />
      )}
      {sheet === 'newFolder' && (
        <FolderEditorSheet parentId={folder?.id ?? null} onClose={() => setSheet(null)} onCreated={(f) => afterBack(() => openFolder(f.id))} />
      )}
      {sheet === 'edit' && folder && (
        <FolderEditorSheet folder={folder} onClose={() => setSheet(null)} onDeleted={() => afterBack(() => replace(folderHash(folder.parentId)))} />
      )}
      {sheet === 'audio' && folder && (
        <AudioRecorder
          onClose={() => setSheet(null)}
          onDone={(file) => {
            setSheet(null);
            afterBack(() => {
              setStaged(stage([file]));
              setSheet('add');
            });
          }}
        />
      )}
      {sheet === 'note' && folder && <NoteSheet folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'cards' && folder && <CardsEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'quiz' && folder && <QuizEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'chart' && folder && <ChartEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'wheel' && folder && <WheelEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'gaps' && folder && <GapsEditor folderId={folder.id} onClose={() => setSheet(null)} />}
      {sheet === 'ai' && folder && (
        <AiSheet
          folderId={folder.id}
          onClose={() => setSheet(null)}
          onResult={(r) => {
            setSheet(null);
            afterBack(() => setAiResult(r));
          }}
        />
      )}
      {aiResult && folder && (() => {
        const close = () => setAiResult(null);
        const name = aiResult.title;
        const desc = aiResult.description || undefined;
        switch (aiResult.kind) {
          case 'cards':
            return <CardsEditor folderId={folder.id} initial={aiResult.cards} initialName={name} initialDescription={desc} onClose={close} />;
          case 'quiz':
            return <QuizEditor folderId={folder.id} initial={aiResult.questions} initialName={name} initialDescription={desc} onClose={close} />;
          case 'chart':
            return <ChartEditor folderId={folder.id} initial={aiResult.chart} initialName={name} initialDescription={desc} onClose={close} />;
          case 'wheel':
            return <WheelEditor folderId={folder.id} initial={aiResult.wheel} initialName={name} initialDescription={desc} onClose={close} />;
          case 'doc':
            return <DocEditor folderId={folder.id} initial={aiResult.html} initialName={name} initialDescription={desc} onClose={close} />;
          case 'gaps':
            return <GapsEditor folderId={folder.id} initial={aiResult.doc} initialName={name} initialDescription={desc} onClose={close} />;
          case 'note':
            return <NoteSheet folderId={folder.id} initialName={name} initialDescription={desc} initialText={aiResult.text} onClose={close} />;
        }
      })()}
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
      {viewing && (
        <FileViewer
          file={viewing}
          openComments={viewing.id === commentsFor}
          onClose={() => {
            const closedId = viewing.id;
            setViewing(null);
            setCommentsFor(null);
            flashCard(closedId);
          }}
        />
      )}
      {editing?.kind === 'folder' && <FolderEditorSheet folder={editing.folder} onClose={() => setEditing(null)} />}
      {editing?.kind === 'file' && <FileEditorSheet file={editing.file} onClose={() => setEditing(null)} />}
      {editing?.kind === 'cards' && <CardsEditor file={editing.file} initial={parseCards(editing.text).cards} onClose={() => setEditing(null)} />}
      {editing?.kind === 'quiz' && <QuizEditor file={editing.file} initial={parseQuiz(editing.text).questions} onClose={() => setEditing(null)} />}
      {editing?.kind === 'doc' && <DocEditor file={editing.file} initial={editing.text} onClose={() => setEditing(null)} />}
      {editing?.kind === 'chart' && <ChartEditor file={editing.file} initial={parseChart(editing.text)} onClose={() => setEditing(null)} />}
      {editing?.kind === 'wheel' && <WheelEditor file={editing.file} initial={parseWheel(editing.text)} onClose={() => setEditing(null)} />}
      {editing?.kind === 'note' && <NoteEditor file={editing.file} initial={editing.text} onClose={() => setEditing(null)} />}
      {editing?.kind === 'gaps' && <GapsEditor file={editing.file} initial={parseGapsDoc(editing.text)} onClose={() => setEditing(null)} />}
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
  onDelete,
  onMove,
  onClose,
}: {
  count: number;
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
      <button className="icon-btn" aria-label="Verschieben" title="Verschieben" onClick={onMove}>
        <Icon name="move" />
      </button>
      <button className="icon-btn danger-icon" aria-label="Löschen" title="Löschen" onClick={onDelete}>
        <Icon name="trash" />
      </button>
    </div>
  );
}



/** Info-Zeile bei geteilten Ordnern. */
function SharedInfo({ folder, onPeople }: { folder: Folder; onPeople: () => void }) {
  const { isRoot, shareOf, peopleOf, userName, me, folders, online } = useLibrary();
  if (!folder.shareId) return null;
  const share = shareOf(folder);
  if (!share) return null;
  const count = peopleOf(share.id).length;
  const owner = share.ownerId === me?.id ? 'dir' : userName(share.ownerId);
  const root = folders.find((f) => f.id === share.rootId);
  // Eigener Ordner, nur auf meinen Geräten: kein "geteilt"-Hinweis, nur die Möglichkeit, Personen hinzuzufügen.
  const alone = share.ownerId === me?.id && count <= 1;
  return (
    <>
      <button className="share-info" onClick={onPeople}>
        <Icon name="users" size={18} />
        <span className="grow">
          {alone ? (isRoot(folder) ? 'Auf allen deinen Geräten · mit niemandem geteilt' : `In „${root?.name ?? '…'}“ · auf allen deinen Geräten`) : isRoot(folder) ? `Geteilt von ${owner} · ${count} ${count === 1 ? 'Person' : 'Personen'}` : `In „${root?.name ?? '…'}“ (geteilt von ${owner}) · erstellt von ${folder.createdBy === me?.id ? 'dir' : userName(folder.createdBy)}`}
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

type AddChoice = 'files' | 'camera' | 'video' | 'audio' | 'doc' | 'note' | 'cards' | 'quiz' | 'gaps' | 'chart' | 'wheel' | 'ai';
const ADD_OPTIONS: { id: AddChoice; icon: IconName; title: string; short: string; text: string; touchOnly?: boolean }[] = [
  { id: 'files', icon: 'upload', title: 'Dateien durchsuchen', short: 'Datei', text: 'PDFs, Bilder, Präsentationen, Videos … von deinem Gerät' },
  { id: 'camera', icon: 'camera', title: 'Foto aufnehmen', short: 'Foto aufnehmen', text: 'Direkt mit der Kamera', touchOnly: true },
  { id: 'video', icon: 'video', title: 'Video aufnehmen', short: 'Video aufnehmen', text: 'Direkt mit der Kamera filmen', touchOnly: true },
  { id: 'audio', icon: 'mic', title: 'Audio aufnehmen', short: 'Audio aufnehmen', text: 'Mit dem Mikrofon aufnehmen' },
  { id: 'doc', icon: 'richdoc', title: 'Text-Dokument', short: 'Dokument', text: 'Formatierter Text mit Überschriften, Listen, Checklisten und Bildern' },
  { id: 'note', icon: 'text', title: 'Notiz', short: 'Notiz', text: 'Schnell ein paar Zeilen reiner Text' },
  { id: 'cards', icon: 'cards', title: 'Karteikarten', short: 'Karteikarten', text: 'Vorder- und Rückseite, mit Lernmodus' },
  { id: 'quiz', icon: 'quiz', title: 'Quiz', short: 'Quiz', text: 'Multiple Choice mit Auswertung' },
  { id: 'gaps', icon: 'gaps', title: 'Lückentext', short: 'Lückentext', text: 'Wörter einsetzen oder selbst schreiben' },
  { id: 'chart', icon: 'chart', title: 'Diagramm', short: 'Diagramm', text: 'Säulen, Balken, Linie, Kreis – auch in Text-Dokumente einfügbar' },
  { id: 'wheel', icon: 'wheel', title: 'Glücksrad', short: 'Glücksrad', text: 'Zufällig auswählen – auch in Text-Dokumente einfügbar' },
  { id: 'ai', icon: 'sparkle', title: 'Mit KI erstellen', short: 'Mit KI erstellen', text: 'Prompt für ChatGPT, Claude & Co. – Antwort einfügen, fertig' },
];

/** Auswahl, was in den Ordner hinzugefügt werden soll. */
function AddMenu({ onPick, onClose }: { onPick: (c: AddChoice) => void; onClose: () => void }) {
  // Kacheln mit einem Wort statt einer Liste mit Beschreibungen; die Beschreibung steht im Tooltip.
  const ai = ADD_OPTIONS.find((o) => o.id === 'ai')!;
  return (
    <Sheet
      title="Hinzufügen"
      onClose={onClose}
      footer={
        <button className="btn ghost grow add-ai-btn" onClick={() => onPick('ai')} title={ai.text}>
          <Icon name="sparkle" size={20} /> {ai.short}
        </button>
      }
    >
      <div className="add-grid">
        {ADD_OPTIONS.filter((o) => o.id !== 'ai' && (!o.touchOnly || isTouchDevice)).map((o) => (
          <button key={o.id} className="add-tile" onClick={() => onPick(o.id)} title={o.text}>
            <span className={`thumb add-icon add-${o.id}`}>
              <Icon name={o.icon} size={24} />
            </span>
            {o.short}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
