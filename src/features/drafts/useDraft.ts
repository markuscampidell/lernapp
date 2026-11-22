import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { isRemoteBlob, remotePath } from '../../storage/blobs';
import { deleteDraft, draftKey, findDraft, parkDraft, putDraft, useDrafts, type Draft, type DraftKind } from '../../storage/drafts';

/** Stand einer Datei, von dem aus bearbeitet wird (zum Erkennen, ob jemand anderes inzwischen gespeichert hat). */
export const baseOf = (file: FileItem) => (isRemoteBlob(file.blobId) ? remotePath(file.blobId) : file.blobId);

const EVERY = 3000;

/**
 * Hält ungespeicherte Änderungen eines Editors als Entwurf auf diesem Gerät fest (alle paar Sekunden, beim Wegwechseln
 * und vor dem Neuladen). Zurück kommen: `saved()` nach erfolgreichem Speichern, `discard()` beim Verwerfen – beides löscht
 * den Entwurf. Wird der Editor anders geschlossen (z. B. weil jemand anderes die Datei gerade bearbeitet), wartet der
 * Entwurf und lässt sich später in der Datei-Ansicht wieder öffnen.
 */
export function useDraft(opts: {
  kind: DraftKind;
  file?: FileItem;
  folderId?: string;
  mode?: 'edit' | 'draw';
  /** Wiederhergestellter Entwurf (dann gilt der Editor sofort als geändert). */
  restore?: Draft;
  dirty: boolean;
  snapshot: () => { name: string; description: string; data: unknown };
}) {
  const key = opts.restore?.key ?? draftKey(opts.file?.id, opts.folderId, opts.kind);
  const base = useRef(opts.restore ? opts.restore.base ?? null : opts.file ? baseOf(opts.file) : null);
  const last = useRef<string | null>(opts.restore ? JSON.stringify({ name: opts.restore.name, description: opts.restore.description, data: opts.restore.data }) : null);
  const done = useRef(false);
  const latest = useRef(opts);
  latest.current = opts;

  // Ohne Datei und ohne Ordner (z. B. Diagramm direkt in einem Text-Dokument): kein eigener Entwurf –
  // das Dokument hat seinen eigenen.
  // Gibt es für diese Datei schon einen wartenden Entwurf (und dieser Editor wurde normal geöffnet), bleibt der unangetastet –
  // er lässt sich über die Leiste in der Datei-Ansicht weiter bearbeiten.
  const [waitingAtStart] = useState(() => !opts.restore && !!(opts.file || opts.folderId) && !!findDraft(key));
  // Der wartende Entwurf (solange es ihn gibt) – der Editor zeigt dann oben einen Hinweis, um ihn zu laden.
  // Wird er verworfen, sichert dieser Editor ab dann seine eigenen Änderungen.
  const drafts = useDrafts();
  const released = useRef(!waitingAtStart);
  const waiting = released.current ? undefined : drafts.find((d) => d.key === key);
  // Einmal weg (verworfen), bleibt er weg – später gespeicherte Entwürfe sind die dieses Editors.
  if (!waiting) released.current = true;
  const offRef = useRef(false);
  offRef.current = (!opts.file && !opts.folderId && !opts.restore) || !!waiting;

  const flush = () => {
    if (done.current || offRef.current) return;
    const o = latest.current;
    if (!o.dirty) {
      // Alles zurückgenommen: kein Entwurf nötig.
      if (last.current !== null && !o.restore) {
        last.current = null;
        void deleteDraft(key);
      }
      return;
    }
    let snap: { name: string; description: string; data: unknown };
    try {
      snap = o.snapshot();
    } catch {
      return;
    }
    const json = JSON.stringify(snap);
    if (json === last.current) return;
    last.current = json;
    void putDraft({
      key,
      kind: o.kind,
      fileId: o.file?.id,
      folderId: o.folderId ?? o.file?.folderId ?? o.restore?.folderId,
      base: base.current,
      name: snap.name,
      description: snap.description,
      data: snap.data,
      mode: o.mode,
      savedAt: Date.now(),
    });
  };

  useEffect(() => {
    const id = window.setInterval(flush, EVERY);
    const onHide = () => document.visibilityState === 'hidden' && flush();
    const onLeave = (e: BeforeUnloadEvent) => {
      flush();
      // PC: der Browser fragt „Seite wirklich verlassen?“ (Handys ignorieren das meist – dafür gibt es den Entwurf).
      if (latest.current.dirty && !done.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onLeave);
      // Anders geschlossen (nicht gespeichert, nicht verworfen): Entwurf aufheben und warten lassen.
      if (!done.current && !offRef.current && latest.current.dirty) {
        flush();
        done.current = true;
        void parkDraft(key);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    done.current = true;
    if (!offRef.current) void deleteDraft(key);
  };
  return {
    restored: !!opts.restore,
    /** Beim normalen Öffnen gab es schon ungespeicherte Änderungen von früher (noch nicht verworfen). */
    waiting,
    /** Hat der Editor gerade eigene, ungespeicherte Änderungen? */
    isDirty: () => latest.current.dirty,
    /** Nach erfolgreichem Speichern. */
    saved: finish,
    /** Änderungen verworfen. */
    discard: finish,
  };
}
