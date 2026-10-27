import { useState } from 'react';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { TextLine } from '../../components/TextLine';

/** Schnell eine Textnotiz als .txt-Datei im Ordner anlegen. */
export function NoteSheet({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { addFiles } = useLibrary();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
