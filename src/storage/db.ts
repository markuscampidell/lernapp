import type { FileItem, Folder, InboxItem } from '../domain/types';

// Muss zu public/sw.js passen (der Service Worker schreibt geteilte Dateien in "inbox").
const DB_NAME = 'lernapp';
const DB_VERSION = 1;

type StoreName = 'folders' | 'files' | 'blobs' | 'inbox';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['folders', 'files', 'inbox']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Datenbank ist blockiert – bitte andere Tabs der App schließen.'));
    });
  }
  return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

/** Mehrere Schreibvorgänge in einer Transaktion (alles oder nichts). */
export async function write(
  stores: StoreName[],
  fn: (s: Record<StoreName, IDBObjectStore>) => void,
): Promise<void> {
  const db = await open();
  const tx = db.transaction(stores, 'readwrite');
  const map = Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])) as Record<StoreName, IDBObjectStore>;
  fn(map);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen'));
  });
}

export const db = {
  loadAll: async () => {
    const [folders, files] = await Promise.all([getAll<Folder>('folders'), getAll<FileItem>('files')]);
    return { folders, files };
  },
  getBlob: async (id: string): Promise<Blob | undefined> => {
    const d = await open();
    return wrap(d.transaction('blobs').objectStore('blobs').get(id) as IDBRequest<Blob | undefined>);
  },
  inbox: () => getAll<InboxItem>('inbox'),
  removeInbox: (ids: string[]) => write(['inbox'], (s) => ids.forEach((id) => s.inbox.delete(id))),
  clearAll: () =>
    write(['folders', 'files', 'blobs', 'inbox'], (s) => {
      s.folders.clear();
      s.files.clear();
      s.blobs.clear();
      s.inbox.clear();
    }),
};
