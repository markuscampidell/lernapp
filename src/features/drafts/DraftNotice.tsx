import { deleteDraft, type Draft } from '../../storage/drafts';
import { afterBack } from '../../lib/router';
import { openDraft } from './DraftHost';

/** Im Editor nach dem Wiederherstellen: „Ungespeicherte Änderungen wiederhergestellt“ – Speichern (oben) oder Verwerfen. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="notice info draft-notice" role="status">
      <span className="grow">Ungespeicherte Änderungen wiederhergestellt – Speichern oder Verwerfen.</span>
      <button
        className="btn ghost small danger"
        onClick={() => confirm('Deine wiederhergestellten Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.') && onDiscard()}
      >
        Verwerfen
      </button>
    </div>
  );
}

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return today ? `heute um ${time}` : `am ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })} um ${time}`;
};

/**
 * Hinweise oben im Editor:
 * - wiederhergestellt → Verwerfen
 * - normal geöffnet, aber es warten noch ungespeicherte Änderungen von früher → diese laden oder verwerfen
 */
export function DraftNotices({
  draft,
  onClose,
}: {
  draft: { restored: boolean; waiting?: Draft; discard: () => void; isDirty: () => boolean };
  onClose: () => void;
}) {
  if (draft.restored) return <DraftNotice onDiscard={() => (draft.discard(), onClose())} />;
  const w = draft.waiting;
  if (!w) return null;
  return (
    <div className="notice warning draft-bar" role="status">
      <span className="grow">Du hast hier noch ungespeicherte Änderungen von {when(w.savedAt)}.</span>
      <button
        className="btn primary small"
        onClick={() => {
          if (draft.isDirty() && !confirm('Deine Änderungen in diesem Editor gehen dabei verloren. Trotzdem die älteren laden?')) return;
          onClose();
          afterBack(() => openDraft(w));
        }}
      >
        Laden
      </button>
      <button
        className="btn ghost small danger"
        onClick={() => confirm('Die älteren Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.') && void deleteDraft(w.key)}
      >
        Verwerfen
      </button>
    </div>
  );
}
