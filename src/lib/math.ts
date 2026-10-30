// Formeln (LaTeX) mit KaTeX. KaTeX wird erst geladen, wenn wirklich eine Formel vorkommt.
//   $…$   Formel im Text      $$…$$   Formel in eigener Zeile      \$   normales Dollarzeichen
// Wie bei Pandoc: Nach dem öffnenden $ kein Leerzeichen, vor dem schließenden $ kein Leerzeichen
// und danach keine Ziffer – so bleibt "5$ und 10$" normaler Text.
import type katexType from 'katex';

export type Segment = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

const space = (c: string | undefined) => c === undefined || /\s/.test(c);
const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

export function parseMath(input: string): Segment[] {
  const out: Segment[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '\\' && input[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (c === '$') {
      if (input[i + 1] === '$') {
        // $$ … $$
        const end = input.indexOf('$$', i + 2);
        if (end > i + 2 && input.slice(i + 2, end).trim()) {
          flush();
          out.push({ kind: 'math', tex: input.slice(i + 2, end).trim(), display: true });
          i = end + 2;
          continue;
        }
      } else if (!space(input[i + 1])) {
        // $ … $ (in einer Zeile)
        let j = i + 1;
        let end = -1;
        while (j < input.length && input[j] !== '\n') {
          if (input[j] === '\\') {
            j += 2;
            continue;
          }
          if (input[j] === '$' && !space(input[j - 1]) && !digit(input[j + 1])) {
            end = j;
            break;
          }
          j++;
        }
        if (end > i + 1) {
          flush();
          out.push({ kind: 'math', tex: input.slice(i + 1, end), display: false });
          i = end + 1;
          continue;
        }
      }
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

export const hasMath = (s: string | undefined | null) => !!s && s.includes('$') && parseMath(s).some((p) => p.kind === 'math');

// ---------- KaTeX nachladen ----------
let katex: typeof katexType | null = null;
let loading: Promise<typeof katexType> | null = null;
const listeners = new Set<() => void>();

export const katexReady = () => katex !== null;

export function loadKatex(): Promise<typeof katexType> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    katex = m.default;
    listeners.forEach((l) => l());
    return katex;
  });
  return loading;
}

export function onKatexReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const cache = new Map<string, string>();

/** HTML einer Formel (Fehler werden rot im Text angezeigt statt zu werfen). Leerer String, solange KaTeX lädt. */
export function renderTex(tex: string, display: boolean): string {
  if (!katex) return '';
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxSize: 50,
      maxExpand: 1000,
      output: 'htmlAndMathml',
    });
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

/** Formeln in Text-Dokumenten: <span class="math" data-tex="…" data-display="1"></span> mit KaTeX füllen. */
export function renderMathIn(root: HTMLElement, editable = false) {
  const spans = root.querySelectorAll<HTMLElement>('span.math');
  if (!spans.length) return;
  if (!katex) {
    loadKatex().then(() => renderMathIn(root, editable));
    return;
  }
  spans.forEach((el) => renderMathSpan(el, editable));
}

export function renderMathSpan(el: HTMLElement, editable = false) {
  const tex = el.dataset.tex ?? '';
  el.innerHTML = tex.trim() ? renderTex(tex, el.dataset.display === '1') : '';
  if (editable) el.setAttribute('contenteditable', 'false');
}
