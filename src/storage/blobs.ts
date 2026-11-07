import { db } from './db';
import { BUCKET, supabase } from '../cloud/supabase';

/** Präfix für Blobs geteilter Dateien: "r:" + Pfad im Supabase-Speicher. */
export const REMOTE = 'r:';
export const isRemoteBlob = (id: string) => id.startsWith(REMOTE);
export const remotePath = (id: string) => id.slice(REMOTE.length);

const inflight = new Map<string, Promise<Blob | undefined>>();

/**
 * Lädt einen Blob: lokale direkt aus IndexedDB, geteilte zuerst aus dem Zwischenspeicher, sonst vom Server
 * (und speichert sie dann auf dem Gerät, damit sie offline lesbar sind).
 */
export function loadBlob(id: string): Promise<Blob | undefined> {
  if (!isRemoteBlob(id)) return db.getBlob(id);
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    const hit = await db.getBlob(id).catch(() => undefined);
    if (hit) {
      touch(id, hit.size);
      return hit;
    }
    if (!supabase) return undefined;
    const { data, error } = await supabase.storage.from(BUCKET).download(remotePath(id));
    if (error || !data) {
      console.warn('Download fehlgeschlagen', error);
      return undefined;
    }
    await cacheBlob(id, data);
    return data;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

// ---------- Zwischenspeicher für geteilte Dateien (begrenzt) ----------
// Geöffnete geteilte Dateien bleiben auf dem Gerät, aber nur bis zu einer Obergrenze. Ist sie erreicht,
// fliegen die am längsten nicht mehr geöffneten raus (sie liegen ja weiter auf dem Server).
// „Meine Ordner“ werden hier nie angefasst – so füllt das Stöbern in geteilten Ordnern nicht den Speicher,
// bis der Browser womöglich alles löscht.

const INDEX_KEY = 'remote-cache';
const MAX_CACHE = 1024 * 1024 * 1024; // höchstens 1 GB …
const QUOTA_SHARE = 0.2; // … und höchstens 20 % des Browser-Speichers
const FALLBACK_CACHE = 300 * 1024 * 1024;

type Index = Record<string, { size: number; used: number }>;
let index: Promise<Index> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let limitPromise: Promise<number> | null = null;

function loadIndex(): Promise<Index> {
  if (!index) {
    index = (async () => {
      const saved = await db.getMeta<Index>(INDEX_KEY).catch(() => undefined);
      if (saved) return saved;
      // Erstes Mal: bereits vorhandene Dateien aufnehmen (gelten als „lange nicht geöffnet“).
      const idx: Index = {};
      for (const b of await db.blobSizes(REMOTE).catch(() => [])) idx[b.id] = { size: b.size, used: 0 };
      return idx;
    })();
  }
  return index;
}

function saveIndexSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    loadIndex().then((idx) => db.setMeta(INDEX_KEY, idx)).catch(() => {});
  }, 1000);
}

/** Wie viel Platz geteilte Dateien auf diesem Gerät höchstens belegen dürfen. */
export function cacheLimit(): Promise<number> {
  if (!limitPromise) {
    limitPromise = (async () => {
      const quota = (await navigator.storage?.estimate?.().catch(() => undefined))?.quota ?? 0;
      return quota > 0 ? Math.min(MAX_CACHE, quota * QUOTA_SHARE) : FALLBACK_CACHE;
    })();
  }
  return limitPromise;
}

/** Aktuelle Größe des Zwischenspeichers in Bytes. */
export async function cacheSize(): Promise<number> {
  const idx = await loadIndex();
  return Object.values(idx).reduce((n, e) => n + e.size, 0);
}

function touch(id: string, size: number) {
  loadIndex()
    .then((idx) => {
      idx[id] = { size, used: Date.now() };
      saveIndexSoon();
    })
    .catch(() => {});
}

/** Legt eine geteilte Datei im Zwischenspeicher ab und räumt danach ggf. alte Dateien weg. */
export async function cacheBlob(id: string, blob: Blob): Promise<void> {
  try {
    const limit = await cacheLimit();
    if (blob.size > limit / 2) return; // riesige Einzeldateien nicht behalten
    await db.putBlob(id, blob);
    const idx = await loadIndex();
    idx[id] = { size: blob.size, used: Date.now() };
    await trim(limit, id);
    saveIndexSoon();
  } catch {
    // Zwischenspeichern ist optional – die Datei wird trotzdem angezeigt.
  }
}

async function trim(limit: number, keep: string) {
  const idx = await loadIndex();
  let total = Object.values(idx).reduce((n, e) => n + e.size, 0);
  if (total <= limit) return;
  const oldest = Object.entries(idx)
    .filter(([id]) => id !== keep)
    .sort((a, b) => a[1].used - b[1].used);
  const drop: string[] = [];
  // Etwas Luft lassen (bis 80 %), damit nicht bei jeder Datei aufgeräumt wird.
  for (const [id, e] of oldest) {
    if (total <= limit * 0.8) break;
    drop.push(id);
    total -= e.size;
  }
  if (!drop.length) return;
  await db.deleteBlobs(drop);
  for (const id of drop) delete idx[id];
}

/** Aus dem Zwischenspeicher entfernte Dateien vergessen (z. B. nach dem Löschen auf dem Server). */
export async function forgetCached(ids: string[]): Promise<void> {
  await db.deleteBlobs(ids);
  const idx = await loadIndex().catch(() => undefined);
  if (idx) {
    for (const id of ids) delete idx[id];
    saveIndexSoon();
  }
}

/** Ganzen Zwischenspeicher leeren (z. B. beim Abmelden). */
export async function clearCache(): Promise<void> {
  await db.deleteBlobsWithPrefix(REMOTE);
  index = Promise.resolve({});
  await db.setMeta(INDEX_KEY, {}).catch(() => {});
}
