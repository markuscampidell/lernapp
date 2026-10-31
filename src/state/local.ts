// Speichern auf dem Gerät (IndexedDB). Die Funktionen ändern nur die Datenbank – der Library-Zustand lädt danach neu.
import type { FileItem, Folder } from '../domain/types';
import { subtreeIds } from '../domain/tree';
import { db, write } from '../storage/db';
import { newId } from '../lib/id';
import { kindOf, makeThumbnail, splitName } from '../lib/files';
import type { Bundle, FolderInput, NewFileInput } from './bundle';

export interface LocalData {
  folders: Folder[];
  files: FileItem[];
}

const now = () => new Date().toISOString();
export const clean = (s?: string) => (s ?? '').trim() || undefined;

export async function createFolder(parentId: string | null, input: FolderInput): Promise<Folder> {
  const image = input.image ? await makeThumbnail(input.image, 480) : undefined;
  const folder: Folder = {
    id: newId(),
    parentId,
    name: input.name.trim(),
    description: clean(input.description),
    imageId: image ? newId() : undefined,
    createdAt: now(),
    updatedAt: now(),
  };
  await write(['folders', 'blobs'], (s) => {
    s.folders.put(folder);
    if (image && folder.imageId) s.blobs.put(image, folder.imageId);
  });
  return folder;
}

/** Name, Beschreibung und Bild ändern (Verschieben läuft über moveMany). */
export async function updateFolder(folder: Folder, input: FolderInput): Promise<void> {
  const image = input.image ? await makeThumbnail(input.image, 480) : undefined;
  const imageId = input.image === undefined ? folder.imageId : image ? newId() : undefined;
  const next: Folder = {
    ...folder,
    name: input.name.trim(),
    description: clean(input.description),
    imageId,
    updatedAt: now(),
  };
  await write(['folders', 'blobs'], (s) => {
    s.folders.put(next);
    if (folder.imageId && folder.imageId !== imageId) s.blobs.delete(folder.imageId);
    if (image && imageId) s.blobs.put(image, imageId);
  });
}

export async function deleteMany(data: LocalData, folderIds: string[], fileIds: string[]): Promise<void> {
  const goneFolderIds = new Set<string>();
  folderIds.forEach((id) => subtreeIds(data.folders, id).forEach((x) => goneFolderIds.add(x)));
  const fileIdSet = new Set(fileIds);
  const goneFolders = data.folders.filter((f) => goneFolderIds.has(f.id));
  const goneFiles = data.files.filter((f) => fileIdSet.has(f.id) || goneFolderIds.has(f.folderId));
  await write(['folders', 'files', 'blobs'], (s) => {
    goneFolders.forEach((f) => {
      s.folders.delete(f.id);
      if (f.imageId) s.blobs.delete(f.imageId);
    });
    goneFiles.forEach((f) => {
      s.files.delete(f.id);
      s.blobs.delete(f.blobId);
      if (f.thumbId) s.blobs.delete(f.thumbId);
    });
  });
}

export async function addFiles(folderId: string, items: NewFileInput[], onProgress?: (done: number) => void): Promise<void> {
  // Eine Datei pro Transaktion: große Uploads bleiben stabil, und ein Fehler betrifft nur eine Datei.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const split = splitName(it.filename);
    const mime = it.file.type || 'application/octet-stream';
    const thumb = kindOf(mime, split.ext) === 'image' ? await makeThumbnail(it.file) : undefined;
    const item: FileItem = {
      id: newId(),
      folderId,
      name: (it.name ?? '').trim() || split.name,
      ext: split.ext,
      description: clean(it.description),
      mime,
      size: it.file.size,
      blobId: newId(),
      thumbId: thumb ? newId() : undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    await write(['files', 'blobs'], (s) => {
      s.blobs.put(it.file, item.blobId);
      if (thumb && item.thumbId) s.blobs.put(thumb, item.thumbId);
      s.files.put(item);
    });
    onProgress?.(i + 1);
  }
}

export async function updateFile(file: FileItem, patch: { name?: string; description?: string }): Promise<void> {
  const next: FileItem = {
    ...file,
    name: (patch.name ?? file.name).trim() || file.name,
    description: patch.description !== undefined ? clean(patch.description) : file.description,
    updatedAt: now(),
  };
  await write(['files'], (s) => s.files.put(next));
}

/** Inhalt einer Datei ersetzen (z. B. bearbeitete Karteikarten). */
export async function replaceContent(file: FileItem, blob: Blob, name?: string): Promise<void> {
  const next: FileItem = { ...file, name: name?.trim() || file.name, size: blob.size, updatedAt: now() };
  await write(['files', 'blobs'], (s) => {
    s.blobs.put(blob, file.blobId);
    s.files.put(next);
  });
}

export async function moveMany(data: LocalData, folderIds: string[], fileIds: string[], targetId: string | null): Promise<void> {
  const t = now();
  const movedFolders = data.folders.filter((f) => folderIds.includes(f.id)).map((f) => ({ ...f, parentId: targetId, updatedAt: t }));
  const movedFiles = targetId ? data.files.filter((f) => fileIds.includes(f.id)).map((f) => ({ ...f, folderId: targetId, updatedAt: t })) : [];
  await write(['folders', 'files'], (s) => {
    movedFolders.forEach((f) => s.folders.put(f));
    movedFiles.forEach((f) => s.files.put(f));
  });
}

/** Legt Ordner/Dateien aus einem Bündel im Zielordner an (IDs bleiben erhalten). */
export async function importBundle(targetId: string | null, bundle: Bundle, onProgress?: (done: number) => void): Promise<void> {
  const t = now();
  let done = 0;
  for (const f of bundle.folders) {
    const imageId = f.image ? newId() : undefined;
    const folder: Folder = {
      id: f.id,
      parentId: f.parentId ?? targetId,
      name: f.name,
      description: f.description,
      imageId,
      createdAt: f.createdAt,
      updatedAt: t,
    };
    await write(['folders', 'blobs'], (s) => {
      s.folders.put(folder);
      if (f.image && imageId) s.blobs.put(f.image, imageId);
    });
  }
  for (const f of bundle.files) {
    if (!targetId && !f.folderId) continue;
    const item: FileItem = {
      id: f.id,
      folderId: f.folderId ?? targetId!,
      name: f.name,
      ext: f.ext,
      description: f.description,
      mime: f.mime,
      size: f.size,
      blobId: newId(),
      thumbId: f.thumb ? newId() : undefined,
      createdAt: f.createdAt,
      updatedAt: t,
    };
    await write(['files', 'blobs'], (s) => {
      s.blobs.put(f.blob, item.blobId);
      if (f.thumb && item.thumbId) s.blobs.put(f.thumb, item.thumbId);
      s.files.put(item);
    });
    onProgress?.(++done);
  }
}

/** Speichert/aktualisiert den lokalen Platzhalter eines geteilten Ordners (bestimmt, wo er unter „Meine Ordner“ liegt). */
// createdBy = Konto, dem der geteilte Ordner gehört (zum Aufräumen, wenn er auf dem Server gelöscht wurde).
export async function putPlaceholder(p: { id: string; parentId: string | null; name: string; shareId: string; createdAt: string; createdBy?: string | null }): Promise<void> {
  const folder: Folder = { id: p.id, parentId: p.parentId, name: p.name, shareId: p.shareId, createdAt: p.createdAt, updatedAt: now(), createdBy: p.createdBy ?? null };
  await write(['folders'], (s) => s.folders.put(folder));
}

/** Nach dem Teilen: Inhalt vom Gerät entfernen, der Ordner selbst bleibt als Platzhalter an seiner Stelle. */
export async function convertToPlaceholder(data: LocalData, folderId: string, shareId: string, owner: string): Promise<void> {
  const folder = data.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const kids = data.folders.filter((f) => f.parentId === folderId).map((f) => f.id);
  const ownFiles = data.files.filter((f) => f.folderId === folderId).map((f) => f.id);
  await deleteMany(data, kids, ownFiles);
  await write(['folders', 'blobs'], (s) => {
    if (folder.imageId) s.blobs.delete(folder.imageId);
    s.folders.put({ id: folder.id, parentId: folder.parentId, name: folder.name, shareId, createdAt: folder.createdAt, updatedAt: now(), createdBy: owner });
  });
}

export const deletePlaceholder = (id: string) => write(['folders'], (s) => s.folders.delete(id));
export const loadAll = () => db.loadAll();
