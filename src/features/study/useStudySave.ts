import { useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';

/** Speichert eine Lern-Datei: neu im Ordner anlegen oder Inhalt (und Namen) einer bestehenden ersetzen. */
export function useStudySave(opts: { file?: FileItem; folderId?: string; ext: string; mime: string }) {
  const { addFiles, replaceFileContent } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (name: string, blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      const title = name.trim();
      if (opts.file) await replaceFileContent(opts.file, blob, title);
      else {
        const filename = `${title}.${opts.ext}`;
        await addFiles(opts.folderId!, [{ file: new File([blob], filename, { type: opts.mime }), filename, name: title }]);
      }
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, err, setErr };
}
