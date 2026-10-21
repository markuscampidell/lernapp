import type { FileItem } from '../domain/types';
import { db } from '../storage/db';
import { fileKind, fullName } from '../lib/files';
import { extractOfficeText } from './extract';

/** Ein Textabschnitt aus einer Datei, z. B. eine halbe PDF-Seite. */
export interface Chunk {
  fileId: string;
  fileName: string;
  /** Stelle in der Datei, z. B. "S. 3" oder "Folie 2" (kann leer sein). */
  loc: string;
  text: string;
}

export type FileText = { ok: true; chunks: Chunk[] } | { ok: false; reason: string };

const MAX_CHUNK = 900;
const cache = new Map<string, FileText>();

async function pdfSegments(blob: Blob): Promise<{ loc: string; text: string }[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const out: { loc: string; text: string }[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof it.str !== 'string') continue;
        text += it.str + (it.hasEOL ? '\n' : ' ');
      }
      out.push({ loc: `S. ${n}`, text });
    }
  } finally {
    pdf.destroy().catch(() => {});
  }
  return out;
}

/** Teilt einen Text an Absatz-/Satzgrenzen in Stücke von höchstens MAX_CHUNK Zeichen. */
function split(text: string): string[] {
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const pieces = clean.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/);
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const piece = p.trim();
    if (!piece) continue;
    if (piece.length > MAX_CHUNK) {
      if (cur) out.push(cur);
      cur = '';
      for (let i = 0; i < piece.length; i += MAX_CHUNK) out.push(piece.slice(i, i + MAX_CHUNK));
      continue;
    }
    if ((cur + '\n' + piece).length > MAX_CHUNK) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out;
}

/** Liest den Text einer Datei und teilt ihn in Abschnitte (Ergebnis wird zwischengespeichert). */
export async function fileText(file: FileItem): Promise<FileText> {
  const ck = `${file.id}:${file.updatedAt}:${file.blobId}`;
  const hit = cache.get(ck);
  if (hit) return hit;

  const result = await (async (): Promise<FileText> => {
    const blob = await db.getBlob(file.blobId);
    if (!blob) return { ok: false, reason: 'Inhalt fehlt' };
    const kind = fileKind(file);
    const ext = file.ext.toLowerCase();
    let segments: { loc: string; text: string }[] = [];
    try {
      if (kind === 'text' || ext === 'csv') segments = [{ loc: '', text: (await blob.text()).slice(0, 2_000_000) }];
      else if (kind === 'pdf') segments = await pdfSegments(blob);
      else if (kind === 'image') return { ok: false, reason: 'Bild – Text in Bildern kann die KI noch nicht lesen' };
      else if (kind === 'video' || kind === 'audio') return { ok: false, reason: 'Video/Audio wird nicht unterstützt' };
      else {
        const t = await extractOfficeText(blob, ext);
        if (!t) return { ok: false, reason: 'Format wird nicht unterstützt' };
        // Folien/Tabellenblätter als eigene Stellen
        const parts = t.split(/^--- (Folie \d+|Tabellenblatt \d+) ---$/m);
        if (parts.length > 1) for (let i = 1; i < parts.length; i += 2) segments.push({ loc: parts[i], text: parts[i + 1] ?? '' });
        else segments = [{ loc: '', text: t }];
      }
    } catch (e) {
      console.warn('Text konnte nicht gelesen werden', e);
      return { ok: false, reason: 'konnte nicht gelesen werden' };
    }
    const chunks: Chunk[] = [];
    for (const seg of segments) for (const text of split(seg.text)) chunks.push({ fileId: file.id, fileName: fullName(file), loc: seg.loc, text });
    if (chunks.length === 0) return { ok: false, reason: kind === 'pdf' ? 'kein Text gefunden (eingescanntes PDF?)' : 'leer' };
    return { ok: true, chunks };
  })();
  cache.set(ck, result);
  return result;
}
