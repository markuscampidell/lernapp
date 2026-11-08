// Offline-Unterstützung: Die App-Hülle wird zwischengespeichert, damit die installierte App ohne Netz startet.
// VERSION erhöhen, damit Clients nach einem Deploy alte Caches verwerfen.
const VERSION = 'v25';
const CACHE = `lernapp-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Muss zu src/storage/db.ts passen.
const DB_NAME = 'lernapp';
const DB_VERSION = 1;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ---------- Teilen-Ziel (Android: "Teilen" -> Lernapp) ----------
// Geteilte Dateien landen im "inbox"-Speicher; der Hochladen-Tab holt sie dort ab.
function openDb() {
  return new Promise((resolve, reject) => {
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
  });
}

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string');
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n').trim();
    const db = await openDb();
    const tx = db.transaction('inbox', 'readwrite');
    const store = tx.objectStore('inbox');
    const now = Date.now();
    files.forEach((file, i) => {
      store.put({ id: `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`, file, name: file.name, type: file.type, addedAt: now });
    });
    // Geteilter Text/Link ohne Datei wird als .txt-Datei übernommen.
    if (files.length === 0 && text) {
      const file = new File([text], 'Geteilter Text.txt', { type: 'text/plain' });
      store.put({ id: `${now}-text`, file, name: file.name, type: file.type, addedAt: now });
    }
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.error('Teilen fehlgeschlagen', err);
  }
  return Response.redirect('./#hochladen', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(req));
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Seiten: zuerst Netz (damit Updates ankommen), offline die gespeicherte Hülle.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Assets (gehashte Dateinamen, Icons): zuerst Cache, dann Netz und speichern.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// ---------- Push-Benachrichtigungen ----------
// Kommen von der Supabase Edge Function "push" (supabase/functions/push). Inhalt: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lernapp', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '#ordner' },
    }),
  );
});

// Antippen: offene App nach vorne holen und dorthin wechseln – sonst die App neu öffnen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.url) || '#ordner';
  const target = new URL('./' + hash, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((c) => c.url.startsWith(self.registration.scope));
      if (client) {
        await client.focus().catch(() => {});
        client.postMessage({ type: 'lernapp:open', hash });
        return;
      }
      return self.clients.openWindow(target);
    }),
  );
});
