import type { FileItem } from '../domain/types';

export type FileKind =
  | 'image'
  | 'pdf'
  | 'text'
  | 'video'
  | 'audio'
  | 'presentation'
  | 'document'
  | 'spreadsheet'
  | 'archive'
  | 'flashcards'
  | 'quiz'
  | 'richtext'
  | 'other';

const EXT: Record<string, FileKind> = {
  // Eigene Lern-Dateien der App (siehe src/features/study/format.ts)
  karten: 'flashcards',
  quiz: 'quiz',
  dokument: 'richtext',
  pdf: 'pdf',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation', pps: 'presentation', ppsx: 'presentation',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', pages: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', numbers: 'spreadsheet',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  txt: 'text', md: 'text', markdown: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text', css: 'text',
  js: 'text', ts: 'text', py: 'text', java: 'text', c: 'text', cpp: 'text', h: 'text', hpp: 'text', tex: 'text',
  log: 'text', yml: 'text', yaml: 'text', ini: 'text', sql: 'text', sh: 'text',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', heic: 'image', heif: 'image', avif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
};

export function kindOf(mime: string, ext: string): FileKind {
  const byExt = EXT[ext.toLowerCase()];
  if (byExt) return byExt;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
  if (mime.includes('word') || mime.includes('opendocument.text')) return 'document';
  if (mime.includes('zip') || mime.includes('compressed')) return 'archive';
  return 'other';
}

export const KIND_LABEL: Record<FileKind, string> = {
  image: 'Bild',
  pdf: 'PDF',
  text: 'Text',
  video: 'Video',
  audio: 'Audio',
  presentation: 'Präsentation',
  document: 'Dokument',
  spreadsheet: 'Tabelle',
  archive: 'Archiv',
  flashcards: 'Karteikarten',
  quiz: 'Quiz',
  richtext: 'Text-Dokument',
  other: 'Datei',
};

export const fileKind = (f: Pick<FileItem, 'mime' | 'ext'>) => kindOf(f.mime, f.ext);

/** "Skript Analysis.pdf" -> { name: "Skript Analysis", ext: "pdf" } */
export function splitName(filename: string): { name: string; ext: string } {
  const i = filename.lastIndexOf('.');
  if (i <= 0 || i === filename.length - 1) return { name: filename, ext: '' };
  return { name: filename.slice(0, i), ext: filename.slice(i + 1).toLowerCase() };
}

export const fullName = (f: Pick<FileItem, 'name' | 'ext'>) => (f.ext ? `${f.name}.${f.ext}` : f.name);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Verkleinert ein Bild zu einem JPEG (für Vorschaubilder). Gibt undefined zurück, wenn der Browser das Format nicht lesen kann. */
export async function makeThumbnail(blob: Blob, max = 320): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.82));
  } catch {
    return undefined;
  }
}

/** Datei herunterladen bzw. an das System übergeben. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Dateiauswahl ----------
const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Chrome auf Android zeigt bei <input type="file"> ohne `accept` (oder sobald Bild-/Video-/Audio-Typen
 * erlaubt sind) nur "Kamera" und "Fotos und Videos". Nur mit reinen Dokument-Typen öffnet es direkt den
 * Dateimanager (Downloads, Google Drive usw.).
 * Am PC bleibt `accept` leer, damit alle Dateien wählbar sind.
 */
export const DOCUMENT_ACCEPT = isAndroid
  ? [
      'application/pdf', '.pdf',
      'application/msword', '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
      'application/vnd.ms-powerpoint', '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx',
      'application/vnd.ms-excel', '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx',
      'application/vnd.oasis.opendocument.text', '.odt',
      'application/vnd.oasis.opendocument.presentation', '.odp',
      'application/vnd.oasis.opendocument.spreadsheet', '.ods',
      'application/rtf', '.rtf',
      'text/plain', '.txt', 'text/markdown', '.md', 'text/csv', '.csv', 'text/html', 'application/json',
      'application/zip', '.zip',
      'application/x-7z-compressed', '.7z', 'application/vnd.rar', '.rar',
      'application/epub+zip', '.epub',
      'application/octet-stream',
    ].join(',')
  : undefined;
