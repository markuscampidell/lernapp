import type { Chunk } from './text';

// Einfache Stichwortsuche (BM25) über die Textabschnitte – findet die Stellen, die zur Frage passen.

const STOP = new Set(
  'der die das den dem des ein eine einer eines einem einen und oder aber nicht kein keine ist sind war waren wird werden wurde hat haben hatte mit von zu zum zur im in am an auf aus bei für fur über uber unter vor nach als wie was wer wo wann warum welche welcher welches man es er sie ich du wir ihr sich auch noch nur so dass da dann denn doch sehr mehr bitte mir mich dir dich mein meine dein deine unsere erkläre erklaere erklär sag sage gib nenne beschreibe kannst könntest the a an of and or to is are in on for'.split(' '),
);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Wörter -> grobe Stämme (deutsche Endungen abschneiden), ohne Füllwörter. */
export function terms(s: string): string[] {
  return (norm(s).match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.replace(/(ungen|ung|en|er|es|em|e|n|s)$/, '') : w));
}

export interface Index {
  chunks: Chunk[];
  docs: Map<string, number>[];
  df: Map<string, number>;
  avgLen: number;
}

export function buildIndex(chunks: Chunk[]): Index {
  const docs = chunks.map((c) => {
    const m = new Map<string, number>();
    for (const t of terms(`${c.fileName} ${c.text}`)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  docs.forEach((d) => d.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const avgLen = docs.reduce((s, d) => s + [...d.values()].reduce((a, b) => a + b, 0), 0) / Math.max(1, docs.length);
  return { chunks, docs, df, avgLen };
}

/** Die besten Abschnitte für eine Anfrage (nur Treffer mit Punktzahl > 0). */
export function search(index: Index, query: string, limit = 6): Chunk[] {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const N = index.chunks.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = index.docs.map((d, i) => {
    const len = [...d.values()].reduce((a, c) => a + c, 0);
    let score = 0;
    for (const t of q) {
      // auch Wortanfänge zählen ("ableit" findet "ableitung")
      let tf = d.get(t) ?? 0;
      if (!tf && t.length >= 4) for (const [w, c] of d) if (w.startsWith(t) || t.startsWith(w)) tf += c * 0.6;
      if (!tf) continue;
      const n = index.df.get(t) ?? 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / index.avgLen));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map((s) => index.chunks[s.i]);
}

/** Für Überblicks-Fragen: Abschnitte gleichmäßig über alle Dateien verteilt. */
export function spread(chunks: Chunk[], limit: number): Chunk[] {
  const byFile = new Map<string, Chunk[]>();
  chunks.forEach((c) => byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c]));
  const lists = [...byFile.values()];
  const out: Chunk[] = [];
  for (let round = 0; out.length < limit && lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      if (out.length >= limit) break;
      // pro Runde einen Abschnitt, über die Datei verteilt
      const step = Math.max(1, Math.floor(l.length / Math.ceil(limit / lists.length)));
      const c = l[round * step];
      if (c) out.push(c);
    }
  }
  return out;
}
