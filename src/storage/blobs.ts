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
    if (hit) return hit;
    if (!supabase) return undefined;
    const { data, error } = await supabase.storage.from(BUCKET).download(remotePath(id));
    if (error || !data) {
      console.warn('Download fehlgeschlagen', error);
      return undefined;
    }
    await db.putBlob(id, data).catch(() => {});
    return data;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
