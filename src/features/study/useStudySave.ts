import { useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { contentInfo } from '../../cloud/remote';
import { isRemoteBlob, remotePath } from '../../storage/blobs';

/** Speichert eine Lern-Datei: neu im Ordner anlegen oder Inhalt (und Namen) einer bestehenden ersetzen. */
export function useStudySave(opts: {
  file?: FileItem;
  folderId?: string;
  ext: string;
  mime: string;
  /** Wiederhergestellter Entwurf: Stand, von dem aus damals bearbeitet wurde. */
  base?: string | null;
  /** Hat inzwischen jemand anderes gespeichert, wird gefragt, ob man dessen Änderungen ersetzen will (statt abzulehnen). */
  askOverwrite?: boolean;
}) {
  const { addFiles, replaceFileContent, updateFile, userName, me } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Stand des Inhalts beim Öffnen – hat ihn inzwischen jemand anderes ersetzt, wird vor dem Überschreiben gewarnt.
  const base = useRef(opts.base !== undefined ? opts.base : opts.file && isRemoteBlob(opts.file.blobId) ? remotePath(opts.file.blobId) : null);

  /** description = Beschreibung (undefined = unverändert lassen). */
  const save = async (name: string, blob: Blob, description?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const title = name.trim();
      if (opts.file) {
        if (opts.file.shareId && base.current) {
          const now = await contentInfo(opts.file.id).catch(() => null);
          if (now && now.blobPath !== base.current && opts.askOverwrite) {
            const other = now.updatedBy === me?.id ? 'die Änderungen, die du auf einem anderen Gerät gespeichert hast' : `die Änderungen von ${userName(now.updatedBy)}`;
            if (!confirm(`Damit ersetzt du ${other}. Fortfahren?`)) return false;
          } else if (now && now.blobPath !== base.current) {
            const who = now.updatedBy === me?.id ? 'Du hast' : `${userName(now.updatedBy)} hat`;
            setErr(
              `Nicht gespeichert: ${who} diese Datei inzwischen gespeichert. Damit nichts verloren geht, kannst du nicht darüber speichern. ` +
                'Kopiere deine Änderungen, schließe den Editor und öffne die Datei neu.',
            );
            return false;
          }
        }
        await replaceFileContent(opts.file, blob, title);
        if (description !== undefined && description.trim() !== (opts.file.description ?? '').trim())
          await updateFile({ ...opts.file, name: title }, { description: description.trim() });
        if (opts.file.shareId) base.current = (await contentInfo(opts.file.id).catch(() => null))?.blobPath ?? base.current;
      } else {
        const filename = `${title}.${opts.ext}`;
        await addFiles(opts.folderId!, [{ file: new File([blob], filename, { type: opts.mime }), filename, name: title, description: description?.trim() || undefined }]);
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
