// Materialien für die KI vorbereiten: Text wird aus den Dateien gelesen und in den Prompt geschrieben,
// Bilder und eingescannte PDFs werden stattdessen direkt an die KI geschickt (teilen bzw. herunterladen).
import type { FileItem } from '../../domain/types';
import { fileKind, fullName } from '../../lib/files';
import { loadBlob } from '../../storage/blobs';
import { parseCards, parseQuiz } from '../study/format';
import { parseChart } from '../charts/chart';
import { parseWheel } from '../wheel/wheel';

/** text = steht im Prompt · file = Datei direkt an die KI geben · skip = geht nicht (Video, Audio …) */
export type MaterialRoute = 'text' | 'file' | 'skip';

export interface Material {
  file: FileItem;
  status: 'loading' | 'ready' | 'error';
  route: MaterialRoute;
  /** Ausgelesener Text (nur route = text). */
  text?: string;
  /** Datei zum Teilen/Herunterladen (nur route = file). */
  blob?: File;
  /** Kurze Erklärung für die Anzeige, z. B. „Scan – kein Text gefunden“. */
  note?: string;
}

/** Höchstens so viele Zeichen pro Datei (sehr lange Skripte würden sonst jede KI überfordern). */
export const MAX_FILE_CHARS = 200_000;

const ext = (f: FileItem) => f.ext.toLowerCase();

/** Erste Einschätzung ohne Laden (für die Auswahl-Liste). */
export function routeGuess(f: FileItem): { route: MaterialRoute; label: string } {
  const k = fileKind(f);
  switch (k) {
    case 'text':
    case 'richtext':
    case 'flashcards':
    case 'quiz':
    case 'chart':
    case 'wheel':
      return { route: 'text', label: 'Text' };
    case 'pdf':
      return { route: 'text', label: 'PDF' };
    case 'document':
      return ['docx', 'odt'].includes(ext(f)) ? { route: 'text', label: 'Dokument' } : { route: 'file', label: 'Dokument' };
    case 'presentation':
      return ['pptx', 'odp'].includes(ext(f)) ? { route: 'text', label: 'Präsentation' } : { route: 'file', label: 'Präsentation' };
    case 'spreadsheet':
      return ext(f) === 'csv' ? { route: 'text', label: 'Tabelle' } : { route: 'file', label: 'Tabelle' };
    case 'image':
      return ext(f) === 'svg' ? { route: 'skip', label: 'Grafik' } : { route: 'file', label: 'Bild' };
    case 'video':
      return { route: 'skip', label: 'Video' };
    case 'audio':
      return { route: 'skip', label: 'Audio' };
    case 'archive':
      return { route: 'skip', label: 'Archiv' };
    default:
      return { route: 'skip', label: 'Datei' };
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

async function unzip(blob: Blob) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return { files, str: (name: string) => (files[name] ? strFromU8(files[name]) : '') };
}

/** Word (.docx) bzw. OpenDocument (.odt) */
async function documentText(blob: Blob, odf: boolean): Promise<string> {
  const z = await unzip(blob);
  const xml = odf ? z.str('content.xml') : z.str('word/document.xml');
  const text = odf
    ? xml.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/text:(p|h)>/g, '\n')
    : xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n');
  return tidy(decodeXml(text.replace(/<[^>]+>/g, '')));
}

/** PowerPoint (.pptx) bzw. OpenDocument (.odp): Text pro Folie */
async function slidesText(blob: Blob, odf: boolean): Promise<string> {
  const z = await unzip(blob);
  if (odf) {
    const xml = z.str('content.xml');
    const pages = xml.split(/<draw:page\b/).slice(1);
    return tidy(
      pages
        .map((p, i) => `Folie ${i + 1}:\n${decodeXml(p.replace(/<\/text:(p|h)>/g, '\n').replace(/<[^>]+>/g, ''))}`)
        .join('\n\n'),
    );
  }
  const slides = Object.keys(z.files)
    .map((n) => n.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  return tidy(
    slides
      .map((m, i) => {
        const xml = z.str(m[0]);
        const paras = xml.split(/<\/a:p>/).map((p) => decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join('')));
        const notesXml = z.str(`ppt/notesSlides/notesSlide${m[1]}.xml`);
        const notes = notesXml
          ? notesXml.split(/<\/a:p>/).map((p) => decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join(''))).filter((t) => t.trim() && !/^\d+$/.test(t.trim()))
          : [];
        return `Folie ${i + 1}:\n${paras.filter((p) => p.trim()).join('\n')}${notes.length ? `\n(Notizen: ${notes.join(' ')})` : ''}`;
      })
      .join('\n\n'),
  );
}

/** PDF: Text pro Seite. Wenig Text pro Seite = vermutlich eingescannt. */
async function pdfText(blob: Blob): Promise<{ text: string; scanned: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let t = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      t += item.str + (item.hasEOL ? '\n' : '');
    }
    t = tidy(t);
    chars += t.replace(/\s/g, '').length;
    pages.push(`[Seite ${n}]\n${t}`);
    if (chars > MAX_FILE_CHARS * 1.2) break;
  }
  await pdf.destroy();
  return { text: pages.join('\n\n'), scanned: chars < 60 * pdf.numPages };
}

/** Text-Dokument (HTML der App) als lesbarer Text mit Formeln in $…$. */
function richText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('span.math').forEach((m) => {
    const tex = m.getAttribute('data-tex') ?? '';
    m.replaceWith(m.getAttribute('data-display') === '1' ? `$$${tex}$$` : `$${tex}$`);
  });
  doc.querySelectorAll('figure[data-chart]').forEach((f) => {
    const c = parseChart(f.getAttribute('data-chart') ?? '');
    f.replaceWith(`\n[Diagramm „${c.title}“: ${c.points.map((p) => `${p.label} = ${p.value}${c.unit}`).join(', ')}]\n`);
  });
  doc.querySelectorAll('figure[data-wheel]').forEach((f) => {
    const w = parseWheel(f.getAttribute('data-wheel') ?? '');
    f.replaceWith(`\n[Glücksrad „${w.title}“: ${w.entries.map((e) => e.label).join(', ')}]\n`);
  });
  doc.querySelectorAll('img').forEach((img) => img.replaceWith(img.getAttribute('alt') ? `[Bild: ${img.getAttribute('alt')}]` : '[Bild]'));
  doc.querySelectorAll('h2').forEach((h) => h.prepend('## '));
  doc.querySelectorAll('h3').forEach((h) => h.prepend('### '));
  doc.querySelectorAll('ul.checklist > li').forEach((li) => li.prepend('[ ] '));
  doc.querySelectorAll('li').forEach((li) => {
    const depth = Math.max(0, li.parentElement ? [...ancestors(li)].filter((a) => a.matches('ul, ol')).length - 1 : 0);
    li.prepend(`${'  '.repeat(depth)}- `);
  });
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, h2, h3, li, blockquote, pre').forEach((el) => el.append('\n'));
  return tidy(doc.body.textContent ?? '');
}
function* ancestors(el: Element) {
  for (let a = el.parentElement; a; a = a.parentElement) yield a;
}

const cardsText = (json: string) =>
  parseCards(json)
    .cards.map((c, i) => `Karte ${i + 1}\nVorderseite: ${c.front}\nRückseite: ${c.back}`)
    .join('\n\n');

const quizText = (json: string) =>
  parseQuiz(json)
    .questions.map(
      (q, i) =>
        `Frage ${i + 1}: ${q.text}\n${q.answers.map((a, j) => `  ${String.fromCharCode(65 + j)}) ${a.text}${a.correct ? '  (richtig)' : ''}`).join('\n')}${q.explanation ? `\n  Erklärung: ${q.explanation}` : ''}`,
    )
    .join('\n\n');

/** Datei laden und je nach Art Text auslesen oder als Datei für die KI bereitstellen. */
export async function prepareMaterial(f: FileItem): Promise<Material> {
  const guess = routeGuess(f);
  if (guess.route === 'skip') return { file: f, status: 'ready', route: 'skip', note: `${guess.label} – kann die KI hier nicht lesen` };
  const blob = await loadBlob(f.blobId);
  if (!blob) return { file: f, status: 'error', route: guess.route, note: 'Konnte nicht geladen werden – bist du online?' };
  const asFile = (note: string): Material => ({
    file: f,
    status: 'ready',
    route: 'file',
    blob: new File([blob], fullName(f), { type: f.mime || blob.type || 'application/octet-stream' }),
    note,
  });
  if (guess.route === 'file') return asFile(f.mime.startsWith('image/') || fileKind(f) === 'image' ? 'Bild – direkt an die KI geben' : `${guess.label} – direkt an die KI geben`);

  try {
    let text = '';
    const k = fileKind(f);
    const e = ext(f);
    if (k === 'pdf') {
      const r = await pdfText(blob);
      if (r.scanned) return asFile('Scan (kein Text gefunden) – direkt an die KI geben');
      text = r.text;
    } else if (k === 'richtext') text = richText(await blob.text());
    else if (k === 'flashcards') text = cardsText(await blob.text());
    else if (k === 'quiz') text = quizText(await blob.text());
    else if (k === 'chart') {
      const c = parseChart(await blob.text());
      text = `Diagramm „${c.title}“ (${c.chart}${c.unit ? `, Einheit ${c.unit}` : ''}):\n${c.points.map((p) => `${p.label}: ${p.value}`).join('\n')}`;
    } else if (k === 'wheel') {
      const w = parseWheel(await blob.text());
      text = `Glücksrad „${w.title}“:\n${w.entries.map((x) => `- ${x.label}`).join('\n')}`;
    } else if (k === 'document') text = await documentText(blob, e === 'odt');
    else if (k === 'presentation') text = await slidesText(blob, e === 'odp');
    else text = tidy(await blob.text());

    if (!text.trim()) {
      if (k === 'presentation' || k === 'document') return asFile('Kein Text gefunden – direkt an die KI geben');
      return { file: f, status: 'ready', route: 'skip', note: 'Leer – kein Text gefunden' };
    }
    let note = `${text.length.toLocaleString('de')} Zeichen`;
    if (text.length > MAX_FILE_CHARS) {
      text = `${text.slice(0, MAX_FILE_CHARS)}\n[… gekürzt – die Datei ist zu lang]`;
      note = `gekürzt auf ${MAX_FILE_CHARS.toLocaleString('de')} Zeichen`;
    }
    return { file: f, status: 'ready', route: 'text', text, note };
  } catch (err) {
    console.warn('Material konnte nicht gelesen werden', err);
    return asFile('Text konnte nicht gelesen werden – direkt an die KI geben');
  }
}
