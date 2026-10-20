import { useEffect, useRef, useState } from 'react';
import { pathOf } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { db } from '../../storage/db';
import { openFolder } from '../../lib/router';
import { Icon } from '../../components/Icon';
import { DOCUMENT_ACCEPT, isTouchDevice } from '../../lib/files';
import { FileStager, stage, type StagedFile } from '../../components/FileStager';
import { FolderPicker } from '../../components/FolderPicker';
import { FolderThumb } from '../../components/Thumbs';

const LAST_TARGET = 'lernapp/last-upload-folder';

export function UploadView() {
  const { folders, addFiles } = useLibrary();
  const [items, setItems] = useState<StagedFile[]>([]);
  const [inboxIds, setInboxIds] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_TARGET);
    } catch {
      return null;
    }
  });
  const [picking, setPicking] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ count: number; folderId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const pickInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const folder = target ? folders.find((f) => f.id === target) : undefined;
  const busy = done !== null;

  // Per "Teilen" angekommene Dateien übernehmen.
  useEffect(() => {
    db.inbox()
      .then((inbox) => {
        if (!inbox.length) return;
        const sorted = inbox.sort((a, b) => a.addedAt - b.addedAt);
        setItems((prev) => [...prev, ...stage(sorted.map((i) => (i.file instanceof File ? i.file : new File([i.file], i.name, { type: i.type }))))]);
        setInboxIds(sorted.map((i) => i.id));
      })
      .catch(() => {});
  }, []);

  const add = (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    setSaved(null);
    setItems((prev) => [...prev, ...stage(list)]);
  };

  const save = async () => {
    if (!folder) return;
    setDone(0);
    setErr(null);
    try {
      await addFiles(
        folder.id,
        items.map((i) => ({ file: i.file, filename: i.file.name, name: i.name, description: i.description })),
        setDone,
      );
      if (inboxIds.length) await db.removeInbox(inboxIds).catch(() => {});
      setInboxIds([]);
      setSaved({ count: items.length, folderId: folder.id });
      setItems([]);
      try {
        localStorage.setItem(LAST_TARGET, folder.id);
      } catch {
        /* egal */
      }
    } catch (e) {
      console.error(e);
      setErr('Speichern fehlgeschlagen – evtl. ist der Gerätespeicher voll.');
    } finally {
      setDone(null);
    }
  };

  const clear = async () => {
    setItems([]);
    if (inboxIds.length) await db.removeInbox(inboxIds).catch(() => {});
    setInboxIds([]);
  };

  return (
    <section className="view">
      <header className="view-header">
        <h1>Hochladen</h1>
      </header>

      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={30} />
        <p className="empty-title">Dateien von deinem Gerät hinzufügen</p>
        <p className="muted small">Texte, Bilder, PDFs, Präsentationen, Videos, Audio … – jede Art von Datei.</p>
        <div className="input-row center wrap">
          <button className="btn primary" onClick={() => pickInput.current?.click()} disabled={busy}>
            <Icon name="file" size={18} /> {isTouchDevice ? 'Dateien' : 'Dateien auswählen'}
          </button>
          <button className="btn ghost" onClick={() => cameraInput.current?.click()} disabled={busy}>
            <Icon name="camera" size={18} /> Foto aufnehmen
          </button>
          <button className="btn ghost" onClick={() => videoInput.current?.click()} disabled={busy}>
            <Icon name="video" size={18} /> Video aufnehmen
          </button>
        </div>
        <input ref={pickInput} type="file" multiple accept={DOCUMENT_ACCEPT} hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
        <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      </div>

      {saved && (
        <div className="notice good">
          <span className="grow">
            {saved.count} Datei{saved.count === 1 ? '' : 'en'} gespeichert.
          </span>
          <button className="link" onClick={() => openFolder(saved.folderId)}>
            Ordner öffnen
          </button>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="section-title">
            <h3>
              {items.length} Datei{items.length === 1 ? '' : 'en'} ausgewählt
              {inboxIds.length > 0 && <span className="muted small"> · per Teilen empfangen</span>}
            </h3>
            <button className="link" onClick={clear} disabled={busy}>
              Alle entfernen
            </button>
          </div>
          <FileStager items={items} onChange={setItems} disabled={busy} />

          <h3 className="section-title">Zielordner</h3>
          <button className="card card-btn row-card" onClick={() => setPicking(true)} disabled={busy}>
            {folder ? <FolderThumb folder={folder} /> : <span className="thumb folder-thumb"><Icon name="folder" size={22} /></span>}
            <div className="card-main">
              {folder ? (
                <>
                  <strong className="ellipsis">{folder.name}</strong>
                  {folder.parentId && (
                    <span className="muted small ellipsis">{pathOf(folders, folder.parentId).map((p) => p.name).join(' / ')}</span>
                  )}
                </>
              ) : (
                <strong>Ordner wählen …</strong>
              )}
            </div>
            <Icon name="chevron" />
          </button>

          {err && <p className="notice critical">{err}</p>}

          <button className="btn primary block" disabled={!folder || busy || items.some((i) => !i.name.trim())} onClick={save}>
            {busy ? `Speichert … ${done}/${items.length}` : folder ? `In „${folder.name}“ speichern` : 'Zuerst einen Ordner wählen'}
          </button>
        </>
      )}

      {items.length === 0 && !saved && (
        <p className="muted small center-text">
          Tipp: In der installierten App auf Android kannst du Dateien auch aus anderen Apps über <strong>Teilen → Lernapp</strong> hierher schicken.
        </p>
      )}

      {picking && (
        <FolderPicker
          title="Zielordner wählen"
          startId={folder?.parentId ?? null}
          onPick={(id) => {
            setTarget(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
