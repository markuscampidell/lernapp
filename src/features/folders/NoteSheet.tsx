import { useState } from 'react';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';

/** Schnell eine Textnotiz als .txt-Datei im Ordner anlegen. */
export function NoteSheet({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { addFiles } = useLibrary();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const title = name.trim() || 'Notiz';
    const file = new File([text], `${title}.txt`, { type: 'text/plain' });
    await addFiles(folderId, [{ file, filename: file.name, name: title, description }]);
    onClose();
  };

  return (
    <Sheet
      title="Neue Notiz"
      onClose={onClose}
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
        <input autoFocus autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Zusammenfassung Kapitel 2" />
      </div>
      <div className="field">
        <div className="field-label">
          <span>Beschreibung</span>
          <span className="muted small">optional</span>
        </div>
        <input autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <div className="field-label">
          <span>Text</span>
        </div>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </Sheet>
  );
}
