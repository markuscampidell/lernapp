import type { FileItem, Folder } from './types';
import { MAX_DEPTH, SHARED_ROOT } from './types';

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
export const byName = <T extends { name: string }>(a: T, b: T) => collator.compare(a.name, b.name);

export const childFolders = (folders: Folder[], parentId: string | null) =>
  folders.filter((f) => f.parentId === parentId).sort(byName);

export const filesIn = (files: FileItem[], folderId: string) =>
  files.filter((f) => f.folderId === folderId).sort(byName);

/** Pfad von der obersten Ebene bis einschließlich des Ordners. */
export function pathOf(folders: Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && path.length <= 64 && !path.includes(cur)) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** Ebene eines Ordners: 1 = oberste Ebene. */
export const depthOf = (folders: Folder[], id: string) => pathOf(folders, id).length;

/** Alle Ordner-IDs unterhalb (inkl. des Ordners selbst). */
export function subtreeIds(folders: Folder[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Wie viele Ebenen der Ordner samt Unterordnern umfasst (nur der Ordner selbst = 1). */
export function subtreeHeight(folders: Folder[], id: string): number {
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => subtreeHeight(folders, k.id)));
}

export const canHaveSubfolder = (folders: Folder[], id: string) => depthOf(folders, id) < MAX_DEPTH;

/** Kann `folderId` (mit allen Unterordnern) nach `targetId` verschoben werden? null = oberste Ebene. */
export function canMoveFolder(folders: Folder[], folderId: string, targetId: string | null): boolean {
  if (targetId === null) return subtreeHeight(folders, folderId) <= MAX_DEPTH;
  if (subtreeIds(folders, folderId).has(targetId)) return false;
  return depthOf(folders, targetId) + subtreeHeight(folders, folderId) <= MAX_DEPTH;
}

export function counts(folders: Folder[], files: FileItem[], id: string) {
  return {
    folders: folders.filter((f) => f.parentId === id).length,
    files: files.filter((f) => f.folderId === id).length,
  };
}

/** Liegt der Ordner unter „Meine Ordner“ oder unter „Geteilte Ordner“? */
export function scopeOf(folders: Folder[], id: string | null): 'mine' | 'shared' {
  if (id === SHARED_ROOT) return 'shared';
  const top = pathOf(folders, id)[0];
  return top?.parentId === SHARED_ROOT ? 'shared' : 'mine';
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
