import { useEffect, useState } from 'react';
import { db } from '../storage/db';

// Kleine Bilder (Ordnerbilder, Vorschauen) bleiben im Speicher, damit Listen beim Zurückgehen nicht flackern.
const cache = new Map<string, string>();

/** Lädt einen Blob aus IndexedDB und liefert eine Objekt-URL dafür. */
export function useBlobUrl(id: string | undefined, keep = true): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (id ? cache.get(id) : undefined));

  useEffect(() => {
    if (!id) {
      setUrl(undefined);
      return;
    }
    const hit = cache.get(id);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    let created: string | undefined;
    db.getBlob(id).then((blob) => {
      if (!alive || !blob) return;
      created = URL.createObjectURL(blob);
      if (keep) cache.set(id, created);
      setUrl(created);
    });
    return () => {
      alive = false;
      if (created && !keep) URL.revokeObjectURL(created);
    };
  }, [id, keep]);

  return url;
}
