import type { FileItem, Folder } from '../domain/types';
import { subtreeIds } from '../domain/tree';
import { fullName } from '../lib/files';

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

/** Ordner/Dateien samt Inhalt im Arbeitsspeicher – zum Übertragen zwischen Gerät und geteilten Ordnern. */
export interface BundleFolder {
  id: string;
  /** null = direkt in den Zielordner. */
  parentId: string | null;
  name: string;
  description?: string;
  image?: Blob;
  createdAt: string;
}
export interface BundleFile {
  id: string;
  /** null = direkt in den Zielordner. */
  folderId: string | null;
  name: string;
  ext: string;
  description?: string;
  mime: string;
  size: number;
  blob: Blob;
  thumb?: Blob;
  createdAt: string;
}
export interface Bundle {
  folders: BundleFolder[];
  files: BundleFile[];
}

/** Entfernt Ordner, deren Elternordner ebenfalls in der Liste ist (die kommen ohnehin mit). */
export function topLevel(folders: Folder[], ids: string[]): string[] {
  const set = new Set(ids);
  const byId = new Map(folders.map((f) => [f.id, f]));
  return ids.filter((id) => {
    let p = byId.get(id)?.parentId;
    for (let i = 0; p && i < 64; i++) {
      if (set.has(p)) return false;
      p = byId.get(p)?.parentId;
    }
    return true;
  });
}

/** Dateien, die nicht ohnehin mit einem ihrer (ausgewählten) Ordner wandern. */
export function looseFiles(folders: Folder[], files: FileItem[], folderIds: string[], fileIds: string[]): string[] {
  const inside = new Set<string>();
  folderIds.forEach((id) => subtreeIds(folders, id).forEach((x) => inside.add(x)));
  return fileIds.filter((id) => {
    const f = files.find((x) => x.id === id);
    return f && !inside.has(f.folderId);
  });
}

/** Ordner so sortieren, dass Elternordner vor ihren Kindern kommen. */
export function parentsFirst(folders: BundleFolder[]): BundleFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  const out: BundleFolder[] = [];
  const done = new Set<string>();
  let level = folders.filter((f) => f.parentId === null || !ids.has(f.parentId));
  while (level.length) {
    level.forEach((f) => {
      out.push(f);
      done.add(f.id);
    });
    level = folders.filter((f) => !done.has(f.id) && f.parentId !== null && done.has(f.parentId));
  }
  return out;
}

/** Packt Ordner (mit allem darin) und einzelne Dateien samt Inhalt zusammen. */
export async function makeBundle(
  folders: Folder[],
  files: FileItem[],
  folderIds: string[],
  fileIds: string[],
  load: (id: string) => Promise<Blob | undefined>,
): Promise<Bundle> {
  const tops = topLevel(folders, folderIds);
  const all = new Set<string>();
  tops.forEach((id) => subtreeIds(folders, id).forEach((x) => all.add(x)));
  const topSet = new Set(tops);
  const fileSet = new Set(fileIds);

  const bFolders: BundleFolder[] = [];
  for (const f of folders.filter((x) => all.has(x.id))) {
    bFolders.push({
      id: f.id,
      parentId: topSet.has(f.id) ? null : f.parentId,
      name: f.name,
      description: f.description,
      image: f.imageId ? await load(f.imageId).catch(() => undefined) : undefined,
      createdAt: f.createdAt,
    });
  }
  const bFiles: BundleFile[] = [];
  for (const f of files.filter((x) => fileSet.has(x.id) || all.has(x.folderId))) {
    const blob = await load(f.blobId).catch(() => undefined);
    if (!blob) throw new Error(`„${fullName(f)}“ konnte nicht geladen werden – bist du online?`);
    bFiles.push({
      id: f.id,
      folderId: all.has(f.folderId) ? f.folderId : null,
      name: f.name,
      ext: f.ext,
      description: f.description,
      mime: f.mime,
      size: f.size,
      blob,
      thumb: f.thumbId ? await load(f.thumbId).catch(() => undefined) : undefined,
      createdAt: f.createdAt,
    });
  }
  return { folders: parentsFirst(bFolders), files: bFiles };
}
