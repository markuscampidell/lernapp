import type { FileItem } from '../../domain/types';
import { deleteDraft, draftKey, useDrafts } from '../../storage/drafts';
import { openDraft } from './DraftHost';

/** In der Datei-Ansicht: es gibt noch einen Entwurf (ungespeicherte Änderungen) für diese Datei. */
export function DraftBar({ file }: { file: FileItem }) {
  const key = draftKey(file.id, undefined, 'doc');
  const draft = useDrafts().find((d) => d.key === key);
  if (!draft) return null;
  return (
    <div className="notice warning draft-bar" role="status">
      <span className="grow">Du hast noch ungespeicherte Änderungen an dieser Datei.</span>
      <button className="btn primary small" onClick={() => openDraft(draft)}>
        Meine weiter bearbeiten
      </button>
      <button
        className="btn ghost small danger"
        onClick={() => confirm('Deine Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.') && void deleteDraft(key)}
      >
        Verwerfen
      </button>
    </div>
  );
}
