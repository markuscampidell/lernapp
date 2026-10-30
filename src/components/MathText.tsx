import { useEffect, useMemo, useState } from 'react';
import { katexReady, loadKatex, onKatexReady, parseMath, renderTex } from '../lib/math';

/** Lädt KaTeX, sobald `needed` wahr ist, und rendert danach neu. */
export function useKatex(needed: boolean): boolean {
  const [ready, setReady] = useState(katexReady);
  useEffect(() => {
    if (ready) return;
    const off = onKatexReady(() => setReady(true));
    if (needed) loadKatex().catch(() => {});
    return () => {
      off();
    };
  }, [needed, ready]);
  return ready;
}

/** Text mit Formeln ($…$ und $$…$$). Zeilenumbrüche bleiben erhalten, wenn das Elternelement pre-wrap ist. */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => parseMath(text), [text]);
  const needed = parts.some((p) => p.kind === 'math');
  const ready = useKatex(needed);
  if (!needed) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        if (!ready) return <code key={i}>{p.display ? `$$${p.tex}$$` : `$${p.tex}$`}</code>;
        return <span key={i} className={p.display ? 'math-display' : 'math-inline'} dangerouslySetInnerHTML={{ __html: renderTex(p.tex, p.display) }} />;
      })}
    </>
  );
}

/** Vorschau unter Eingabefeldern – nur sichtbar, wenn der Text Formeln enthält. */
export function MathPreview({ text }: { text: string }) {
  const show = useMemo(() => parseMath(text).some((p) => p.kind === 'math'), [text]);
  if (!show) return null;
  return (
    <div className="math-preview pre-wrap" aria-label="Vorschau">
      <span className="math-preview-label">Vorschau</span>
      <MathText text={text} />
    </div>
  );
}
