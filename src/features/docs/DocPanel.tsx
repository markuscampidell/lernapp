import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { sanitizeHtml } from './sanitize';
import { DocEditor } from './DocEditor';
import { renderMathIn } from '../../lib/math';

/** Anzeige eines Text-Dokuments (bereinigtes HTML) mit Bearbeiten-Knopf. */
export function DocPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const html = useMemo(() => sanitizeHtml(text), [text]);
  const [editing, setEditing] = useState(false);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (article.current) renderMathIn(article.current);
  }, [html]);
  const editable = canModify(file) && (!file.shareId || online);
  return (
    <div className="doc-panel">
      {editable && (
        <div className="doc-panel-actions">
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        </div>
      )}
      <article ref={article} className="doc-content card" dangerouslySetInnerHTML={{ __html: html || '<p class="muted">(leer)</p>' }} />
      {editing && <DocEditor file={file} initial={text} onClose={() => setEditing(false)} />}
    </div>
  );
}
