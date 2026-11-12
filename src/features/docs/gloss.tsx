// Erklärungen im Text-Dokument: markierter Text (<span class="gloss" data-gloss="…">) – antippen zeigt die Erklärung daneben.
import { useEffect } from 'react';
import { Icon } from '../../components/Icon';
import { MathText } from '../../components/MathText';

export const MAX_GLOSS = 3000;

/** Markierter Text als Klartext – Formeln wieder als $…$, damit sie im Feld richtig angezeigt werden. */
export function glossLabel(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll<HTMLElement>('span.math').forEach((m) => m.replaceWith(`$${m.dataset.tex ?? ''}$`));
  return (c.textContent ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
}

/** Seitenleiste (PC) bzw. Leiste von unten (Handy) mit der Erklärung. */
export function GlossPanel({ label, text, onClose }: { label: string; text: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="card gloss-panel" role="dialog" aria-label={`Erklärung zu „${label}“`} data-no-swipe>
      <div className="gloss-head">
        <span className="gloss-kicker muted small">
          <Icon name="explain" size={15} /> Erklärung
        </span>
        <button className="icon-btn small" aria-label="Schließen" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <strong className="gloss-term pre-wrap">
        <MathText text={label} />
      </strong>
      <div className="gloss-text pre-wrap">
        <MathText text={text} />
      </div>
    </aside>
  );
}
