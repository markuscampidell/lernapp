import { useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { FolderPicker } from '../../components/FolderPicker';

export function FileEditorSheet({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { folders, updateFile, deleteFile, deleteProblem, moveProblem } = useLibrary();
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description ?? '');
  const [folderId, setFolderId] = useState(file.folderId);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canDelete = !deleteProblem([], [file.id]);

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };
  const save = () => attempt(() => updateFile(file, { name, description, folderId }));
  const remove = () => confirm(`„${file.name}“ löschen?`) && attempt(() => deleteFile(file.id));

  return (
    <>
      <Sheet
        title="Datei bearbeiten"
        onClose={onClose}
        footer={
          <>
            {canDelete && (
              <button className="btn ghost danger" onClick={remove} disabled={busy}>
                Löschen
              </button>
            )}
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
        {err && <p className="notice critical">{err}</p>}
      </Sheet>
      {picking && (
        <FolderPicker
          title="Verschieben nach"
          startId={folderId}
          isDisabled={(id) => id !== file.folderId && !!moveProblem([], [file.id], id)}
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
