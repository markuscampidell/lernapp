import { useSyncExternalStore } from 'react';

/**
 * Entwürfe: ungespeicherte Änderungen aus den Editoren – nur auf diesem Gerät (IndexedDB), nie auf dem Server.
 * Höchstens ein Entwurf pro Datei (bzw. pro „neue Datei dieser Art in diesem Ordner“). Wird beim Speichern oder
 * Verwerfen gelöscht, sonst nach 30 Tagen.
 */
export type DraftKind = 'doc' | 'note' | 'cards' | 'quiz' | 'gaps' | 'chart' | 'wheel';

export interface Draft {
  key: string;
  kind: DraftKind;
  /** Bestehende Datei – oder undefined bei einer neuen, noch nie gespeicherten Datei. */
  fileId?: string;
  folderId?: string;
  /** Stand der Datei, von dem aus bearbeitet wurde (Speicherort des Inhalts) – zum Erkennen fremder Änderungen. */
  base?: string | null;
  name: string;
  description: string;
  /** Was der Editor als Anfangsinhalt bekommt (Karten, Fragen, Dokument-Text …). */
  data: unknown;
  /** Text-Dokumente: Bearbeiten oder nur Zeichnen. */
  mode?: 'edit' | 'draw';
  savedAt: number;
  /** „Wartet“: nicht beim Start automatisch öffnen (z. B. nachdem man sich die fremde Version ansehen wollte). */
  parked?: boolean;
}

export const draftKey = (fileId: string | undefined, folderId: string | undefined, kind: DraftKind) =>
  fileId ? `f:${fileId}` : `n:${folderId ?? ''}:${kind}`;

const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const DB = 'lernapp-entwuerfe';
const STORE = 'drafts';

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r ? (r.result as T) : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Im Speicher gespiegelt, damit Ansichten (z. B. „Du hast noch ungespeicherte Änderungen“) sofort reagieren.
let all: Draft[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadDrafts(): Promise<Draft[]> {
  try {
    const list = ((await tx<Draft[]>('readonly', (s) => s.getAll())) ?? []) as Draft[];
    const now = Date.now();
    const old = list.filter((d) => now - d.savedAt > MAX_AGE);
    if (old.length) await tx('readwrite', (s) => void old.forEach((d) => s.delete(d.key)));
    all = list.filter((d) => now - d.savedAt <= MAX_AGE).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    all = [];
  }
  loaded = true;
  emit();
  return all;
}

export async function putDraft(d: Draft): Promise<void> {
  all = [d, ...all.filter((x) => x.key !== d.key)];
  emit();
  try {
    await tx('readwrite', (s) => s.put(d));
  } catch {
    /* Speicher voll o. Ä. – dann gibt es eben keinen Entwurf */
  }
}

export async function deleteDraft(key: string): Promise<void> {
  if (!all.some((d) => d.key === key)) {
    // Evtl. noch nicht geladen – trotzdem löschen.
    if (loaded) return;
  }
  all = all.filter((d) => d.key !== key);
  emit();
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    /* egal */
  }
}

export async function parkDraft(key: string): Promise<void> {
  const d = all.find((x) => x.key === key);
  if (d && !d.parked) await putDraft({ ...d, parked: true });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useDrafts = () => useSyncExternalStore(subscribe, () => all);
export const findDraft = (key: string) => all.find((d) => d.key === key);
