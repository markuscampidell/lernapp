import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { FileEditorSheet } from '../folders/FileEditorSheet';

/** ⓘ in Editoren: Details der Datei (Name, Beschreibung, Ort, Rechte, Löschen) öffnen. */
export function DetailsButton({ file, onRenamed, onDeleted }: { file: FileItem; onRenamed: (name: string) => void; onDeleted: () => void }) {
  const { files } = useLibrary();
  const [open, setOpen] = useState(false);
  const current = files.find((f) => f.id === file.id) ?? file;

  // Umbenennen in den Details in den Editor übernehmen, damit "Speichern" den Namen nicht zurücksetzt.
  const lastName = useRef(current.name);
  useEffect(() => {
    if (current.name !== lastName.current) {
      lastName.current = current.name;
      onRenamed(current.name);
    }
  }, [current.name, onRenamed]);

  return (
    <>
      <button className="icon-btn" aria-label="Details" title="Details" onClick={() => setOpen(true)}>
        <Icon name="info" />
      </button>
      {open && <FileEditorSheet file={current} onClose={() => setOpen(false)} onDeleted={onDeleted} />}
    </>
  );
}
