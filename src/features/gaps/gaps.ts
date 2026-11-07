// Lückentext: eigene Lern-Datei (JSON). Lücken stehen im Text als [[Wort]] bzw. [[Wort|Alternative|…]].
import { newId } from '../../lib/id';

export const GAPS_EXT = 'lueckentext';
export const GAPS_MIME = 'application/vnd.lernapp.lueckentext+json';
export const MAX_TEXT = 20_000;
export const MAX_DISTRACTORS = 30;

export type GapMode = 'drag' | 'type';

export interface GapsDoc {
  type: 'lernapp-lueckentext';
  version: 1;
  /** Text mit Lücken: „Die [[Mitose]] hat vier Phasen.“ */
  text: string;
  /** Zusätzliche falsche Wörter für „Wörter einsetzen“ */
  distractors: string[];
  /** Vorgeschlagener Modus beim Lernen */
  mode: GapMode;
  /** Kleine Tippfehler beim Selbst-Schreiben als richtig werten */
  typos: boolean;
}

export type Segment = { kind: 'text'; text: string } | { kind: 'gap'; id: string; answers: string[] };

export const emptyGaps = (): GapsDoc => ({ type: 'lernapp-lueckentext', version: 1, text: '', distractors: [], mode: 'drag', typos: true });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseGapsDoc(input: string | unknown): GapsDoc {
  let raw: Record<string, unknown> = {};
  try {
    raw = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') raw = {};
  } catch {
    /* leer */
  }
  return {
    type: 'lernapp-lueckentext',
    version: 1,
    text: str(raw.text, MAX_TEXT),
    distractors: (Array.isArray(raw.distractors) ? raw.distractors : [])
      .map((d) => str(d, 80).trim())
      .filter(Boolean)
      .slice(0, MAX_DISTRACTORS),
    mode: raw.mode === 'type' ? 'type' : 'drag',
    typos: raw.typos !== false,
  };
}

export const gapsBlob = (d: GapsDoc) =>
  new Blob([JSON.stringify({ ...d, text: d.text.trim(), distractors: d.distractors.map((x) => x.trim()).filter(Boolean) }, null, 1)], { type: GAPS_MIME });

/** Text in Textstücke und Lücken zerlegen. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[([^[\]]*)\]\]/g;
  let last = 0;
  let n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const answers = m[1]
      .split('|')
      .map((a) => a.trim())
      .filter(Boolean);
    if (answers.length) out.push({ kind: 'gap', id: `g${n++}`, answers });
    else out.push({ kind: 'text', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export const gapsOf = (text: string) => segments(text).filter((s): s is Extract<Segment, { kind: 'gap' }> => s.kind === 'gap');

/** Text mit eingesetzten Lösungen (z. B. für die KI oder die Vorschau). */
export const solvedText = (text: string) => segments(text).map((s) => (s.kind === 'gap' ? s.answers[0] : s.text)).join('');

// ---------- Prüfen ----------

const norm = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[„“”"‚‘’']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, '')
    .trim();

/** Tippfehler-Abstand (Levenshtein mit vertauschten Nachbarbuchstaben = 1 Fehler), nur für kurze Wörter. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export type Verdict = 'right' | 'almost' | 'wrong';

/** Ist die Eingabe richtig? „almost“ = mit kleinem Tippfehler (zählt als richtig, wenn erlaubt). */
export function judge(input: string, answers: string[], typos: boolean): Verdict {
  const x = norm(input);
  if (!x) return 'wrong';
  if (answers.some((a) => norm(a) === x)) return 'right';
  if (typos) {
    for (const a of answers) {
      const n = norm(a);
      const allowed = n.length >= 8 ? 2 : n.length >= 4 ? 1 : 0;
      if (allowed && distance(x, n) <= allowed) return 'almost';
    }
  }
  return 'wrong';
}

/** Wort-Kärtchen für „Wörter einsetzen“: je Lücke die erste Lösung, dazu die Ablenkwörter. */
export function bankFor(gaps: Extract<Segment, { kind: 'gap' }>[], distractors: string[]) {
  return [...gaps.map((g) => g.answers[0]), ...distractors].map((text) => ({ id: newId(), text }));
}
