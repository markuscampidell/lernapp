import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { openLightbox } from '../../components/Lightbox';
import { sanitizeHtml } from './sanitize';
import { DocEditor } from './DocEditor';
import { renderMathIn } from '../../lib/math';
import { applyChecks, checkboxHit, useChecks } from './checks';
import { createRoot, type Root } from 'react-dom/client';
import { copyPrepared, embedOf, prepareEmbed, renderEmbedsIn, useEmbedCopy, type EmbedData, type Prepared } from './embeds';
import { WheelSpinner } from '../wheel/WheelSpinner';
import { parseWheel } from '../wheel/wheel';
import { PagedDoc } from './pages/PagedDoc';
import { splitDoc } from './pages/ink';
import { GlossPanel, glossLabel } from './gloss';

/** Drehbare Glücksräder im Dokument (je Figur eine React-Wurzel). */
const WHEEL_ROOTS = new WeakMap<Element, Root>();

/** Anzeige eines Text-Dokuments (bereinigtes HTML) mit Bearbeiten-Knopf, abhakbaren Checklisten und kopierbaren Diagrammen. */
export function DocPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const doc = useMemo(() => splitDoc(text), [text]);
  const html = useMemo(() => sanitizeHtml(doc.html), [doc]);
  // Bearbeiten: oben umschalten zwischen Text und Stift
  const [editing, setEditing] = useState<'edit' | null>(null);
  const article = useRef<HTMLElement>(null);
  const checks = useChecks(file);
  // Vorbereitete Kopien der Diagramme (Bild erzeugen dauert kurz – der Klick soll sofort kopieren).
  const prepared = useRef(new Map<Element, Prepared>());
  // Angetippte Erklärung (Wort/Satz im Text)
  const [gloss, setGloss] = useState<{ el: HTMLElement; label: string; text: string } | null>(null);
  const closeGloss = useCallback(() => setGloss(null), []);
  useEffect(() => {
    if (!gloss) return;
    gloss.el.classList.add('active');
    return () => gloss.el.classList.remove('active');
  }, [gloss]);
  useEffect(() => setGloss(null), [html, editing]);

  useEffect(() => {
    const el = article.current;
    if (!el) return;
    renderMathIn(el);
    // Diagramme statisch (mit Kopieren-Knopf), Glücksräder drehbar (eigene kleine React-Wurzel je Rad).
    renderEmbedsIn(el, { copyButton: true, skip: ['wheel'] });
    applyChecks(el, checks.isDone);
    const map = new Map<Element, Prepared>();
    prepared.current = map;
    el.querySelectorAll<HTMLElement>('figure.chart').forEach((fig) => {
      const e = embedOf(fig);
      if (e) prepareEmbed(e).then((p) => map.set(fig, p));
    });
    const figs = Array.from(el.querySelectorAll<HTMLElement>('figure.wheel'));
    figs.forEach((fig) => {
      const wheel = parseWheel(fig.dataset.wheel ?? '');
      let root = WHEEL_ROOTS.get(fig);
      if (!root) WHEEL_ROOTS.set(fig, (root = createRoot(fig)));
      root.render(<WheelSpinner wheel={wheel} actions={<EmbedCopyButton embed={{ kind: 'wheel', data: wheel }} />} />);
    });
    return () => {
      // Erst nach dem aktuellen Rendern abbauen – und nur Räder, die nicht mehr im Dokument stehen.
      setTimeout(() =>
        figs.forEach((fig) => {
          if (fig.isConnected) return;
          WHEEL_ROOTS.get(fig)?.unmount();
          WHEEL_ROOTS.delete(fig);
        }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  useEffect(() => {
    if (article.current) applyChecks(article.current, checks.isDone);
  }, [checks.isDone]);

  const onClick = async (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const copyBtn = t.closest?.('.chart-copy') as HTMLButtonElement | null;
    if (copyBtn) {
      const fig = copyBtn.closest('figure');
      const e = fig && embedOf(fig);
      const p = fig && e && (prepared.current.get(fig) ?? (await prepareEmbed(e)));
      if (!p) return;
      await copyPrepared(p);
      const label = copyBtn.lastChild;
      if (label) label.textContent = ' Kopiert';
      setTimeout(() => label && (label.textContent = ' Kopieren'), 2000);
      return;
    }
    const g = t.closest?.('span.gloss') as HTMLElement | null;
    if (g) {
      e.preventDefault();
      setGloss((old) => (old?.el === g ? null : { el: g, label: glossLabel(g), text: g.dataset.gloss ?? '' }));
      return;
    }
    // Bilder im Dokument groß anzeigen (nicht Diagramme/Räder)
    if (t.tagName === 'IMG' && !t.closest('figure')) {
      const im = t as HTMLImageElement;
      if (im.src) openLightbox({ src: im.src, alt: im.alt });
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
          <button className="btn primary" onClick={() => setEditing('edit')}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        </div>
      )}
      {checks.notReady && <p className="notice warning">Häkchen werden noch nicht synchronisiert: Bitte supabase/005_checklisten.sql im Supabase „SQL Editor“ ausführen.</p>}
      {/* Der Editor öffnet sich darüber (im selben Bereich) – dann gehören Zoom & Seitenanzeige ihm, nicht der Ansicht dahinter */}
      <PagedDoc pages={doc.pages} flowRef={article} controls={!editing}>
        <article ref={article} className="doc-content" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '<p><br></p>' }} />
      </PagedDoc>
      {gloss && !editing && <GlossPanel label={gloss.label} text={gloss.text} onClose={closeGloss} />}
      {editing && <DocEditor file={file} initial={text} mode={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Kopieren-Knopf für ein eingebettetes Glücksrad in der Ansicht. */
function EmbedCopyButton({ embed }: { embed: EmbedData }) {
  const stable = useMemo(() => embed, [embed.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = useEmbedCopy(stable);
  return (
    <button type="button" className="btn ghost small" onClick={copy.run} disabled={!copy.prepared}>
      <Icon name={copy.done ? 'check' : 'copy'} size={16} /> {copy.done ? 'Kopiert' : 'Kopieren'}
    </button>
  );
}
