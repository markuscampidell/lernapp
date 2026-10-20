import { useEffect, useRef, useState } from 'react';
import type { Folder } from '../../domain/types';
import { canMoveFolder, pathOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { useBlobUrl } from '../../hooks/useBlobUrl';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { FolderPicker } from '../../components/FolderPicker';

interface Props {
  /** Bestehender Ordner zum Bearbeiten – oder undefined für einen neuen. */
  folder?: Folder;
  /** Übergeordneter Ordner für einen neuen Ordner (null = oberste Ebene). */
  parentId?: string | null;
  onClose: () => void;
  onCreated?: (f: Folder) => void;
  onDeleted?: () => void;
}

export function FolderEditorSheet({ folder, parentId = null, onClose, onCreated, onDeleted }: Props) {
  const { folders, files, createFolder, updateFolder, deleteFolder } = useLibrary();
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(folder?.description ?? '');
  // undefined = unverändert, null = entfernt, Blob = neu gewählt
  const [image, setImage] = useState<Blob | null | undefined>(undefined);
  const [target, setTarget] = useState<string | null>(folder ? folder.parentId : parentId);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const storedUrl = useBlobUrl(image === undefined ? folder?.imageId : undefined);
  const [newUrl, setNewUrl] = useState<string>();
  useEffect(() => {
    if (!(image instanceof Blob)) return setNewUrl(undefined);
    const u = URL.createObjectURL(image);
    setNewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);
  const preview = image === null ? undefined : newUrl ?? storedUrl;

  const isSub = (folder ? folder.parentId : parentId) !== null;
  const noun = isSub ? 'Unterordner' : 'Ordner';
  const targetPath = pathOf(folders, target).map((p) => p.name).join(' / ') || 'Oberste Ebene';

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (folder) {
        await updateFolder(folder, { name, description, image, parentId: target });
        onClose();
      } else {
        const f = await createFolder(parentId, { name, description, image });
        onClose();
        onCreated?.(f);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!folder) return;
    const ids = subtreeIds(folders, folder.id);
    const subCount = ids.size - 1;
    const fileCount = files.filter((f) => ids.has(f.folderId)).length;
    const extra = [subCount > 0 && `${subCount} Unterordner`, fileCount > 0 && `${fileCount} Datei${fileCount === 1 ? '' : 'en'}`]
      .filter(Boolean)
      .join(' und ');
    if (!confirm(`„${folder.name}“ löschen?${extra ? ` Dabei werden auch ${extra} gelöscht.` : ''}`)) return;
    setBusy(true);
    await deleteFolder(folder.id);
    onClose();
    onDeleted?.();
  };

  return (
    <>
      <Sheet
        title={folder ? `${noun} bearbeiten` : `Neuer ${noun}`}
        onClose={onClose}
        footer={
          <>
            {folder && (
              <button className="btn ghost danger" onClick={remove} disabled={busy}>
                Löschen
              </button>
            )}
            <button className="btn primary grow" disabled={!name.trim() || busy} onClick={save}>
              {folder ? 'Speichern' : 'Erstellen'}
            </button>
          </>
        }
      >
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <TextLine
            autoFocus={!folder}
            value={name}
            onChange={setName}
            enterKeyHint="done"
            onEnter={() => name.trim() && save()}
            placeholder={isSub ? 'z. B. Kapitel 3' : 'z. B. Analysis 1'}
            maxLength={120}
          />
        </div>
        <div className="field">
          <div className="field-label">
            <span>Beschreibung</span>
            <span className="muted small">optional</span>
          </div>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </div>
        <div className="field">
          <div className="field-label">
            <span>Bild</span>
            <span className="muted small">optional</span>
          </div>
          <div className="image-field">
            <button className="image-pick" onClick={() => fileInput.current?.click()} aria-label="Bild wählen">
              {preview ? <img src={preview} alt="" /> : <Icon name="image" size={26} />}
            </button>
            <div className="image-actions">
              <button className="btn ghost small" onClick={() => fileInput.current?.click()}>
                {preview ? 'Anderes Bild' : 'Bild wählen'}
              </button>
              {preview && (
                <button className="btn ghost small danger" onClick={() => setImage(null)}>
                  Entfernen
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setImage(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {folder && (
          <div className="field">
            <div className="field-label">
              <span>Ort</span>
            </div>
            <button className="card card-btn row-card" onClick={() => setPicking(true)}>
              <Icon name="folder" />
              <div className="card-main">
                <span className="ellipsis">{targetPath}</span>
              </div>
              <span className="link">Verschieben</span>
            </button>
          </div>
        )}
        {err && <p className="notice critical">{err}</p>}
      </Sheet>
      {picking && folder && (
        <FolderPicker
          title="Verschieben nach"
          startId={target}
          allowRoot
          isDisabled={(id) => !canMoveFolder(folders, folder.id, id) || subtreeIds(folders, folder.id).has(id ?? '')}
          confirmLabel={(f) => (f ? `Nach „${f.name}“` : 'Auf oberste Ebene')}
          onPick={(id) => {
            setTarget(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
