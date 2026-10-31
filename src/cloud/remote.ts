// Zugriff auf geteilte Ordner in Supabase. Alle Rechte prüft zusätzlich der Server (supabase/schema.sql).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Access, FileItem, Folder } from '../domain/types';
import { subtreeIds } from '../domain/tree';
import { newId } from '../lib/id';
import { fullName, kindOf, makeThumbnail, splitName } from '../lib/files';
import { db } from '../storage/db';
import { isRemoteBlob, REMOTE, remotePath } from '../storage/blobs';
import type { Bundle, FolderInput, NewFileInput } from '../state/bundle';
import { clean } from '../state/local';
import { BUCKET, check, friendly, MAX_UPLOAD, supabase } from './supabase';

export interface Profile {
  id: string;
  username: string;
}
export interface Share {
  id: string;
  ownerId: string;
  rootId: string;
  createdAt: string;
  /** Ordner eines anderen (eigenen) geteilten Ordners, in dem dieser liegt – dann sehen ihn auch dessen Personen. */
  inside?: string | null;
}
export interface Member {
  shareId: string;
  userId: string;
  addedAt: string;
}
/** Geteilte Ordner, die mir jemand beim Löschen seines Kontos übergeben hat (noch nicht entschieden). */
export interface Handover {
  id: string;
  fromName: string;
  createdAt: string;
  expiresAt: string;
  shareIds: string[];
}
export interface Snapshot {
  userId: string;
  profiles: Profile[];
  shares: Share[];
  members: Member[];
  /** Ordner wie gespeichert: der oberste geteilte Ordner hat parentId === null. */
  folders: Folder[];
  files: FileItem[];
  /** folderId -> Zeitpunkt, an dem ich den Ordner zuletzt geöffnet habe. */
  seen: Record<string, string>;
  /** An mich übergebene geteilte Ordner (fehlt in älteren zwischengespeicherten Ständen). */
  handovers?: Handover[];
  /** false = supabase/004_konto_loeschen.sql wurde noch nicht ausgeführt. */
  handoversReady?: boolean;
}

function sb(): SupabaseClient {
  if (!supabase) throw new Error('Kein Server eingerichtet.');
  return supabase;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? undefined : String(v));

const toFolder = (r: Row): Folder => ({
  id: String(r.id),
  parentId: (r.parent_id as string | null) ?? null,
  name: String(r.name),
  description: str(r.description),
  imageId: r.image_path ? REMOTE + r.image_path : undefined,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  shareId: String(r.share_id),
  createdBy: (r.created_by as string | null) ?? null,
  updatedBy: (r.updated_by as string | null) ?? null,
  access: (r.access as Access | null) ?? null,
});

const toFile = (r: Row): FileItem => ({
  id: String(r.id),
  folderId: String(r.folder_id),
  name: String(r.name),
  ext: String(r.ext ?? ''),
  description: str(r.description),
  mime: String(r.mime),
  size: Number(r.size) || 0,
  blobId: REMOTE + r.blob_path,
  thumbId: r.thumb_path ? REMOTE + r.thumb_path : undefined,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  shareId: String(r.share_id),
  createdBy: (r.created_by as string | null) ?? null,
  updatedBy: (r.updated_by as string | null) ?? null,
  access: (r.access as Access | null) ?? null,
});

/** Liest eine ganze Tabelle (Supabase liefert höchstens 1000 Zeilen pro Anfrage). */
async function selectAll(table: string, order: string[]): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb().from(table).select('*');
    order.forEach((c) => (q = q.order(c)));
    const rows = check(await q.range(from, from + PAGE - 1)) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Übergaben an mich – null, wenn der Server sie noch nicht kennt (004 nicht ausgeführt). */
async function fetchHandovers(): Promise<Handover[] | null> {
  const [h, hs] = await Promise.all([
    sb().from('handovers').select('id, from_name, created_at, expires_at').order('created_at'),
    sb().from('handover_shares').select('handover_id, share_id'),
  ]);
  if (h.error || hs.error) {
    const msg = (h.error ?? hs.error)!.message;
    if (/handover|relation|schema cache|does not exist/i.test(msg)) return null;
    throw new Error(friendly(msg));
  }
  const links = (hs.data ?? []) as Row[];
  return ((h.data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    fromName: String(r.from_name),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    shareIds: links.filter((l) => String(l.handover_id) === String(r.id)).map((l) => String(l.share_id)),
  }));
}

export async function fetchSnapshot(userId: string): Promise<Snapshot> {
  const [profiles, shares, members, folders, files, seen, handovers] = await Promise.all([
    selectAll('profiles', ['id']),
    selectAll('shares', ['id']),
    selectAll('share_members', ['share_id', 'user_id']),
    selectAll('folders', ['id']),
    selectAll('files', ['id']),
    selectAll('seen', ['folder_id']),
    fetchHandovers(),
  ]);
  return {
    handovers: handovers ?? [],
    handoversReady: handovers !== null,
    userId,
    profiles: profiles.map((r) => ({ id: String(r.id), username: String(r.username) })),
    shares: shares.map((r) => ({ id: String(r.id), ownerId: String(r.owner_id), rootId: String(r.root_id), createdAt: String(r.created_at), inside: (r.inside as string | null) ?? null })),
    members: members.map((r) => ({ shareId: String(r.share_id), userId: String(r.user_id), addedAt: String(r.added_at) })),
    folders: folders.map(toFolder),
    files: files.map(toFile),
    seen: Object.fromEntries(seen.map((r) => [String(r.folder_id), String(r.seen_at)])),
  };
}

// ---------- Dateispeicher ----------

async function upload(shareId: string, blob: Blob, contentType: string): Promise<string> {
  if (blob.size > MAX_UPLOAD) throw new Error('Datei zu groß – in geteilten Ordnern sind höchstens 50 MB pro Datei möglich.');
  const path = `${shareId}/${newId()}`;
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, { contentType: contentType || 'application/octet-stream', upsert: false });
  if (error) throw new Error(friendly(error.message));
  // Gleich auf dem Gerät behalten: spart den Download und ist offline lesbar.
  await db.putBlob(REMOTE + path, blob).catch(() => {});
  return path;
}

async function removePaths(paths: string[]) {
  const list = [...new Set(paths)];
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await sb().storage.from(BUCKET).remove(list.slice(i, i + 100));
    if (error) console.warn('Dateien konnten nicht entfernt werden', error);
  }
  await db.deleteBlobs(list.map((p) => REMOTE + p)).catch(() => {});
}

const pathsOf = (folders: Folder[], files: FileItem[]) =>
  [...folders.map((f) => f.imageId), ...files.flatMap((f) => [f.blobId, f.thumbId])]
    .filter((id): id is string => !!id && isRemoteBlob(id))
    .map(remotePath);

// ---------- Geteilte Ordner & Mitglieder ----------

export async function createShare(rootId: string): Promise<string> {
  const row = check(await sb().from('shares').insert({ root_id: rootId }).select('id').single()) as Row;
  return String(row.id);
}

/** Löscht einen geteilten Ordner für alle (inkl. aller Dateien im Speicher). */
export async function deleteShare(shareId: string, folders: Folder[], files: FileItem[]): Promise<void> {
  const paths = pathsOf(
    folders.filter((f) => f.shareId === shareId),
    files.filter((f) => f.shareId === shareId),
  );
  await removePaths(paths);
  check(await sb().from('shares').delete().eq('id', shareId));
}

/** Legt einen geteilten Ordner in einen Ordner eines anderen eigenen geteilten Ordners (null = nirgends). */
export async function setInside(shareId: string, folderId: string | null): Promise<void> {
  const res = await sb().from('shares').update({ inside: folderId }).eq('id', shareId).select('id');
  if (res.error) {
    if (/inside/.test(res.error.message) && /column|schema/i.test(res.error.message))
      throw new Error('Der Server ist noch nicht bereit: Bitte supabase/003_verschachtelt.sql im Supabase „SQL Editor“ ausführen.');
    throw new Error(friendly(res.error.message));
  }
  expectAll(res.data, 1);
}

export async function addMembers(shareId: string, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  check(await sb().from('share_members').upsert(userIds.map((user_id) => ({ share_id: shareId, user_id })), { ignoreDuplicates: true }));
}

export async function removeMember(shareId: string, userId: string): Promise<void> {
  check(await sb().from('share_members').delete().eq('share_id', shareId).eq('user_id', userId));
}

export async function markSeen(folderId: string): Promise<string> {
  return String(check(await sb().rpc('mark_seen', { folder: folderId })));
}

// ---------- Ordner & Dateien ----------

/** Prüft, dass wirklich alle Zeilen betroffen waren (sonst hat der Server es wegen fehlender Rechte verweigert). */
function expectAll(rows: unknown, n: number) {
  if (!Array.isArray(rows) || rows.length < n) throw new Error('Dazu hast du keine Berechtigung (oder der Eintrag wurde inzwischen geändert).');
}

export async function createFolder(shareId: string, parentId: string, input: FolderInput): Promise<Folder> {
  const image = input.image ? await makeThumbnail(input.image, 480) : undefined;
  const image_path = image ? await upload(shareId, image, 'image/jpeg') : null;
  const row = check(
    await sb()
      .from('folders')
      .insert({ id: newId(), share_id: shareId, parent_id: parentId, name: input.name.trim(), description: clean(input.description) ?? null, image_path })
      .select()
      .single(),
  ) as Row;
  return toFolder(row);
}

export async function updateFolder(folder: Folder, input: FolderInput): Promise<void> {
  const shareId = folder.shareId!;
  const patch: Row = { name: input.name.trim(), description: clean(input.description) ?? null };
  if (input.image !== undefined) {
    const image = input.image ? await makeThumbnail(input.image, 480) : undefined;
    patch.image_path = image ? await upload(shareId, image, 'image/jpeg') : null;
  }
  expectAll(check(await sb().from('folders').update(patch).eq('id', folder.id).select('id')), 1);
  if (input.image !== undefined && folder.imageId) await removePaths([remotePath(folder.imageId)]);
}

export async function addFiles(shareId: string, folderId: string, items: NewFileInput[], onProgress?: (done: number) => void): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const split = splitName(it.filename);
    const mime = it.file.type || 'application/octet-stream';
    const name = (it.name ?? '').trim() || split.name;
    if (it.file.size > MAX_UPLOAD) throw new Error(`„${fullName({ name, ext: split.ext })}“ ist zu groß – in geteilten Ordnern sind höchstens 50 MB pro Datei möglich.`);
    const thumb = kindOf(mime, split.ext) === 'image' ? await makeThumbnail(it.file) : undefined;
    const blob_path = await upload(shareId, it.file, mime);
    const thumb_path = thumb ? await upload(shareId, thumb, 'image/jpeg') : null;
    const res = await sb().from('files').insert({
      id: newId(),
      share_id: shareId,
      folder_id: folderId,
      name,
      ext: split.ext,
      description: clean(it.description) ?? null,
      mime,
      size: it.file.size,
      blob_path,
      thumb_path,
    });
    if (res.error) {
      await removePaths([blob_path, ...(thumb_path ? [thumb_path] : [])]);
      throw new Error(friendly(res.error.message));
    }
    onProgress?.(i + 1);
  }
}

export async function updateFile(file: FileItem, patch: { name?: string; description?: string }): Promise<void> {
  const row: Row = {};
  if (patch.name !== undefined) row.name = patch.name.trim() || file.name;
  if (patch.description !== undefined) row.description = clean(patch.description) ?? null;
  expectAll(check(await sb().from('files').update(row).eq('id', file.id).select('id')), 1);
}

/** Aktueller Stand des Inhalts einer geteilten Datei (zum Erkennen, ob jemand anderes inzwischen gespeichert hat). */
export async function contentInfo(fileId: string): Promise<{ blobPath: string; updatedBy: string | null } | null> {
  const rows = check(await sb().from('files').select('blob_path, updated_by').eq('id', fileId).limit(1)) as Row[] | null;
  const r = rows?.[0];
  return r ? { blobPath: String(r.blob_path), updatedBy: (r.updated_by as string | null) ?? null } : null;
}

/** Inhalt einer geteilten Datei ersetzen: neue Datei hochladen, Eintrag umstellen, alte Datei entfernen. */
export async function replaceContent(file: FileItem, blob: Blob, name?: string): Promise<void> {
  const blob_path = await upload(file.shareId!, blob, file.mime);
  const res = await sb().from('files').update({ blob_path, size: blob.size, name: name?.trim() || file.name }).eq('id', file.id).select('id');
  if (res.error || !res.data?.length) {
    await removePaths([blob_path]);
    throw new Error(res.error ? friendly(res.error.message) : 'Dazu hast du keine Berechtigung.');
  }
  if (isRemoteBlob(file.blobId)) await removePaths([remotePath(file.blobId)]);
}

/** Was andere Mitglieder mit einem Eintrag tun dürfen (null = wie der Ordner). */
export async function setAccess(kind: 'folders' | 'files', id: string, access: Access | null): Promise<void> {
  expectAll(check(await sb().from(kind).update({ access }).eq('id', id).select('id')), 1);
}

export async function moveMany(folderIds: string[], fileIds: string[], targetId: string): Promise<void> {
  if (folderIds.length) expectAll(check(await sb().from('folders').update({ parent_id: targetId }).in('id', folderIds).select('id')), folderIds.length);
  if (fileIds.length) expectAll(check(await sb().from('files').update({ folder_id: targetId }).in('id', fileIds).select('id')), fileIds.length);
}

/**
 * Löscht Ordner (samt Inhalt) und Dateien. folders/files = aktueller Gesamtstand, um die Speicherpfade zu finden.
 * Übergebene IDs sollten bereits "oberste" sein (keine Datei/kein Ordner, der ohnehin mitgelöscht wird).
 */
export async function deleteMany(folders: Folder[], files: FileItem[], folderIds: string[], fileIds: string[]): Promise<void> {
  const inside = new Set<string>();
  folderIds.forEach((id) => subtreeIds(folders, id).forEach((x) => inside.add(x)));
  const goneFolders = folders.filter((f) => inside.has(f.id));
  const goneFiles = files.filter((f) => inside.has(f.folderId) || fileIds.includes(f.id));
  if (fileIds.length) expectAll(check(await sb().from('files').delete().in('id', fileIds).select('id')), fileIds.length);
  if (folderIds.length) expectAll(check(await sb().from('folders').delete().in('id', folderIds).select('id')), folderIds.length);
  await removePaths(pathsOf(goneFolders, goneFiles));
}

/** Lädt ein Bündel in einen geteilten Ordner hoch (IDs bleiben erhalten). targetId null = neuer oberster Ordner. */
export async function importBundle(shareId: string, targetId: string | null, bundle: Bundle, onProgress?: (done: number) => void): Promise<void> {
  const uploaded: string[] = [];
  const put = async (blob: Blob, type: string) => {
    const p = await upload(shareId, blob, type);
    uploaded.push(p);
    return p;
  };
  const insertedFolders: string[] = [];
  try {
    for (const f of bundle.folders) {
      const image_path = f.image ? await put(f.image, f.image.type || 'image/jpeg') : null;
      check(
        await sb()
          .from('folders')
          .insert({ id: f.id, share_id: shareId, parent_id: f.parentId ?? targetId, name: f.name, description: f.description ?? null, image_path }),
      );
      insertedFolders.push(f.id);
    }
    let done = 0;
    for (const f of bundle.files) {
      if (f.size > MAX_UPLOAD) throw new Error(`„${fullName(f)}“ ist zu groß – in geteilten Ordnern sind höchstens 50 MB pro Datei möglich.`);
      const blob_path = await put(f.blob, f.mime);
      const thumb_path = f.thumb ? await put(f.thumb, 'image/jpeg') : null;
      check(
        await sb()
          .from('files')
          .insert({
            id: f.id,
            share_id: shareId,
            folder_id: f.folderId ?? targetId,
            name: f.name,
            ext: f.ext,
            description: f.description ?? null,
            mime: f.mime,
            size: f.size,
            blob_path,
            thumb_path,
          }),
      );
      onProgress?.(++done);
    }
  } catch (e) {
    // Halb Hochgeladenes wieder entfernen.
    const tops = bundle.folders.filter((f) => f.parentId === null && insertedFolders.includes(f.id)).map((f) => f.id);
    if (tops.length) await sb().from('folders').delete().in('id', tops);
    const looseIds = bundle.files.filter((f) => f.folderId === null).map((f) => f.id);
    if (looseIds.length) await sb().from('files').delete().in('id', looseIds);
    await removePaths(uploaded);
    throw e;
  }
}

// ---------- Konto löschen & Übergaben ----------

export const NOT_READY = 'Der Server ist noch nicht bereit: Bitte supabase/004_konto_loeschen.sql im Supabase „SQL Editor“ ausführen.';

/** Löscht das eigene Konto. recipient = Person, die die eigenen geteilten Ordner bekommt (null = niemand). */
export async function deleteOwnAccount(recipient: string | null): Promise<void> {
  const { error } = await sb().rpc('delete_own_account', { recipient });
  if (error) throw new Error(/delete_own_account|schema cache|Could not find/i.test(error.message) ? NOT_READY : friendly(error.message));
}

/** Übergabe abschließen (übernommen oder abgelehnt): der Hinweis verschwindet. */
export async function closeHandover(id: string): Promise<void> {
  check(await sb().from('handovers').delete().eq('id', id));
}

/** Löscht abgelaufene Übergaben (nach 30 Tagen) samt ihren Dateien im Speicher. */
export async function expireHandovers(): Promise<boolean> {
  const { data, error } = await sb().rpc('expire_handovers');
  if (error) return false;
  const paths = ((data as string[] | null) ?? []).filter(Boolean);
  if (paths.length) await removePaths(paths);
  return paths.length > 0;
}
