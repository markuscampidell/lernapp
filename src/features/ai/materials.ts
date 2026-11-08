// Materialien für die KI vorbereiten: Text wird aus den Dateien gelesen und in den Prompt geschrieben,
// Bilder und eingescannte PDFs werden stattdessen direkt an die KI geschickt (teilen bzw. herunterladen).
// Bilder IN Dokumenten (Text-Dokumente, Word, PowerPoint …) werden herausgelöst und ebenfalls direkt mitgegeben;
// im Text steht an ihrer Stelle ein Platzhalter mit dem Dateinamen.
import type { FileItem } from '../../domain/types';
import { fileKind, fullName, shrinkImage } from '../../lib/files';
import { loadBlob } from '../../storage/blobs';
import { parseCards, parseQuiz } from '../study/format';
import { parseChart } from '../charts/chart';
import { parseWheel } from '../wheel/wheel';
import { parseGapsDoc, solvedText } from '../gaps/gaps';

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
  /** Aus dem Dokument herausgelöste Bilder – gehen direkt an die KI. */
  images?: File[];
  /** Original-PDF (bei PDFs mit Text), falls es zusätzlich angehängt werden soll. */
  original?: File;
  /** Original zusätzlich anhängen? (wird in der Oberfläche gesetzt) */
  attachOriginal?: boolean;
  /** Kurze Erklärung für die Anzeige, z. B. „Scan – kein Text gefunden“. */
  note?: string;
}

/** Alle Dateien, die von diesem Material direkt an die KI gehen. */
export function attachmentsOf(m: Material): File[] {
  if (m.status !== 'ready') return [];
  return [...(m.route === 'file' && m.blob ? [m.blob] : []), ...(m.images ?? []), ...(m.attachOriginal && m.original ? [m.original] : [])];
}

/** Höchstens so viele Zeichen pro Datei (sehr lange Skripte würden sonst jede KI überfordern). */
export const MAX_FILE_CHARS = 200_000;
/** Höchstens so viele Bilder pro Dokument herauslösen. */
const MAX_IMAGES = 30;
/** Winzige Bilder (Icons, Logos, Aufzählungszeichen) weglassen. */
const MIN_IMAGE_BYTES = 6 * 1024;

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
    case 'gaps':
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

// ---------- Bilder sammeln ----------

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** Sammelt Bilder eines Dokuments, vergibt Dateinamen und liefert den Platzhalter für den Text. */
class ImageCollector {
  files: File[] = [];
  private byKey = new Map<string, string>();
  private skipped = 0;
  constructor(private base: string) {}

  /** Gibt den Platzhalter zurück – oder '' wenn das Bild nicht verwendet wird. */
  async add(key: string, data: Blob | Uint8Array, typeHint: string): Promise<string> {
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const extHint = typeHint.toLowerCase().replace(/^.*[./]/, '');
    const mime = IMAGE_TYPES[extHint] ?? (typeHint.startsWith('image/') ? typeHint : '');
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    if (!mime || blob.size < MIN_IMAGE_BYTES || this.files.length >= MAX_IMAGES) {
      if (mime && blob.size >= MIN_IMAGE_BYTES) this.skipped++;
      this.byKey.set(key, '');
      return '';
    }
    const small = await shrinkImage(blob, mime, extHint || 'jpg');
    const name = `${this.base} – Bild ${this.files.length + 1}.${small.ext === 'jpeg' ? 'jpg' : small.ext}`;
    this.files.push(new File([small.blob], name, { type: small.mime }));
    const ph = `[Bild: siehe angehängte Datei „${name}“]`;
    this.byKey.set(key, ph);
    return ph;
  }

  get note(): string {
    if (!this.files.length) return '';
    const n = this.files.length;
    return `${n} ${n === 1 ? 'Bild' : 'Bilder'} direkt an die KI${this.skipped ? ` (${this.skipped} weitere weggelassen)` : ''}`;
  }
}

/** Ersetzt Treffer eines regulären Ausdrucks mit dem Ergebnis einer async-Funktion. */
async function replaceAsync(s: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>): Promise<string> {
  const parts: (string | Promise<string>)[] = [];
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    parts.push(s.slice(last, m.index), fn(m));
    last = m.index + m[0].length;
  }
  parts.push(s.slice(last));
  return (await Promise.all(parts)).join('');
}

async function unzip(blob: Blob) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return { files, str: (name: string) => (files[name] ? strFromU8(files[name]) : '') };
}

/** Beziehungen (rId → Ziel) aus einer .rels-Datei */
function rels(xml: string, baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (!id || !target || /TargetMode="External"/.test(m[0])) continue;
    // Pfad relativ zum Ordner der Datei auflösen ("../media/image1.png")
    const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`).split('/');
    const out: string[] = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    }
    map.set(id, out.join('/'));
  }
  return map;
}

// ---------- Dokumente ----------

/** Word (.docx) bzw. OpenDocument (.odt) */
async function documentText(blob: Blob, odf: boolean, imgs: ImageCollector): Promise<string> {
  const z = await unzip(blob);
  let xml: string;
  if (odf) {
    xml = z.str('content.xml');
    xml = await replaceAsync(xml, /<draw:image\b[^>]*xlink:href="([^"]+)"[^>]*\/?>/g, async (m) => {
      const data = z.files[m[1]];
      return data ? ` ${await imgs.add(m[1], data, m[1])} ` : '';
    });
    xml = xml.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/text:(p|h)>/g, '\n');
  } else {
    xml = z.str('word/document.xml');
    const r = rels(z.str('word/_rels/document.xml.rels'), 'word');
    const embed = async (id: string) => {
      const target = r.get(id);
      const data = target ? z.files[target] : undefined;
      return target && data ? ` ${await imgs.add(target, data, target)} ` : '';
    };
    xml = await replaceAsync(xml, /<w:drawing>[\s\S]*?<\/w:drawing>/g, async (m) => {
      const id = m[0].match(/r:embed="([^"]+)"/)?.[1];
      return id ? embed(id) : '';
    });
    xml = await replaceAsync(xml, /<w:pict>[\s\S]*?<\/w:pict>/g, async (m) => {
      const id = m[0].match(/r:id="([^"]+)"/)?.[1];
      return id ? embed(id) : '';
    });
    xml = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n');
  }
  // Platzhalter vor dem Entfernen der Tags schützen
  return tidy(decodeXml(xml.replace(/<[^>]+>/g, '')));
}

const runsText = (xml: string) =>
  xml
    .split(/<\/a:p>/)
    .map((p) => decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join('')))
    .filter((t) => t.trim());

/** PowerPoint (.pptx) bzw. OpenDocument (.odp): Text pro Folie, Bilder als Platzhalter */
async function slidesText(blob: Blob, odf: boolean, imgs: ImageCollector): Promise<string> {
  const z = await unzip(blob);
  if (odf) {
    const xml = z.str('content.xml');
    const pages = xml.split(/<draw:page\b/).slice(1);
    const out: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = await replaceAsync(pages[i], /<draw:image\b[^>]*xlink:href="([^"]+)"[^>]*\/?>/g, async (m) => {
        const data = z.files[m[1]];
        return data ? `\n${await imgs.add(m[1], data, m[1])}\n` : '';
      });
      out.push(`Folie ${i + 1}:\n${decodeXml(p.replace(/<\/text:(p|h)>/g, '\n').replace(/<[^>]+>/g, ''))}`);
    }
    return tidy(out.join('\n\n'));
  }
  const slides = Object.keys(z.files)
    .map((n) => n.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const out: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const m = slides[i];
    const xml = z.str(m[0]);
    const r = rels(z.str(`ppt/slides/_rels/slide${m[1]}.xml.rels`), 'ppt/slides');
    const pics: string[] = [];
    for (const pic of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const id = pic[0].match(/r:embed="([^"]+)"/)?.[1];
      const target = id ? r.get(id) : undefined;
      const data = target ? z.files[target] : undefined;
      if (target && data) {
        const ph = await imgs.add(target, data, target);
        if (ph) pics.push(ph);
      }
    }
    const paras = runsText(xml);
    const notesXml = z.str(`ppt/notesSlides/notesSlide${m[1]}.xml`);
    const notes = notesXml ? runsText(notesXml).filter((t) => !/^\d+$/.test(t.trim())) : [];
    out.push(`Folie ${i + 1}:\n${[...paras, ...pics].join('\n')}${notes.length ? `\n(Notizen: ${notes.join(' ')})` : ''}`);
  }
  return tidy(out.join('\n\n'));
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

/** Text-Dokument (HTML der App) als lesbarer Text mit Formeln in $…$; eingebettete Bilder werden herausgelöst. */
async function richText(html: string, imgs: ImageCollector): Promise<string> {
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
  let n = 0;
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt');
    let ph = '';
    if (src.startsWith('data:image/')) {
      const blob = await fetch(src)
        .then((r) => r.blob())
        .catch(() => null);
      if (blob) ph = await imgs.add(`img${n++}:${src.length}:${src.slice(-40)}`, blob, blob.type);
    }
    img.replaceWith(ph ? `\n${ph}${alt ? ` (${alt})` : ''}\n` : alt ? `[Bild: ${alt}]` : '[Bild]');
  }
  // Spalten & Zeilen als Markdown-Tabelle (erste Zeile als Kopfzeile).
  doc.querySelectorAll('div.cols').forEach((box) => {
    const rows = Array.from(box.querySelectorAll(':scope > div.row'));
    const lines = (rows.length ? rows : [box]).map((r) => {
      const cells = Array.from(r.querySelectorAll(':scope > div.col')).map((c) =>
        Array.from(c.children)
          .map((x) => (x.textContent ?? '').trim())
          .filter(Boolean)
          .join(' / ')
          .replace(/\|/g, '\\|'),
      );
      return `| ${cells.join(' | ')} |`;
    });
    if (lines.length) lines.splice(1, 0, `|${' --- |'.repeat((rows[0] ?? box).querySelectorAll(':scope > div.col').length)}`);
    box.replaceWith(`\n${lines.join('\n')}\n`);
  });
  doc.querySelectorAll('h2').forEach((h) => h.prepend('## '));
  doc.querySelectorAll('h3').forEach((h) => h.prepend('### '));
  doc.querySelectorAll('ul.checklist > li').forEach((li) => li.prepend('[ ] '));
  doc.querySelectorAll('li').forEach((li) => {
    const depth = Math.max(0, [...ancestors(li)].filter((a) => a.matches('ul, ol')).length - 1);
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
  const asFileObj = () => new File([blob], fullName(f), { type: f.mime || blob.type || 'application/octet-stream' });
  const asFile = (note: string): Material => ({ file: f, status: 'ready', route: 'file', blob: asFileObj(), note });
  if (guess.route === 'file') return asFile(fileKind(f) === 'image' ? 'Bild – direkt an die KI geben' : `${guess.label} – direkt an die KI geben`);

  const imgs = new ImageCollector(fullName(f).slice(0, 70));
  try {
    let text = '';
    let original: File | undefined;
    const k = fileKind(f);
    const e = ext(f);
    if (k === 'pdf') {
      const r = await pdfText(blob);
      if (r.scanned) return asFile('Scan (kein Text gefunden) – direkt an die KI geben');
      text = r.text;
      original = asFileObj();
    } else if (k === 'richtext') text = await richText(await blob.text(), imgs);
    else if (k === 'flashcards') text = cardsText(await blob.text());
    else if (k === 'quiz') text = quizText(await blob.text());
    else if (k === 'chart') {
      const c = parseChart(await blob.text());
      text = `Diagramm „${c.title}“ (${c.chart}${c.unit ? `, Einheit ${c.unit}` : ''}):\n${c.points.map((p) => `${p.label}: ${p.value}`).join('\n')}`;
    } else if (k === 'wheel') {
      const w = parseWheel(await blob.text());
      text = `Glücksrad „${w.title}“:\n${w.entries.map((x) => `- ${x.label}`).join('\n')}`;
    } else if (k === 'gaps') {
      const g = parseGapsDoc(await blob.text());
      text = `Lückentext (Lösungen eingesetzt):\n${solvedText(g.text)}`;
    } else if (k === 'document') text = await documentText(blob, e === 'odt', imgs);
    else if (k === 'presentation') text = await slidesText(blob, e === 'odp', imgs);
    else text = tidy(await blob.text());

    // Nur Bilder, kaum Text (z. B. Folien mit Fotos): Text trotzdem mitnehmen, Bilder gehen direkt an die KI.
    if (!text.replace(/\[Bild: [^\]]*\]/g, '').trim() && !imgs.files.length) {
      if (k === 'presentation' || k === 'document') return asFile('Kein Text gefunden – direkt an die KI geben');
      return { file: f, status: 'ready', route: 'skip', note: 'Leer – kein Text gefunden' };
    }
    let note = `${text.length.toLocaleString('de')} Zeichen`;
    if (text.length > MAX_FILE_CHARS) {
      text = `${text.slice(0, MAX_FILE_CHARS)}\n[… gekürzt – die Datei ist zu lang]`;
      note = `gekürzt auf ${MAX_FILE_CHARS.toLocaleString('de')} Zeichen`;
    }
    if (imgs.note) note += ` · ${imgs.note}`;
    return { file: f, status: 'ready', route: 'text', text, note, images: imgs.files.length ? imgs.files : undefined, original };
  } catch (err) {
    console.warn('Material konnte nicht gelesen werden', err);
    return asFile('Text konnte nicht gelesen werden – direkt an die KI geben');
  }
}
