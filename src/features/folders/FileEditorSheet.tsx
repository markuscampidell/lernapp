import { useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { FolderPicker } from '../../components/FolderPicker';

export function FileEditorSheet({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { folders, updateFile, deleteFile } = useLibrary();
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description ?? '');
  const [folderId, setFolderId] = useState(file.folderId);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await updateFile(file, { name, description, folderId });
    onClose();
  };
  const remove = async () => {
    if (!confirm(`„${file.name}“ löschen?`)) return;
    setBusy(true);
    await deleteFile(file.id);
    onClose();
  };

  return (
    <>
      <Sheet
        title="Datei bearbeiten"
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost danger" onClick={remove} disabled={busy}>
              Löschen
            </button>
            <button className="btn primary grow" disabled={!name.trim() || busy} onClick={save}>
              Speichern
            </button>
          </>
        }
      >
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <div className="input-row">
            <TextLine value={name} onChange={setName} maxLength={200} enterKeyHint="done" onEnter={() => name.trim() && save()} />
            {file.ext && <span className="unit">.{file.ext}</span>}
          </div>
        </div>
        <div className="field">
          <div className="field-label">
            <span>Beschreibung</span>
            <span className="muted small">optional</span>
          </div>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </div>
        <div className="field">
          <div className="field-label">
            <span>Ordner</span>
          </div>
          <button className="card card-btn row-card" onClick={() => setPicking(true)}>
            <Icon name="folder" />
            <div className="card-main">
              <span className="ellipsis">{pathOf(folders, folderId).map((p) => p.name).join(' / ')}</span>
            </div>
            <span className="link">Verschieben</span>
          </button>
        </div>
      </Sheet>
      {picking && (
        <FolderPicker
          title="Verschieben nach"
          startId={folderId}
          onPick={(id) => {
            if (id) setFolderId(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
