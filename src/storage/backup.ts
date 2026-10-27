import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import type { FileItem, Folder } from '../domain/types';
import { pathOf } from '../domain/tree';
import { fullName, kindOf } from '../lib/files';
import { newId } from '../lib/id';
import { db, write } from './db';

const MANIFEST = 'lernapp-backup.json';

interface Manifest {
  app: 'lernapp';
  version: 1;
  exportedAt: string;
  folders: Folder[];
  files: (FileItem & { path: string })[];
  /** Pfade der übrigen Blobs (Ordnerbilder, Vorschauen) im Archiv. */
  blobs: Record<string, string>;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '_';

/** Alles als ZIP: Dateien liegen in lesbaren Ordnerpfaden, dazu eine JSON-Datei zum Wiederherstellen. */
export async function exportBackup(onProgress?: (msg: string) => void): Promise<Blob> {
  const { folders, files } = await db.loadAll();
  const entries: Zippable = {};
  const used = new Set<string>();
  const unique = (p: string) => {
    let out = p;
    let n = 2;
    while (used.has(out.toLowerCase())) {
      const dot = p.lastIndexOf('.');
      out = dot > p.lastIndexOf('/') ? `${p.slice(0, dot)} (${n})${p.slice(dot)}` : `${p} (${n})`;
      n++;
    }
    used.add(out.toLowerCase());
    return out;
  };

  const manifestFiles: Manifest['files'] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(`Datei ${i + 1} von ${files.length} …`);
    const blob = await db.getBlob(f.blobId);
    if (!blob) continue;
    const dir = pathOf(folders, f.folderId).map((p) => safe(p.name)).join('/');
    const path = unique(`Dateien/${dir}/${safe(fullName(f))}`);
    const kind = kindOf(f.mime, f.ext);
    // Bereits komprimierte Formate nur speichern, Text etc. komprimieren.
    const level = kind === 'text' || kind === 'flashcards' || kind === 'quiz' || kind === 'document' || kind === 'spreadsheet' || kind === 'other' ? 6 : 0;
    entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level }];
    manifestFiles.push({ ...f, path });
  }

  const blobs: Manifest['blobs'] = {};
  const extra = [...folders.map((f) => f.imageId), ...files.map((f) => f.thumbId)].filter(Boolean) as string[];
  for (const id of extra) {
    const b = await db.getBlob(id);
    if (!b) continue;
    const path = `_intern/${id}.jpg`;
    entries[path] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    blobs[id] = path;
  }

  const manifest: Manifest = { app: 'lernapp', version: 1, exportedAt: new Date().toISOString(), folders, files: manifestFiles, blobs };
  entries[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));

  onProgress?.('ZIP wird erstellt …');
  const data = await new Promise<Uint8Array>((res, rej) => zip(entries, (err, out) => (err ? rej(err) : res(out))));
  return new Blob([data], { type: 'application/zip' });
}

/**
 * Stellt ein Backup wieder her.
 * replaceAll = true: vorhandene Daten werden vorher gelöscht. Sonst wird das Backup zusätzlich (als Kopie) hinzugefügt.
 */
export async function importBackup(file: Blob, replaceAll: boolean): Promise<{ folders: number; files: number }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const unzipped = await new Promise<Unzipped>((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  const raw = unzipped[MANIFEST];
  if (!raw) throw new Error('Das ist kein Lernapp-Backup (lernapp-backup.json fehlt).');
  const m = JSON.parse(strFromU8(raw)) as Manifest;
  if (m.app !== 'lernapp') throw new Error('Das ist kein Lernapp-Backup.');

  // Beim Hinzufügen neue IDs vergeben, damit nichts überschrieben wird.
  const ids = new Map<string, string>();
  const map = (id: string) => {
    if (replaceAll) return id;
    if (!ids.has(id)) ids.set(id, newId());
    return ids.get(id)!;
  };

  if (replaceAll) await db.clearAll();

  const folders: Folder[] = m.folders.map((f) => ({
    ...f,
    id: map(f.id),
    parentId: f.parentId ? map(f.parentId) : null,
    imageId: f.imageId && m.blobs[f.imageId] ? map(f.imageId) : undefined,
    // Platzhalter geteilter Ordner nur beim vollständigen Ersetzen behalten (sonst wären es neue, verwaiste IDs).
    shareId: replaceAll ? f.shareId : undefined,
  }));
  await write(['folders', 'blobs'], (s) => {
    folders.forEach((f) => s.folders.put(f));
    m.folders.forEach((f) => {
      const data = f.imageId && unzipped[m.blobs[f.imageId]];
      if (data && f.imageId) s.blobs.put(new Blob([data], { type: 'image/jpeg' }), map(f.imageId));
    });
  });

  let count = 0;
  for (const f of m.files) {
    const data = unzipped[f.path];
    if (!data) continue;
    const { path: _path, ...rest } = f;
    void _path;
    const thumbData = f.thumbId ? unzipped[m.blobs[f.thumbId]] : undefined;
    const item: FileItem = {
      ...rest,
      id: map(f.id),
      folderId: map(f.folderId),
      blobId: map(f.blobId),
      thumbId: thumbData && f.thumbId ? map(f.thumbId) : undefined,
    };
    await write(['files', 'blobs'], (s) => {
      s.blobs.put(new Blob([data], { type: f.mime }), item.blobId);
      if (thumbData && item.thumbId) s.blobs.put(new Blob([thumbData], { type: 'image/jpeg' }), item.thumbId);
      s.files.put(item);
    });
    count++;
  }
  return { folders: folders.length, files: count };
}
