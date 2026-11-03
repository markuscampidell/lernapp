import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { sanitizeHtml } from './sanitize';
import { DocEditor } from './DocEditor';
import { renderMathIn } from '../../lib/math';
import { applyChecks, checkboxHit, useChecks } from './checks';
import { copyChart, parseChart, prepareCopy, renderChartsIn, type Prepared } from '../charts/chart';

/** Anzeige eines Text-Dokuments (bereinigtes HTML) mit Bearbeiten-Knopf, abhakbaren Checklisten und kopierbaren Diagrammen. */
export function DocPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const html = useMemo(() => sanitizeHtml(text), [text]);
  const [editing, setEditing] = useState(false);
  const article = useRef<HTMLElement>(null);
  const checks = useChecks(file);
  // Vorbereitete Kopien der Diagramme (Bild erzeugen dauert kurz – der Klick soll sofort kopieren).
  const prepared = useRef(new Map<Element, Prepared>());

  useEffect(() => {
    const el = article.current;
    if (!el) return;
    renderMathIn(el);
    renderChartsIn(el, { copyButton: true });
    applyChecks(el, checks.isDone);
    const map = new Map<Element, Prepared>();
    prepared.current = map;
    el.querySelectorAll<HTMLElement>('figure.chart').forEach((fig) => {
      prepareCopy(parseChart(fig.dataset.chart ?? '')).then((p) => map.set(fig, p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  useEffect(() => {
    if (article.current) applyChecks(article.current, checks.isDone);
  }, [checks.isDone]);

  const onClick = async (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const copyBtn = t.closest?.('.chart-copy') as HTMLButtonElement | null;
    if (copyBtn) {
      const fig = copyBtn.closest('figure.chart');
      const p = fig && (prepared.current.get(fig) ?? (await prepareCopy(parseChart((fig as HTMLElement).dataset.chart ?? ''))));
      if (!p) return;
      await copyChart(p);
      const label = copyBtn.lastChild;
      if (label) label.textContent = ' Kopiert';
      setTimeout(() => label && (label.textContent = ' Kopieren'), 2000);
      return;
    }
    // In der Ansicht hakt ein Tipp irgendwo auf den Punkt ab.
    const li = checkboxHit(e, true);
    if (li?.dataset.id) {
      e.preventDefault();
      checks.toggle(li.dataset.id, li.parentElement?.dataset.shared === '1');
    }
  };

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
      {checks.notReady && <p className="notice warning">Häkchen werden noch nicht synchronisiert: Bitte supabase/005_checklisten.sql im Supabase „SQL Editor“ ausführen.</p>}
      <article ref={article} className="doc-content card" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '<p class="muted">(leer)</p>' }} />
      {editing && <DocEditor file={file} initial={text} onClose={() => setEditing(false)} />}
    </div>
  );
}
