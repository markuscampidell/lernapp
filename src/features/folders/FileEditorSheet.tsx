import { useState } from 'react';
import type { Access, FileItem } from '../../domain/types';
import { AccessPicker } from '../share/AccessPicker';
import { DetailsLockNotice, useDetailsLock } from '../../cloud/editing';
import { pathOf } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { FolderPicker } from '../../components/FolderPicker';
import { fileKind, formatDate, formatSize, fullName, KIND_LABEL } from '../../lib/files';

/**
 * Details einer Datei (ⓘ): Name, Beschreibung, Ort, Rechte, Löschen.
 * Wer die Datei nicht ändern darf, sieht alles nur zum Lesen.
 */
export function FileEditorSheet({ file, onClose, onDeleted }: { file: FileItem; onClose: () => void; onDeleted?: () => void }) {
  const { folders, updateFile, deleteFile, deleteProblem, moveProblem, setAccess, canModify, canSetAccess, online, me, userName } = useLibrary();
  const [access, setAccessValue] = useState<Access | null>(file.access ?? null);
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description ?? '');
  const [folderId, setFolderId] = useState(file.folderId);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Nur eine Person gleichzeitig bearbeitet die Details einer geteilten Datei.
  const lock = useDetailsLock(file, (canModify(file) || canSetAccess(file)) && online);
  const editable = canModify(file) && (!file.shareId || online) && !lock.locked;
  const canDelete = !deleteProblem([], [file.id]) && !lock.locked;
  const showSave = (editable || (canSetAccess(file) && online)) && !lock.locked;
  const kind = fileKind(file);

  const attempt = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onClose();
      after?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };
  const save = () =>
    attempt(async () => {
      if (file.shareId && access !== (file.access ?? null)) await setAccess(file, access);
      if (editable) await updateFile(file, { name, description, folderId });
    });
  const remove = () => confirm(`„${fullName(file)}“ löschen?`) && attempt(() => deleteFile(file.id), onDeleted);

  return (
    <>
      <Sheet
        title="Details"
        onClose={onClose}
        footer={
          <>
            {canDelete && (
              <button className="btn ghost danger" onClick={remove} disabled={busy}>
                <Icon name="trash" size={18} /> Löschen
              </button>
            )}
            {showSave ? (
              <button className="btn primary grow" disabled={!name.trim() || busy} onClick={save}>
                Speichern
              </button>
            ) : (
              <button className="btn ghost grow" onClick={onClose}>
                Schließen
              </button>
            )}
          </>
        }
      >
        <p className="muted small details-meta">
          {KIND_LABEL[kind]} · {formatSize(file.size)} · hinzugefügt am {formatDate(file.createdAt)}
          {file.shareId && ` von ${file.createdBy === me?.id ? 'dir' : userName(file.createdBy)}`}
        </p>
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <div className="input-row">
            <TextLine value={name} onChange={setName} maxLength={200} enterKeyHint="done" onEnter={() => name.trim() && editable && save()} disabled={!editable} />
            {file.ext && <span className="unit">.{file.ext}</span>}
          </div>
        </div>
        <div className="field">
          <div className="field-label">
            <span>Beschreibung</span>
            {editable && <span className="muted small">optional</span>}
          </div>
          {editable ? (
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          ) : (
            <p className="pre-wrap">{description || <span className="muted">Keine Beschreibung</span>}</p>
          )}
        </div>
        <div className="field">
          <div className="field-label">
            <span>Ordner</span>
          </div>
          <button className="card card-btn row-card" onClick={() => setPicking(true)} disabled={!editable}>
            <Icon name="folder" />
            <div className="card-main">
              <span className="ellipsis">{pathOf(folders, folderId).map((p) => p.name).join(' / ')}</span>
            </div>
            {editable && <span className="link">Verschieben</span>}
          </button>
        </div>
        {file.shareId && <AccessPicker item={file} value={access} onChange={setAccessValue} disabled={lock.locked} />}
        <DetailsLockNotice {...lock} noun="dieser Datei" />
        {!editable && file.shareId && !lock.locked && (
          <p className="muted small">{online ? 'Du darfst diese Datei nur ansehen.' : 'Offline – Änderungen sind gerade nicht möglich.'}</p>
        )}
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
