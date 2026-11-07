// „Was hat sich geändert?“ – stark vereinfacht: zählt, was zwischen zwei Ständen einer Datei dazugekommen/weggefallen ist.
import { fileKind, type FileKind } from '../../lib/files';
import { parseCards, parseQuiz } from '../study/format';
import { parseChart } from '../charts/chart';
import { parseWheel } from '../wheel/wheel';

export type Unit = 'word' | 'image' | 'formula' | 'chart' | 'wheel' | 'check' | 'card' | 'question' | 'value' | 'entry' | 'version';
export interface ChangePart {
  unit: Unit;
  added: number;
  removed: number;
  changed: number;
}

const NAMES: Record<Unit, [string, string]> = {
  word: ['Wort', 'Wörter'],
  image: ['Bild', 'Bilder'],
  formula: ['Formel', 'Formeln'],
  chart: ['Diagramm', 'Diagramme'],
  wheel: ['Glücksrad', 'Glücksräder'],
  check: ['Checklisten-Punkt', 'Checklisten-Punkte'],
  card: ['Karte', 'Karten'],
  question: ['Frage', 'Fragen'],
  value: ['Wert', 'Werte'],
  entry: ['Eintrag', 'Einträge'],
  version: ['neue Version', 'neue Versionen'],
};
const n = (count: number, unit: Unit) => `${count} ${NAMES[unit][count === 1 ? 0 : 1]}`;

/** Unterschied zweier Listen (als Mehrfachmengen): wie viele kamen dazu, wie viele fielen weg. */
function bagDiff(before: string[], after: string[]): { added: number; removed: number } {
  const count = new Map<string, number>();
  before.forEach((x) => count.set(x, (count.get(x) ?? 0) + 1));
  let added = 0;
  for (const x of after) {
    const c = count.get(x) ?? 0;
    if (c > 0) count.set(x, c - 1);
    else added++;
  }
  let removed = 0;
  count.forEach((c) => (removed += c));
  return { added, removed };
}

/** Elemente mit IDs (Karten, Fragen …): neu, gelöscht, geändert. */
function idDiff<T extends { id: string }>(before: T[], after: T[], same: (a: T, b: T) => boolean) {
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Set(after.map((x) => x.id));
  let added = 0;
  let changed = 0;
  for (const x of after) {
    const o = old.get(x.id);
    if (!o) added++;
    else if (!same(o, x)) changed++;
  }
  return { added, removed: before.filter((x) => !now.has(x.id)).length, changed };
}

const words = (text: string) => text.toLocaleLowerCase('de').match(/[\p{L}\p{N}]+/gu) ?? [];

function docParts(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img')).map((i) => (i.getAttribute('src') ?? '').slice(-200));
  const maths = Array.from(doc.querySelectorAll('span.math')).map((m) => m.getAttribute('data-tex') ?? '');
  const charts = Array.from(doc.querySelectorAll('figure.chart')).map((f) => f.getAttribute('data-chart') ?? '');
  const wheels = Array.from(doc.querySelectorAll('figure.wheel')).map((f) => f.getAttribute('data-wheel') ?? '');
  const checks = Array.from(doc.querySelectorAll('ul.checklist > li')).map((li) => li.getAttribute('data-id') ?? '');
  // Formeln/Diagramme nicht als Wörter zählen.
  doc.querySelectorAll('span.math, figure').forEach((x) => x.remove());
  return { words: words(doc.body.textContent ?? ''), imgs, maths, charts, wheels, checks };
}

const part = (unit: Unit, d: { added: number; removed: number; changed?: number }): ChangePart => ({ unit, added: d.added, removed: d.removed, changed: d.changed ?? 0 });

/** Zusammenfassung der Änderung (leer = nichts Erkennbares geändert). */
export function summarize(kind: FileKind, before: string, after: string): ChangePart[] {
  let parts: ChangePart[] = [];
  if (kind === 'richtext') {
    const a = docParts(before);
    const b = docParts(after);
    parts = [
      part('word', bagDiff(a.words, b.words)),
      part('image', bagDiff(a.imgs, b.imgs)),
      part('formula', bagDiff(a.maths, b.maths)),
      part('chart', bagDiff(a.charts, b.charts)),
      part('wheel', bagDiff(a.wheels, b.wheels)),
      part('check', bagDiff(a.checks.filter(Boolean), b.checks.filter(Boolean))),
    ];
  } else if (kind === 'text') {
    parts = [part('word', bagDiff(words(before), words(after)))];
  } else if (kind === 'flashcards') {
    parts = [part('card', idDiff(parseCards(before).cards, parseCards(after).cards, (x, y) => x.front === y.front && x.back === y.back))];
  } else if (kind === 'quiz') {
    parts = [part('question', idDiff(parseQuiz(before).questions, parseQuiz(after).questions, (x, y) => JSON.stringify(x) === JSON.stringify(y)))];
  } else if (kind === 'chart') {
    parts = [part('value', idDiff(parseChart(before).points, parseChart(after).points, (x, y) => x.label === y.label && x.value === y.value))];
  } else if (kind === 'wheel') {
    parts = [part('entry', idDiff(parseWheel(before).entries, parseWheel(after).entries, (x, y) => x.label === y.label && x.weight === y.weight))];
  } else {
    parts = [{ unit: 'version', added: 1, removed: 0, changed: 0 }];
  }
  return parts.filter((p) => p.added || p.removed || p.changed);
}

/** Lässt sich der Inhalt als Text vergleichen? (sonst: „neue Version“) */
export const comparable = (kind: FileKind) => ['richtext', 'text', 'flashcards', 'quiz', 'chart', 'wheel'].includes(kind);
export const kindOfFile = fileKind;

/** Mehrere Änderungen (z. B. derselben Person) zusammenzählen. */
export function mergeParts(list: ChangePart[][]): ChangePart[] {
  const m = new Map<Unit, ChangePart>();
  for (const parts of list)
    for (const p of parts) {
      const e = m.get(p.unit) ?? { unit: p.unit, added: 0, removed: 0, changed: 0 };
      e.added += p.added;
      e.removed += p.removed;
      e.changed += p.changed;
      m.set(p.unit, e);
    }
  return [...m.values()];
}

/** „+120 Wörter, −1 Bild, 2 Karten geändert“ */
export function describe(parts: ChangePart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.unit === 'version') {
      out.push(p.added === 1 ? 'neue Version hochgeladen' : `${p.added} neue Versionen hochgeladen`);
      continue;
    }
    if (p.added) out.push(`+${n(p.added, p.unit)}`);
    if (p.removed) out.push(`−${n(p.removed, p.unit)}`);
    if (p.changed) out.push(`${n(p.changed, p.unit)} geändert`);
  }
  return out.join(', ') || 'kleine Änderungen';
}
