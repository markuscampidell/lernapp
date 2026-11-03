// Häkchen in Checklisten. Sie stehen NICHT im Dokument selbst, damit jede Person ihre eigenen haben kann:
// - "jeder für sich": Häkchen gehören dem Konto (auf allen seinen Geräten gleich),
// - "gemeinsam": alle Mitglieder des geteilten Ordners teilen dieselben Häkchen.
// Liegt das Dokument nur auf diesem Gerät, bleiben die Häkchen auch nur hier.
// Offline gesetzte Häkchen werden gemerkt und später hochgeladen.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { db } from '../../storage/db';
import { supabase } from '../../cloud/supabase';

/** Häkchen-Zustand: Punkt-ID -> erledigt. */
export type Marks = Record<string, boolean>;
export interface CheckState {
  mine: Marks;
  all: Marks;
}

const ALL = 'alle';
const LOCAL_USER = 'geraet';

interface Pending {
  fileId: string;
  scope: string;
  itemId: string;
  done: boolean;
}

const cacheKey = (fileId: string, scope: string) => `checks:${fileId}:${scope}`;
const PENDING_KEY = 'checks-pending';

async function readCache(fileId: string, scope: string): Promise<Marks> {
  return ((await db.getMeta<Marks>(cacheKey(fileId, scope)).catch(() => undefined)) ?? {}) as Marks;
}
const writeCache = (fileId: string, scope: string, marks: Marks) => db.setMeta(cacheKey(fileId, scope), marks).catch(() => {});

async function readPending(): Promise<Pending[]> {
  return (await db.getMeta<Pending[]>(PENDING_KEY).catch(() => undefined)) ?? [];
}
const writePending = (list: Pending[]) => db.setMeta(PENDING_KEY, list).catch(() => {});

/** true, solange supabase/005_checklisten.sql fehlt (dann nur lokal speichern). */
let serverMissing = false;
const isMissing = (msg: string) => /checks|relation|schema cache|does not exist/i.test(msg);

async function pushOne(p: Pending): Promise<void> {
  if (!supabase) throw new Error('offline');
  const res = await supabase
    .from('checks')
    .upsert({ file_id: p.fileId, scope: p.scope, item_id: p.itemId, done: p.done }, { onConflict: 'file_id,scope,item_id' });
  if (res.error) {
    if (isMissing(res.error.message)) serverMissing = true;
    throw new Error(res.error.message);
  }
}

let flushing: Promise<void> | null = null;
/** Offline gesetzte Häkchen hochladen. Gelöschte Dateien/fehlende Rechte werden verworfen. */
export function flushPending(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const list = await readPending();
    if (!list.length || !supabase) return;
    const rest: Pending[] = [];
    for (const p of list) {
      try {
        await pushOne(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        // Nur bei Netzwerkproblemen behalten – sonst (keine Rechte, Datei weg) verwerfen.
        if (/fetch|network|Load failed|offline/i.test(msg) || serverMissing) rest.push(p);
      }
    }
    await writePending(rest);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function fetchServer(fileId: string, uid: string): Promise<CheckState | null> {
  if (!supabase) return null;
  const res = await supabase.from('checks').select('scope, item_id, done').eq('file_id', fileId);
  if (res.error) {
    if (isMissing(res.error.message)) serverMissing = true;
    return null;
  }
  serverMissing = false;
  const out: CheckState = { mine: {}, all: {} };
  for (const r of (res.data ?? []) as { scope: string; item_id: string; done: boolean }[]) {
    if (r.scope === ALL) out.all[r.item_id] = r.done;
    else if (r.scope === uid) out.mine[r.item_id] = r.done;
  }
  return out;
}

/**
 * Häkchen eines Dokuments laden, live halten und setzen.
 * Ohne Datei (neues, noch nicht gespeichertes Dokument) gibt es keine Häkchen.
 */
export function useChecks(file?: FileItem) {
  const { me } = useLibrary();
  const fileId = file?.id;
  const cloud = !!(file?.shareId && me && supabase);
  const mineScope = cloud ? me!.id : LOCAL_USER;
  const [state, setState] = useState<CheckState>({ mine: {}, all: {} });
  const [notReady, setNotReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!fileId) return;
    const [mine, all] = await Promise.all([readCache(fileId, mineScope), readCache(fileId, ALL)]);
    setState({ mine, all });
    if (!cloud) return;
    await flushPending();
    const server = await fetchServer(fileId, me!.id);
    setNotReady(serverMissing);
    if (!server) return;
    // Noch nicht hochgeladene eigene Änderungen gewinnen.
    for (const p of await readPending()) {
      if (p.fileId !== fileId) continue;
      if (p.scope === ALL) server.all[p.itemId] = p.done;
      else if (p.scope === me!.id) server.mine[p.itemId] = p.done;
    }
    setState(server);
    writeCache(fileId, mineScope, server.mine);
    writeCache(fileId, ALL, server.all);
  }, [fileId, cloud, mineScope, me]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: Änderungen von anderen Geräten/Personen.
  useEffect(() => {
    if (!cloud || !fileId || !supabase) return;
    const client = supabase;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    const channel = client
      .channel(`checks-${fileId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checks', filter: `file_id=eq.${fileId}` }, soon)
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', soon);
    return () => {
      clearTimeout(timer);
      client.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', soon);
    };
  }, [cloud, fileId, load]);

  /** Punkt abhaken/zurücksetzen. shared = Liste ist "gemeinsam". */
  const toggle = useCallback(
    async (itemId: string, shared: boolean) => {
      if (!fileId) return;
      const key = shared ? 'all' : 'mine';
      const done = !stateRef.current[key][itemId];
      const marks = { ...stateRef.current[key], [itemId]: done };
      setState((s) => ({ ...s, [key]: marks }));
      const scope = shared ? ALL : mineScope;
      writeCache(fileId, scope, marks);
      if (!cloud) return;
      const p: Pending = { fileId, scope, itemId, done };
      try {
        await pushOne(p);
      } catch {
        // Später erneut versuchen (z. B. offline).
        const list = (await readPending()).filter((x) => !(x.fileId === fileId && x.scope === scope && x.itemId === itemId));
        await writePending([...list, p]);
        setNotReady(serverMissing);
      }
    },
    [fileId, mineScope, cloud],
  );

  const isDone = useCallback((itemId: string, shared: boolean) => !!state[shared ? 'all' : 'mine'][itemId], [state]);

  return { state, isDone, toggle, enabled: !!fileId, cloud, notReady };
}

/** Alle Checklisten-Punkte in einem Element mit ihrem Zustand markieren (Klasse "done"). */
export function applyChecks(root: HTMLElement, isDone: (id: string, shared: boolean) => boolean) {
  root.querySelectorAll<HTMLLIElement>('ul.checklist > li').forEach((li) => {
    const id = li.dataset.id;
    const shared = li.parentElement?.dataset.shared === '1';
    li.classList.toggle('done', !!id && isDone(id, shared));
  });
}

/** Checklisten-Punkt, auf dessen Kästchen geklickt wurde (links neben dem Text), sonst null. */
export function checkboxHit(e: { target: EventTarget | null; clientX: number }, anywhere = false): HTMLLIElement | null {
  const t = e.target as HTMLElement | null;
  if (!t?.closest || t.closest('a, span.math, figure')) return null;
  const li = t.closest('ul.checklist > li') as HTMLLIElement | null;
  if (!li) return null;
  if (anywhere) return li;
  const r = li.getBoundingClientRect();
  return e.clientX < r.left + 2 && e.clientX > r.left - 34 ? li : null;
}
