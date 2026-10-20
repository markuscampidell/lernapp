import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FileItem, Folder } from '../domain/types';
import { MAX_DEPTH } from '../domain/types';
import { canMoveFolder, depthOf, subtreeIds } from '../domain/tree';
import { db, write } from '../storage/db';
import { newId } from '../lib/id';
import { kindOf, makeThumbnail, splitName } from '../lib/files';

export interface FolderInput {
  name: string;
  description?: string;
  /** undefined = Bild unverändert lassen, null = Bild entfernen. */
  image?: Blob | null;
}

export interface NewFileInput {
  file: Blob;
  /** Ursprünglicher Dateiname inkl. Endung. */
  filename: string;
  /** Anzeigename ohne Endung (leer = aus Dateiname). */
  name?: string;
  description?: string;
}

interface LibraryValue {
  ready: boolean;
  error: string | null;
  folders: Folder[];
  files: FileItem[];
  createFolder: (parentId: string | null, input: FolderInput) => Promise<Folder>;
  updateFolder: (folder: Folder, input: FolderInput & { parentId?: string | null }) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  addFiles: (folderId: string, items: NewFileInput[], onProgress?: (done: number) => void) => Promise<void>;
  updateFile: (file: FileItem, patch: Partial<Pick<FileItem, 'name' | 'description' | 'folderId'>>) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<LibraryValue | null>(null);

const now = () => new Date().toISOString();
const clean = (s?: string) => (s ?? '').trim() || undefined;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await db.loadAll();
      setFolders(data.folders);
      setFiles(data.files);
      setError(null);
    } catch (e) {
      console.error(e);
      setError('Die gespeicherten Daten konnten nicht geladen werden. Ist privates Surfen aktiv?');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createFolder = useCallback<LibraryValue['createFolder']>(
    async (parentId, input) => {
      if (parentId && depthOf(folders, parentId) >= MAX_DEPTH) throw new Error('Maximale Ordnertiefe erreicht.');
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
      setFolders((prev) => [...prev, folder]);
      return folder;
    },
    [folders],
  );

  const updateFolder = useCallback<LibraryValue['updateFolder']>(
    async (folder, input) => {
      if (input.parentId !== undefined && input.parentId !== folder.parentId && !canMoveFolder(folders, folder.id, input.parentId)) {
        throw new Error('Der Ordner kann dorthin nicht verschoben werden.');
      }
      const image = input.image ? await makeThumbnail(input.image, 480) : undefined;
      const imageId = input.image === undefined ? folder.imageId : image ? newId() : undefined;
      const next: Folder = {
        ...folder,
        name: input.name.trim(),
        description: clean(input.description),
        parentId: input.parentId === undefined ? folder.parentId : input.parentId,
        imageId,
        updatedAt: now(),
      };
      await write(['folders', 'blobs'], (s) => {
        s.folders.put(next);
        if (folder.imageId && folder.imageId !== imageId) s.blobs.delete(folder.imageId);
        if (image && imageId) s.blobs.put(image, imageId);
      });
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? next : f)));
    },
    [folders],
  );

  const deleteFolder = useCallback<LibraryValue['deleteFolder']>(
    async (id) => {
      const ids = subtreeIds(folders, id);
      const goneFolders = folders.filter((f) => ids.has(f.id));
      const goneFiles = files.filter((f) => ids.has(f.folderId));
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
      setFolders((prev) => prev.filter((f) => !ids.has(f.id)));
      setFiles((prev) => prev.filter((f) => !ids.has(f.folderId)));
    },
    [folders, files],
  );

  const addFiles = useCallback<LibraryValue['addFiles']>(async (folderId, items, onProgress) => {
    const added: FileItem[] = [];
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
      added.push(item);
      onProgress?.(i + 1);
    }
    setFiles((prev) => [...prev, ...added]);
  }, []);

  const updateFile = useCallback<LibraryValue['updateFile']>(async (file, patch) => {
    const next: FileItem = {
      ...file,
      ...patch,
      name: (patch.name ?? file.name).trim() || file.name,
      description: patch.description !== undefined ? clean(patch.description) : file.description,
      updatedAt: now(),
    };
    await write(['files'], (s) => s.files.put(next));
    setFiles((prev) => prev.map((f) => (f.id === file.id ? next : f)));
  }, []);

  const deleteFile = useCallback<LibraryValue['deleteFile']>(
    async (id) => {
      const f = files.find((x) => x.id === id);
      if (!f) return;
      await write(['files', 'blobs'], (s) => {
        s.files.delete(id);
        s.blobs.delete(f.blobId);
        if (f.thumbId) s.blobs.delete(f.thumbId);
      });
      setFiles((prev) => prev.filter((x) => x.id !== id));
    },
    [files],
  );

  const value = useMemo<LibraryValue>(
    () => ({ ready, error, folders, files, createFolder, updateFolder, deleteFolder, addFiles, updateFile, deleteFile, reload }),
    [ready, error, folders, files, createFolder, updateFolder, deleteFolder, addFiles, updateFile, deleteFile, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary außerhalb von LibraryProvider');
  return v;
}
