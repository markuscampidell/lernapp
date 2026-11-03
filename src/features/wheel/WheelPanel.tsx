import { useMemo, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { useEmbedCopy } from '../docs/embeds';
import { WheelEditor } from './WheelEditor';
import { WheelSpinner } from './WheelSpinner';
import { parseWheel } from './wheel';

/** Ansicht einer Glücksrad-Datei: drehen, kopieren (zum Einfügen in Text-Dokumente), bearbeiten. */
export function WheelPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const wheel = useMemo(() => parseWheel(text), [text]);
  const embed = useMemo(() => ({ kind: 'wheel' as const, data: wheel }), [wheel]);
  const copy = useEmbedCopy(embed);
  const [editing, setEditing] = useState(false);
  const editable = canModify(file) && (!file.shareId || online);

  return (
    <div className="doc-panel chart-panel">
      <div className="doc-panel-actions">
        <button className="btn ghost" onClick={copy.run} disabled={!copy.prepared}>
          <Icon name={copy.done ? 'check' : 'copy'} size={18} /> {copy.done ? 'Kopiert' : 'Kopieren'}
        </button>
        {editable && (
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        )}
      </div>
      {copy.done && <p className="notice info">Kopiert – in einem Text-Dokument einfügen (Strg+V bzw. lange tippen → Einfügen) oder dort über das Glücksrad-Symbol in der Leiste.</p>}
      <div className="card chart-preview">
        <WheelSpinner wheel={wheel} />
      </div>
      {editing && <WheelEditor file={file} initial={wheel} onClose={() => setEditing(false)} />}
    </div>
  );
}
