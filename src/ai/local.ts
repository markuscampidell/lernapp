import { useSyncExternalStore } from 'react';
import type { ChatCompletionMessageParam, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { getModelKey, type ModelKey } from './settings';

/*
 * Lokale KI: ein kleines Sprachmodell (Qwen3, Apache-2.0-Lizenz) läuft direkt im Browser über WebGPU.
 * Kein Konto, kein Schlüssel, nichts verlässt das Gerät. Das Modell wird einmalig heruntergeladen
 * (von Hugging Face) und danach vom Browser gespeichert.
 */

export interface ModelOption {
  key: ModelKey;
  base: string;
  label: string;
  size: string;
  hint: string;
}

export const MODELS: ModelOption[] = [
  { key: 'mini', base: 'Qwen3-0.6B', label: 'Mini', size: 'ca. 0,4 GB', hint: 'Für ältere Handys. Schnell, aber einfache Antworten.' },
  { key: 'standard', base: 'Qwen3-1.7B', label: 'Standard', size: 'ca. 1 GB', hint: 'Empfohlen für die meisten Handys.' },
  { key: 'stark', base: 'Qwen3-4B', label: 'Stark', size: 'ca. 2,3 GB', hint: 'Beste Qualität. Für PCs und neue Handys mit viel Speicher.' },
];

// ---------- WebGPU ----------

export interface GpuInfo {
  ok: boolean;
  f16: boolean;
  reason?: string;
}

let gpuInfo: Promise<GpuInfo> | null = null;

export function checkGpu(): Promise<GpuInfo> {
  if (!gpuInfo) {
    gpuInfo = (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu;
      if (!gpu)
        return {
          ok: false,
          f16: false,
          reason: 'Dein Browser unterstützt WebGPU nicht, das die lokale KI braucht. Nutze ein aktuelles Chrome oder Edge (Android oder PC) oder Safari ab iOS 26.',
        };
      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) return { ok: false, f16: false, reason: 'Auf diesem Gerät wurde keine passende Grafikeinheit für die KI gefunden.' };
        return { ok: true, f16: adapter.features.has('shader-f16') };
      } catch {
        return { ok: false, f16: false, reason: 'WebGPU konnte nicht gestartet werden.' };
      }
    })();
  }
  return gpuInfo;
}

export async function modelIdFor(key: ModelKey): Promise<string> {
  const base = MODELS.find((m) => m.key === key)!.base;
  const { f16 } = await checkGpu();
  return `${base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}

// ---------- Zustand (für die Oberfläche) ----------

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  text: string;
  modelId: string;
  error?: string;
}

let state: EngineState = { status: 'idle', progress: 0, text: '', modelId: '' };
const listeners = new Set<() => void>();
const set = (p: Partial<EngineState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
export const useEngineState = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

// ---------- Modell laden ----------

let engine: WebWorkerMLCEngine | null = null;
let worker: Worker | null = null;
let loading: Promise<WebWorkerMLCEngine> | null = null;

const webllm = () => import('@mlc-ai/web-llm');

export async function isDownloaded(key: ModelKey): Promise<boolean> {
  try {
    const { hasModelInCache } = await webllm();
    return await hasModelInCache(await modelIdFor(key));
  } catch {
    return false;
  }
}

export async function deleteModel(key: ModelKey) {
  const id = await modelIdFor(key);
  if (state.modelId === id) await unload();
  const { deleteModelAllInfoInCache } = await webllm();
  await deleteModelAllInfoInCache(id);
}

export async function unload() {
  try {
    await engine?.unload();
  } catch {
    /* egal */
  }
  worker?.terminate();
  engine = null;
  worker = null;
  loading = null;
  set({ status: 'idle', progress: 0, text: '', modelId: '' });
}

function friendlyLoadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/quota|storage|space/i.test(msg)) return 'Nicht genug Speicherplatz für das KI-Modell. Gib Speicher frei oder wähle ein kleineres Modell.';
  if (/fetch|network|Failed to fetch|load/i.test(msg)) return 'Das KI-Modell konnte nicht geladen werden. Bist du online? (Nur der erste Download braucht Internet.)';
  if (/memory|OOM|device lost|allocate/i.test(msg)) return 'Zu wenig Arbeitsspeicher für dieses Modell. Wähle in den Einstellungen ein kleineres Modell.';
  return `Die KI konnte nicht gestartet werden: ${msg}`;
}

/** Lädt (bzw. startet) das gewählte Modell. Mehrfache Aufrufe teilen sich denselben Ladevorgang. */
export async function ensureEngine(): Promise<WebWorkerMLCEngine> {
  const id = await modelIdFor(getModelKey());
  if (engine && state.modelId === id && state.status === 'ready') return engine;
  if (loading && state.modelId === id) return loading;
  if (engine && state.modelId !== id) await unload();

  const gpu = await checkGpu();
  if (!gpu.ok) {
    set({ status: 'error', error: gpu.reason });
    throw new Error(gpu.reason);
  }

  set({ status: 'loading', progress: 0, text: 'KI wird gestartet …', modelId: id, error: undefined });
  loading = (async () => {
    try {
      const { CreateWebWorkerMLCEngine } = await webllm();
      worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
      const e = await CreateWebWorkerMLCEngine(worker, id, {
        initProgressCallback: (r) => {
          const fetching = /fetch|download|Loading model from cache/i.test(r.text);
          set({
            progress: r.progress,
            text: fetching ? `KI-Modell wird geladen … ${Math.round(r.progress * 100)} %` : 'KI wird vorbereitet …',
          });
        },
      });
      engine = e;
      set({ status: 'ready', progress: 1, text: '' });
      return e;
    } catch (err) {
      worker?.terminate();
      worker = null;
      engine = null;
      const msg = friendlyLoadError(err);
      set({ status: 'error', error: msg, text: '' });
      throw new Error(msg);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function interrupt() {
  engine?.interruptGenerate();
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/** Antwort Stück für Stück. Gibt jeweils den bisherigen Gesamttext zurück. */
export async function* chatStream(messages: ChatCompletionMessageParam[], maxTokens = 700): AsyncGenerator<string> {
  const e = await ensureEngine();
  const stream = await e.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: maxTokens,
    extra_body: { enable_thinking: false },
  });
  let raw = '';
  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta?.content;
    if (d) {
      raw += d;
      yield stripThink(raw);
    }
  }
}

/** Erzeugt JSON nach einem Schema (eingeschränkte Ausgabe, damit auch kleine Modelle gültiges JSON liefern). */
export async function generateJson<T>(messages: ChatCompletionMessageParam[], schema: object, maxTokens = 600): Promise<T | null> {
  const e = await ensureEngine();
  const parse = (txt: string | null | undefined): T | null => {
    if (!txt) return null;
    const m = stripThink(txt).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  };
  try {
    const r = await e.chat.completions.create({
      messages,
      temperature: 0.5,
      max_tokens: maxTokens,
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      extra_body: { enable_thinking: false },
    });
    const out = parse(r.choices[0]?.message?.content);
    if (out) return out;
  } catch (err) {
    console.warn('JSON-Modus fehlgeschlagen, versuche ohne', err);
  }
  const r = await e.chat.completions.create({ messages, temperature: 0.5, max_tokens: maxTokens, extra_body: { enable_thinking: false } });
  return parse(r.choices[0]?.message?.content);
}
