import type { FileItem } from '../domain/types';
import { db } from '../storage/db';
import { fileKind, fullName } from '../lib/files';
import { extractOfficeText } from './extract';

// Direkte Aufrufe der Gemini-API aus dem Browser (kein eigener Server). Doku: ai.google.dev/gemini-api/docs
const BASE = 'https://generativelanguage.googleapis.com';

export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function toError(res: Response): Promise<GeminiError> {
  let msg = '';
  try {
    const j = await res.json();
    msg = j?.error?.message ?? '';
  } catch {
    /* kein JSON */
  }
  if (res.status === 400 && /api key/i.test(msg)) return new GeminiError('Der Gemini-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.', 400);
  if (res.status === 401 || res.status === 403)
    return new GeminiError(`Zugriff verweigert – ist der Schlüssel richtig und die Gemini-API für dein Konto verfügbar?${msg ? ` (${msg})` : ''}`, res.status);
  if (res.status === 404) return new GeminiError('Dieses Modell gibt es nicht (mehr). Wähle in den Einstellungen ein anderes.', 404);
  if (res.status === 429)
    return new GeminiError('Das Gratis-Limit ist gerade erreicht. Warte eine Minute – oder, wenn das Tageslimit voll ist, bis morgen.', 429);
  if (res.status >= 500) return new GeminiError('Gemini ist gerade überlastet oder nicht erreichbar. Bitte gleich noch einmal versuchen.', res.status);
  return new GeminiError(msg || `Fehler ${res.status}`, res.status);
}

async function api(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), 'x-goog-api-key': key } });
  } catch {
    throw new GeminiError('Keine Verbindung zu Gemini. Bist du online?');
  }
  if (!res.ok) throw await toError(res);
  return res;
}

// ---------- Modelle ----------

export interface ModelInfo {
  id: string;
  label: string;
}

const versionOf = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);

export async function listModels(key: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    const res = await api(key, `/v1beta/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    const j = (await res.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of j.models ?? []) {
      const id = m.name.replace(/^models\//, '');
      if (!id.startsWith('gemini')) continue;
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
      if (/embed|tts|image|live|audio|robotics|computer|aqa|native|veo|imagen/i.test(id)) continue;
      out.push({ id, label: m.displayName || id });
    }
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  // Neueste zuerst, Flash vor Pro (Pro ist im Gratis-Kontingent oft gesperrt).
  return out.sort((a, b) => versionOf(b.id) - versionOf(a.id) || Number(/flash/.test(b.id)) - Number(/flash/.test(a.id)) || a.id.localeCompare(b.id));
}

/** Sinnvolle Voreinstellung: neuestes stabiles Flash-Modell (nicht "lite", keine Vorschau). */
export function pickDefaultModel(models: ModelInfo[]): string {
  const stable = models.filter((m) => /flash/.test(m.id) && !/lite|preview|exp|thinking/.test(m.id));
  return (stable[0] ?? models.find((m) => /flash/.test(m.id)) ?? models[0])?.id ?? '';
}

// ---------- Dateien hochladen (Files API, 48 h gültig) ----------

const CACHE_KEY = 'lernapp/gemini-files';
type UploadCache = Record<string, { uri: string; mime: string; exp: number }>;

const readCache = (): UploadCache => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const writeCache = (c: UploadCache) => {
  try {
    const now = Date.now();
    for (const k of Object.keys(c)) if (c[k].exp < now) delete c[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* egal */
  }
};

async function uploadFile(key: string, cacheId: string, blob: Blob, mime: string, displayName: string): Promise<{ uri: string; mime: string }> {
  // Hochgeladene Dateien gehören zum Google-Projekt des Schlüssels -> Schlüssel im Cache-Eintrag berücksichtigen.
  const ck = `${key.slice(-8)}:${cacheId}`;
  const cache = readCache();
  const hit = cache[ck];
  if (hit && hit.exp > Date.now()) return hit;

  const start = await api(key, '/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new GeminiError('Hochladen zu Gemini fehlgeschlagen (keine Upload-Adresse).');
  let res: Response;
  try {
    res = await fetch(uploadUrl, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: blob });
  } catch {
    throw new GeminiError('Hochladen zu Gemini fehlgeschlagen. Bist du online?');
  }
  if (!res.ok) throw await toError(res);
  let file = (await res.json()).file as { name: string; uri: string; state?: string; mimeType?: string };

  // Videos u. Ä. werden erst verarbeitet.
  for (let i = 0; file.state === 'PROCESSING' && i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await (await api(key, `/v1beta/${file.name}`)).json();
  }
  if (file.state === 'FAILED') throw new GeminiError(`Gemini konnte „${displayName}“ nicht verarbeiten.`);

  const entry = { uri: file.uri, mime: file.mimeType || mime, exp: Date.now() + 46 * 3600 * 1000 };
  cache[ck] = entry;
  writeCache(cache);
  return entry;
}

// ---------- Unterlagen vorbereiten ----------

export type Part = { text: string } | { file_data: { mime_type: string; file_uri: string } };

export interface Source {
  file: FileItem;
  /** Ordnerpfad, z. B. "Mathe / Analysis". */
  path: string;
}

const NATIVE_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const MAX_TEXT = 400_000;

/** In PNG umwandeln (für Bildformate, die Gemini nicht kennt, z. B. GIF, BMP, SVG). */
async function toPng(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  } catch {
    return null;
  }
}

/**
 * Wandelt die gewählten Dateien in Gemini-Teile um: Text direkt, PDFs/Bilder/Audio/Video per Upload,
 * Office-Dateien als herausgezogener Text. Jede Datei bekommt eine Nummer [Quelle N] für Quellenangaben.
 */
export async function prepareSources(
  key: string,
  sources: Source[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ parts: Part[]; skipped: string[] }> {
  const parts: Part[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const { file, path } = sources[i];
    const name = fullName(file);
    onProgress?.(i, sources.length, name);
    const blob = await db.getBlob(file.blobId);
    if (!blob) {
      skipped.push(name);
      continue;
    }
    const header = `\n[Quelle ${i + 1}] Datei „${name}“ im Ordner „${path}“${file.description ? ` – Beschreibung: ${file.description}` : ''}`;
    const kind = fileKind(file);
    const ext = file.ext.toLowerCase();

    if (kind === 'text' || ext === 'csv') {
      const text = (await blob.text()).slice(0, MAX_TEXT);
      parts.push({ text: `${header}\nInhalt:\n${text}\n[Ende Quelle ${i + 1}]` });
    } else if (kind === 'pdf' || kind === 'audio' || kind === 'video' || (kind === 'image' && NATIVE_IMAGE.includes(file.mime))) {
      const mime = kind === 'pdf' ? 'application/pdf' : file.mime;
      const up = await uploadFile(key, file.blobId, blob, mime, name);
      parts.push({ text: header }, { file_data: { mime_type: up.mime, file_uri: up.uri } });
    } else if (kind === 'image') {
      const png = await toPng(blob);
      if (!png) {
        skipped.push(name);
        continue;
      }
      const up = await uploadFile(key, `${file.blobId}:png`, png, 'image/png', name);
      parts.push({ text: header }, { file_data: { mime_type: up.mime, file_uri: up.uri } });
    } else {
      const text = await extractOfficeText(blob, ext);
      if (!text) {
        skipped.push(name);
        continue;
      }
      parts.push({ text: `${header}\nInhalt (aus der Datei herausgezogener Text):\n${text.slice(0, MAX_TEXT)}\n[Ende Quelle ${i + 1}]` });
    }
  }
  onProgress?.(sources.length, sources.length, '');
  return { parts, skipped };
}

// ---------- Fragen stellen ----------

export const SYSTEM_PROMPT = `Du bist der Lernassistent der App „Lernapp“. Du bekommst Unterlagen des Nutzers – jede ist als [Quelle N] nummeriert – und beantwortest Fragen dazu.

Regeln:
1. Verwende ausschließlich Informationen aus den mitgeschickten Quellen. Fülle keine Lücken mit Allgemeinwissen und rate nie.
2. Steht die Antwort nicht in den Quellen, sag klar: „Das steht nicht in deinen Unterlagen.“ Du darfst nennen, was es an verwandten Informationen gibt.
3. Belege deine Aussagen mit Quellenangaben im Format [Quelle N] bzw. [Quelle N, S. X] oder [Quelle N, Folie X], wenn Seite/Folie bekannt ist.
4. Wirken Unterlagen widersprüchlich oder offensichtlich fehlerhaft, weise auf die Stelle hin, statt sie still aus eigenem Wissen zu korrigieren.
5. Antworte in der Sprache der Frage (meist Deutsch), klar und gut strukturiert. Markdown ist erlaubt (Überschriften, Listen, **fett**). Formeln schreibst du lesbar, z. B. a² + b² = c².
6. Aufgaben wie „fasse zusammen“, „erstelle Lernfragen“ oder „erkläre“ sind erlaubt – aber nur auf Basis der Quellen.`;

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

/** Streamt die Antwort Stück für Stück (Server-Sent Events). */
export async function* streamAnswer(
  key: string,
  model: string,
  sourceParts: Part[],
  history: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const contents = history.map((t, i) =>
    i === 0
      ? { role: 'user', parts: [{ text: 'Hier sind meine Unterlagen:' }, ...sourceParts, { text: `\nMeine Frage: ${t.text}` }] }
      : { role: t.role, parts: [{ text: t.text }] },
  );
  const res = await api(key, `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.2 },
    }),
    signal,
  });
  if (!res.body) throw new GeminiError('Leere Antwort von Gemini.');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let gotText = false;
  let finish = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j: {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
        error?: { message?: string };
      };
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new GeminiError(j.error.message ?? 'Fehler bei Gemini.');
      if (j.promptFeedback?.blockReason) throw new GeminiError('Gemini hat die Anfrage blockiert (Sicherheitsfilter).');
      const c = j.candidates?.[0];
      if (c?.finishReason) finish = c.finishReason;
      for (const p of c?.content?.parts ?? []) {
        if (p.text && !p.thought) {
          gotText = true;
          yield p.text;
        }
      }
    }
  }
  if (!gotText) {
    if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw new GeminiError('Gemini hat die Antwort blockiert (Sicherheitsfilter).');
    if (finish === 'MAX_TOKENS') throw new GeminiError('Die Unterlagen sind zu groß für eine Antwort. Wähle weniger Dateien.');
    throw new GeminiError('Gemini hat keine Antwort geliefert. Bitte noch einmal versuchen.');
  }
  if (finish === 'MAX_TOKENS') yield '\n\n_(Antwort wurde abgeschnitten.)_';
}
