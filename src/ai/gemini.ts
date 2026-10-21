import { AI_PROXY_URL } from './config';

/*
 * KI über Google Gemini. Die App spricht nicht direkt mit Google, sondern mit unserem Worker (siehe worker/),
 * der den Schlüssel geheim hält. Gesendet wird nur Text aus den gewählten Unterlagen.
 */

export class AiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface Turn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface Request {
  system?: string;
  contents: Turn[];
  temperature?: number;
  maxOutputTokens?: number;
  schema?: object;
  stream?: boolean;
}

async function toError(res: Response): Promise<AiError> {
  let msg = '';
  try {
    msg = (await res.json())?.error?.message ?? '';
  } catch {
    /* kein JSON */
  }
  if (res.status === 429)
    return new AiError('Die KI ist gerade ausgelastet (zu viele Anfragen). Warte eine Minute und versuche es noch einmal.', 429);
  if (res.status === 413) return new AiError('Die Unterlagen sind zu groß. Wähle weniger Dateien.', 413);
  if (res.status === 403) return new AiError('Die KI ist für diese Seite nicht freigegeben.', 403);
  if (res.status >= 500) return new AiError('Die KI ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', res.status);
  return new AiError(msg || `Fehler ${res.status}`, res.status);
}

async function call(req: Request, signal?: AbortSignal): Promise<Response> {
  if (!AI_PROXY_URL) throw new AiError('Die KI ist noch nicht eingerichtet (Server-Adresse fehlt).');
  if (!navigator.onLine) throw new AiError('Du bist offline. Die KI braucht eine Internetverbindung.');
  let res: Response;
  try {
    res = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new AiError('Keine Verbindung zur KI. Bist du online?');
  }
  if (!res.ok) throw await toError(res);
  return res;
}

interface Candidate {
  content?: { parts?: { text?: string; thought?: boolean }[] };
  finishReason?: string;
}
interface GenResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

const BLOCKED = 'Die Anfrage wurde vom Sicherheitsfilter der KI blockiert.';

/** Antwort Stück für Stück. Gibt jeweils den bisherigen Gesamttext zurück. */
export async function* streamText(
  system: string,
  contents: Turn[],
  opts: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const res = await call(
    { system, contents, temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxOutputTokens ?? 2048, stream: true },
    opts.signal,
  );
  if (!res.body) throw new AiError('Leere Antwort von der KI.');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
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
      let j: GenResponse;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new AiError(j.error.message ?? 'Fehler bei der KI.');
      if (j.promptFeedback?.blockReason) throw new AiError(BLOCKED);
      const c = j.candidates?.[0];
      if (c?.finishReason) finish = c.finishReason;
      let added = false;
      for (const p of c?.content?.parts ?? []) {
        if (p.text && !p.thought) {
          text += p.text;
          added = true;
        }
      }
      if (added) yield text;
    }
  }
  if (!text) {
    if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw new AiError(BLOCKED);
    throw new AiError('Die KI hat keine Antwort geliefert. Bitte noch einmal versuchen.');
  }
  if (finish === 'MAX_TOKENS') yield `${text}\n\n_(Antwort wurde abgeschnitten.)_`;
}

/** Erzeugt JSON nach einem Schema (Gemini-Format: OBJECT, ARRAY, STRING, INTEGER …). */
export async function generateJson<T>(
  system: string,
  contents: Turn[],
  schema: object,
  opts: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  const res = await call(
    { system, contents, schema, temperature: opts.temperature ?? 0.6, maxOutputTokens: opts.maxOutputTokens ?? 4096 },
    opts.signal,
  );
  const j = (await res.json()) as GenResponse;
  if (j.promptFeedback?.blockReason) throw new AiError(BLOCKED);
  const txt = (j.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  const m = txt.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
