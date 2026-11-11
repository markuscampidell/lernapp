import { useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { TextLine } from '../../components/TextLine';
import { Icon } from '../../components/Icon';
import { DescriptionField } from '../../components/DescriptionField';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';

/** Größer als das wird eine Textdatei nicht im Editor geöffnet (sonst wird das Textfeld zäh). */
export const MAX_NOTE_EDIT = 512 * 1024;

/** Schnell eine Textnotiz als .txt-Datei im Ordner anlegen. */
export function NoteSheet({ folderId, initialName, initialDescription, initialText, onClose }: { folderId: string; initialName?: string; initialDescription?: string; initialText?: string; onClose: () => void }) {
  const { addFiles } = useLibrary();
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [text, setText] = useState(initialText ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Versehentlich danebengetippt oder Zurück gedrückt: Geschriebenes nicht kommentarlos wegwerfen.
  const dirty = text.trim() !== (initialText ?? '').trim() || name.trim() !== (initialName ?? '').trim();
  const close = () => {
    if (dirty && !busy && !confirm('Notiz verwerfen?')) return;
    onClose();
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    const title = name.trim() || 'Notiz';
    const file = new File([text], `${title}.txt`, { type: 'text/plain' });
    try {
      await addFiles(folderId, [{ file, filename: file.name, name: title, description }]);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Neue Notiz"
      onClose={close}
      footer={
        <button className="btn primary grow" disabled={!text.trim() || busy} onClick={save}>
          Speichern
        </button>
      }
    >
      <div className="field">
        <div className="field-label">
          <span>Name</span>
        </div>
        <TextLine autoFocus value={name} onChange={setName} placeholder="z. B. Zusammenfassung Kapitel 2" enterKeyHint="next" />
      </div>
      <div className="field">
        <div className="field-label">
          <span>Beschreibung</span>
          <span className="muted small">optional</span>
        </div>
        <TextLine value={description} onChange={setDescription} enterKeyHint="next" />
      </div>
      <div className="field">
        <div className="field-label">
          <span>Text</span>
        </div>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}

/** Bestehende Notiz (Textdatei) bearbeiten. */
export function NoteEditor({ file, initial, onClose }: { file: FileItem; initial: string; onClose: () => void }) {
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description ?? '');
  const [text, setText] = useState(initial);
  const start = useRef(JSON.stringify({ name, description, text }));
  const { save, busy, err, setErr } = useStudySave({ file, ext: file.ext || 'txt', mime: file.mime || 'text/plain' });
  const dirty = JSON.stringify({ name, description, text }) !== start.current;

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib der Notiz einen Namen.');
    if (await save(name, new Blob([text], { type: file.mime || 'text/plain' }), description)) onClose();
  };

  return (
    <StudyScreen
      editing={file}
      title="Notiz bearbeiten"
      onClose={close}
      actions={
        <>
          <DetailsButton file={file} onRenamed={setName} onDeleted={onClose} />
          <button className="btn primary small" onClick={submit} disabled={busy}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="study-form">
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <TextLine value={name} onChange={setName} placeholder="z. B. Zusammenfassung Kapitel 2" maxLength={120} />
        </div>
        <DescriptionField value={description} onChange={setDescription} />
        <div className="field">
          <div className="field-label">
            <span>Text</span>
          </div>
          <textarea className="note-text" rows={16} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}

/** Ansicht einer Textdatei – mit "Bearbeiten", wenn man sie ändern darf. */
export function NotePanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const [edit, setEdit] = useState(false);
  const editable = canModify(file) && (!file.shareId || online) && file.size <= MAX_NOTE_EDIT;
  return (
    <>
      {editable && (
        <div className="note-actions">
          <button className="btn ghost" onClick={() => setEdit(true)}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        </div>
      )}
      <pre className="viewer-text">{text}</pre>
      {edit && <NoteEditor file={file} initial={text} onClose={() => setEdit(false)} />}
    </>
  );
}
