// Lernstand bei Karteikarten („Wiederholen“): jede Karte hat pro Person eine Stufe (Box) und ein Datum, wann sie wieder drankommt.
// Gewusst -> nächste Stufe, längerer Abstand (1, 3, 7, 14, 30, 60 Tage). Unsicher -> morgen nochmal. Nicht gewusst -> zurück auf Anfang.
// Liegt die Datei auf dem Server (geteilt / „Auf allen Geräten“), gilt der Lernstand fürs Konto auf allen Geräten, sonst nur auf diesem Gerät.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { db } from '../../storage/db';
import { supabase } from '../../cloud/supabase';

export interface Progress {
  box: number;
  /** Zeitpunkt (ms), ab dem die Karte wieder fällig ist. */
  due: number;
}
export type Grade = 'again' | 'hard' | 'good';
export type ProgressMap = Record<string, Progress>;

export const MAX_BOX = 6;
const DAY = 24 * 3600_000;
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60];

export function nextProgress(p: Progress | undefined, grade: Grade, now = Date.now()): Progress {
  const box = p?.box ?? 0;
  if (grade === 'again') return { box: 0, due: now };
  if (grade === 'hard') return { box: Math.max(1, Math.min(box, MAX_BOX)), due: now + DAY };
  const next = Math.min(MAX_BOX, box + 1);
  return { box: next, due: now + INTERVAL_DAYS[next] * DAY };
}

/** Fällig = nie gelernt oder Datum erreicht (ganzer Tag zählt: was heute fällig wird, kommt schon heute). */
export function isDue(p: Progress | undefined, now = Date.now()): boolean {
  if (!p) return true;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return p.due <= end.getTime();
}

/** Wann die nächste Karte fällig wird (für „Nächste Wiederholung …“). */
export function nextDue(map: ProgressMap, ids: string[]): number | null {
  let min: number | null = null;
  for (const id of ids) {
    const p = map[id];
    if (p && (min === null || p.due < min)) min = p.due;
  }
  return min;
}

// ---------- Speicher ----------
interface Pending {
  fileId: string;
  cardId: string;
  box: number;
  due: number;
}
const cacheKey = (fileId: string, scope: string) => `progress:${fileId}:${scope}`;
const PENDING = 'progress-pending';
const readMeta = async <T,>(key: string, fallback: T): Promise<T> => ((await db.getMeta<T>(key).catch(() => undefined)) ?? fallback) as T;
const writeMeta = (key: string, value: unknown) => db.setMeta(key, value).catch(() => {});

let missing = false;
const isMissing = (msg: string) => /card_progress|relation|schema cache|does not exist/i.test(msg);

async function push(p: Pending): Promise<void> {
  if (!supabase) throw new Error('offline');
  const res = await supabase
    .from('card_progress')
    .upsert({ file_id: p.fileId, card_id: p.cardId, box: p.box, due: new Date(p.due).toISOString() }, { onConflict: 'file_id,user_id,card_id' });
  if (res.error) {
    if (isMissing(res.error.message)) missing = true;
    throw new Error(res.error.message);
  }
}

let flushing: Promise<void> | null = null;
function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const list = await readMeta<Pending[]>(PENDING, []);
    if (!list.length || !supabase) return;
    const rest: Pending[] = [];
    for (const p of list) {
      try {
        await push(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (/fetch|network|Load failed|offline/i.test(msg) || missing) rest.push(p);
      }
    }
    await writeMeta(PENDING, rest);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Lernstand einer Karteikarten-Datei laden und Antworten speichern. */
export function useCardProgress(file: FileItem) {
  const { me } = useLibrary();
  const cloud = !!(file.shareId && me && supabase);
  const scope = cloud ? me!.id : 'geraet';
  const [map, setMap] = useState<ProgressMap>({});
  const [notReady, setNotReady] = useState(false);
  const mapRef = useRef(map);
  mapRef.current = map;

  const load = useCallback(async () => {
    const cached = await readMeta<ProgressMap>(cacheKey(file.id, scope), {});
    setMap(cached);
    if (!cloud || !supabase) return;
    await flush();
    const res = await supabase.from('card_progress').select('card_id, box, due').eq('file_id', file.id).eq('user_id', me!.id);
    if (res.error) {
      if (isMissing(res.error.message)) missing = true;
      setNotReady(missing);
      return;
    }
    missing = false;
    setNotReady(false);
    const server: ProgressMap = {};
    for (const r of (res.data ?? []) as { card_id: string; box: number; due: string }[]) server[r.card_id] = { box: r.box, due: Date.parse(r.due) };
    // Noch nicht hochgeladene Antworten gewinnen.
    for (const p of await readMeta<Pending[]>(PENDING, [])) if (p.fileId === file.id) server[p.cardId] = { box: p.box, due: p.due };
    setMap(server);
    writeMeta(cacheKey(file.id, scope), server);
  }, [file.id, scope, cloud, me]);

  useEffect(() => {
    load();
  }, [load]);

  const record = useCallback(
    async (cardId: string, grade: Grade) => {
      const p = nextProgress(mapRef.current[cardId], grade);
      const next = { ...mapRef.current, [cardId]: p };
      mapRef.current = next;
      setMap(next);
      writeMeta(cacheKey(file.id, scope), next);
      if (!cloud) return;
      const item: Pending = { fileId: file.id, cardId, box: p.box, due: p.due };
      try {
        await push(item);
      } catch {
        const list = (await readMeta<Pending[]>(PENDING, [])).filter((x) => !(x.fileId === file.id && x.cardId === cardId));
        await writeMeta(PENDING, [...list, item]);
        setNotReady(missing);
      }
    },
    [file.id, scope, cloud],
  );

  /** Lernstand dieser Datei zurücksetzen (alle Karten wieder neu). */
  const reset = useCallback(
    async () => {
      setMap({});
      mapRef.current = {};
      writeMeta(cacheKey(file.id, scope), {});
      if (cloud && supabase) await supabase.from('card_progress').delete().eq('file_id', file.id).eq('user_id', me!.id);
    },
    [file.id, scope, cloud, me],
  );

  return { map, record, reset, notReady };
}
