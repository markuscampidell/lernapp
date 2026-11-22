import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { contentInfo } from '../../cloud/remote';
import { afterBack, navigate } from '../../lib/router';
import { Sheet } from '../../components/Sheet';
import { deleteDraft, loadDrafts, parkDraft, type Draft } from '../../storage/drafts';
import { baseOf } from './useDraft';
import { DocEditor } from '../docs/DocEditor';
import { NoteEditor, NoteSheet } from '../folders/NoteSheet';
import { CardsEditor } from '../study/CardsEditor';
import { QuizEditor } from '../study/QuizEditor';
import { GapsEditor } from '../gaps/GapsEditor';
import { ChartEditor } from '../charts/ChartEditor';
import { WheelEditor } from '../wheel/WheelEditor';
import type { Card, Question } from '../study/format';
import type { GapsDoc } from '../gaps/gaps';
import type { Chart } from '../charts/chart';
import type { Wheel } from '../wheel/wheel';

// Von überall (z. B. Leiste in der Datei-Ansicht): Entwurf im passenden Editor öffnen.
let openFn: ((d: Draft) => void) | null = null;
export const openDraft = (d: Draft) => openFn?.(d);

/** Wer die Datei nach meinem Entwurf gespeichert hat – oder null, wenn niemand. */
async function changedBy(d: Draft, file: FileItem, me: string | undefined, userName: (id: string | null | undefined) => string, online: boolean) {
  if (!d.base) return null;
  if (file.shareId && online) {
    const now = await contentInfo(file.id).catch(() => null);
    if (!now || now.blobPath === d.base) return null;
    return now.updatedBy === me ? 'self' : userName(now.updatedBy);
  }
  return baseOf(file) === d.base ? null : 'self';
}

/** „Annas“, aber „Max’“ (Namen auf s, x, z, ß). */
const genitive = (name: string) => (/[sxzß]$/i.test(name) ? `${name}’` : `${name}s`);

type Ask =
  | { kind: 'conflict'; draft: Draft; file: FileItem; who: string }
  | { kind: 'gone'; draft: Draft; asNew: boolean };

/**
 * Entwürfe nach Neuladen/Absturz: beim Start den letzten ungespeicherten Stand gleich wieder im Editor öffnen.
 * Hat inzwischen jemand anderes gespeichert, erst fragen (ansehen / meine weiter bearbeiten / meine verwerfen).
 */
export function DraftHost() {
  const lib = useLibrary();
  const { ready, files, folders } = lib;
  const [open, setOpen] = useState<{ draft: Draft; asNew?: boolean } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const queue = useRef<Draft[]>([]);
  const started = useRef(false);
  const libRef = useRef(lib);
  libRef.current = lib;

  const show = async (d: Draft) => {
    const { files, folders, me, userName, online } = libRef.current;
    const file = d.fileId ? files.find((f) => f.id === d.fileId) : undefined;
    if (d.fileId && !file) {
      // Datei inzwischen gelöscht: als neue Datei im selben Ordner anbieten (falls es den noch gibt).
      setAsk({ kind: 'gone', draft: d, asNew: !!d.folderId && folders.some((f) => f.id === d.folderId) });
      return;
    }
    if (!d.fileId && !folders.some((f) => f.id === d.folderId)) {
      setAsk({ kind: 'gone', draft: d, asNew: false });
      return;
    }
    if (file) {
      const who = await changedBy(d, file, me?.id, userName, online);
      if (who) {
        setAsk({ kind: 'conflict', draft: d, file, who });
        return;
      }
    }
    setOpen({ draft: d });
  };
  // Erst wenn ein Dialog/Editor ganz geschlossen ist (Zurück-Verlauf), den nächsten öffnen.
  const next = () => {
    const d = queue.current.shift();
    if (d) afterBack(() => void show(d));
  };

  useEffect(() => {
    openFn = (d) => {
      setAsk(null);
      setOpen({ draft: { ...d, chosen: true } });
    };
    return () => {
      openFn = null;
    };
  }, []);

  // Einmal nach dem Laden: nicht „wartende“ Entwürfe der Reihe nach wiederherstellen (neueste zuerst).
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void loadDrafts().then((list) => {
      queue.current = list.filter((d) => !d.parked);
      next();
    });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeEditor = () => {
    setOpen(null);
    next();
  };

  const who = (a: Extract<Ask, { kind: 'conflict' }>) => (a.who === 'self' ? 'Du hast' : `${a.who} hat`);

  return (
    <>
      {ask?.kind === 'conflict' && (
        <Sheet title="Ungespeicherte Änderungen" onClose={() => (void parkDraft(ask.draft.key), setAsk(null), next())}>
          <p>
            <strong>
              {who(ask)} „{ask.file.name}“ {ask.who === 'self' ? 'auf einem anderen Gerät ' : ''}geändert, nachdem du angefangen hast.
            </strong>
          </p>
          <p className="muted small">Deine Änderungen sind noch auf diesem Gerät gespeichert.</p>
          <div className="footer-stack">
            <button
              className="btn ghost"
              onClick={() => {
                const a = ask;
                void parkDraft(a.draft.key);
                setAsk(null);
                afterBack(() => navigate(`#ordner/${encodeURIComponent(a.file.folderId)}/${encodeURIComponent(a.file.id)}`));
                next();
              }}
            >
              {ask.who === 'self' ? 'Gespeicherte Version ansehen' : `${genitive(ask.who)} Version ansehen`}
            </button>
            <button className="btn primary" onClick={() => { const d = ask.draft; setAsk(null); afterBack(() => setOpen({ draft: { ...d, chosen: true } })); }}>
              Meine weiter bearbeiten
            </button>
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirm('Deine Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.')) return;
                void deleteDraft(ask.draft.key);
                setAsk(null);
                next();
              }}
            >
              Meine verwerfen
            </button>
          </div>
        </Sheet>
      )}
      {ask?.kind === 'gone' && (
        <Sheet title="Ungespeicherte Änderungen" onClose={() => (void parkDraft(ask.draft.key), setAsk(null), next())}>
          <p>
            <strong>„{ask.draft.name || 'Ohne Namen'}“</strong>{' '}
            {ask.asNew ? 'wurde inzwischen gelöscht. Du kannst deine Änderungen als neue Datei im selben Ordner speichern.' : 'gibt es nicht mehr – auch der Ordner wurde gelöscht.'}
          </p>
          <div className="footer-stack">
            {ask.asNew && (
              <button className="btn primary" onClick={() => { const d = ask.draft; setAsk(null); afterBack(() => setOpen({ draft: { ...d, chosen: true }, asNew: true })); }}>
                Als neue Datei öffnen
              </button>
            )}
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirm('Deine Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.')) return;
                void deleteDraft(ask.draft.key);
                setAsk(null);
                next();
              }}
            >
              Verwerfen
            </button>
          </div>
        </Sheet>
      )}
      {open && <DraftEditor draft={open.draft} asNew={!!open.asNew} files={files} folders={folders.map((f) => f.id)} onClose={closeEditor} />}
    </>
  );
}

/** Den passenden Editor mit dem Entwurf öffnen. */
function DraftEditor({ draft: d, asNew, files, folders, onClose }: { draft: Draft; asNew: boolean; files: FileItem[]; folders: string[]; onClose: () => void }) {
  const file = !asNew && d.fileId ? files.find((f) => f.id === d.fileId) : undefined;
  const folderId = file ? undefined : d.folderId;
  if (!file && (!folderId || !folders.includes(folderId))) return null;
  const common = { file, folderId, initialName: d.name, initialDescription: d.description, restore: d, onClose };
  switch (d.kind) {
    case 'doc':
      return <DocEditor {...common} initial={d.data as string} mode={d.mode} />;
    case 'note':
      return file ? (
        <NoteEditor file={file} initial={d.data as string} initialName={d.name} initialDescription={d.description} restore={d} onClose={onClose} />
      ) : (
        <NoteSheet folderId={folderId!} initialName={d.name} initialDescription={d.description} initialText={d.data as string} restore={d} onClose={onClose} />
      );
    case 'cards':
      return <CardsEditor {...common} initial={d.data as Card[]} />;
    case 'quiz':
      return <QuizEditor {...common} initial={d.data as Question[]} />;
    case 'gaps':
      return <GapsEditor {...common} initial={d.data as GapsDoc} />;
    case 'chart':
      return <ChartEditor {...common} initial={d.data as Chart} />;
    case 'wheel':
      return <WheelEditor {...common} initial={d.data as Wheel} />;
  }
}
