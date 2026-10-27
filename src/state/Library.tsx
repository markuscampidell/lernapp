import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FileItem, Folder } from '../domain/types';
import { MAX_DEPTH, SHARED_ROOT } from '../domain/types';
import { canMoveFolder, depthOf, subtreeIds } from '../domain/tree';
import { db } from '../storage/db';
import { loadBlob, REMOTE } from '../storage/blobs';
import { fullName } from '../lib/files';
import { useAuth, type User } from '../cloud/auth';
import { supabase } from '../cloud/supabase';
import * as remote from '../cloud/remote';
import type { Member, Profile, Share, Snapshot } from '../cloud/remote';
import * as local from './local';
import { looseFiles, makeBundle, topLevel, type FolderInput, type NewFileInput } from './bundle';

export type { FolderInput, NewFileInput } from './bundle';

type Item = Folder | FileItem;

interface LibraryValue {
  ready: boolean;
  error: string | null;
  /** Alle Ordner: eigene (auf dem Gerät) und geteilte. Geteilte haben shareId. */
  folders: Folder[];
  files: FileItem[];
  createFolder: (parentId: string | null, input: FolderInput) => Promise<Folder>;
  updateFolder: (folder: Folder, input: FolderInput & { parentId?: string | null }) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  addFiles: (folderId: string, items: NewFileInput[], onProgress?: (done: number) => void) => Promise<void>;
  updateFile: (file: FileItem, patch: Partial<Pick<FileItem, 'name' | 'description' | 'folderId'>>) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  /** Mehrere Ordner (samt Inhalt) und Dateien in einem Schritt löschen. */
  deleteMany: (folderIds: string[], fileIds: string[]) => Promise<void>;
  /** Ordner und Dateien in einen anderen Ordner verschieben (null = oberste Ebene, nur für Ordner). */
  moveMany: (folderIds: string[], fileIds: string[], targetId: string | null) => Promise<void>;
  reload: () => Promise<void>;

  // ---------- Teilen ----------
  me: User | null;
  /** Server erreichbar (sonst sind geteilte Ordner nur lesbar). */
  online: boolean;
  shares: Share[];
  members: Member[];
  profiles: Profile[];
  userName: (id: string | null | undefined) => string;
  shareOf: (item: Item | undefined) => Share | undefined;
  isRoot: (folder: Folder | undefined) => boolean;
  isOwner: (shareId: string | undefined) => boolean;
  /** Platzhalter eines geteilten Ordners, der hier gerade nicht verfügbar ist (abgemeldet, gelöscht …). */
  isOrphan: (folderId: string) => boolean;
  canModify: (item: Item) => boolean;
  canEditFolder: (folder: Folder) => boolean;
  canAddIn: (folderId: string | null) => boolean;
  /** null = erlaubt, sonst der Grund. */
  deleteProblem: (folderIds: string[], fileIds: string[]) => string | null;
  moveProblem: (folderIds: string[], fileIds: string[], targetId: string | null) => string | null;
  shareProblem: (folderId: string) => string | null;
  /** Ordner mit "!" (neue Inhalte von anderen oder neu geteilt). */
  unread: Set<string>;
  /** Zeitpunkt, ab dem Einträge in diesem Ordner als neu gelten. */
  seenAt: (folderId: string) => string | undefined;
  isNewSince: (item: Item, since: string | undefined) => boolean;
  markSeen: (folderId: string) => void;
  shareFolder: (folderId: string, userIds: string[], onProgress?: (msg: string) => void) => Promise<void>;
  stopSharing: (shareId: string, onProgress?: (msg: string) => void) => Promise<void>;
  addMembers: (shareId: string, userIds: string[]) => Promise<void>;
  removeMember: (shareId: string, userId: string) => Promise<void>;
  leaveShare: (shareId: string) => Promise<void>;
  refreshRemote: () => Promise<void>;
}

const Ctx = createContext<LibraryValue | null>(null);

const SNAPSHOT_KEY = 'snapshot';
const time = (s: string | undefined) => (s ? Date.parse(s) : 0);
const offlineError = () => new Error('Keine Verbindung zum Server – geteilte Ordner können gerade nur angesehen werden.');

/** Eigene und geteilte Ordner zu einem Baum zusammenführen. */
function merge(localData: local.LocalData, snap: Snapshot | null, me: string | undefined) {
  const shares = snap?.shares ?? [];
  const roots = new Map(shares.map((s) => [s.rootId, s]));
  const remoteIds = new Set(snap?.folders.map((f) => f.id) ?? []);
  const localIds = new Set(localData.folders.map((f) => f.id));
  const placeholders = new Map(localData.folders.filter((f) => f.shareId).map((f) => [f.id, f]));
  const orphans = new Set<string>();

  const folders: Folder[] = [];
  for (const f of localData.folders) {
    if (f.shareId && remoteIds.has(f.id)) continue; // Platzhalter -> wird durch den echten geteilten Ordner ersetzt
    if (f.shareId) orphans.add(f.id);
    const { shareId: _s, ...rest } = f;
    void _s;
    folders.push(rest);
  }
  for (const f of snap?.folders ?? []) {
    if (f.parentId !== null) {
      folders.push(f);
      continue;
    }
    const share = roots.get(f.id);
    const ph = placeholders.get(f.id);
    // Eigene geteilte Ordner bleiben dort unter "Meine Ordner", wo sie auf diesem Gerät liegen.
    const mounted = ph && share?.ownerId === me && (ph.parentId === null || (localIds.has(ph.parentId) && !placeholders.has(ph.parentId)));
    folders.push({ ...f, parentId: mounted ? ph.parentId : SHARED_ROOT });
  }
  return { folders, files: [...localData.files, ...(snap?.files ?? [])], orphans };
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const me = user?.id;
  const [localData, setLocalData] = useState<local.LocalData>({ folders: [], files: [] });
  const [localReady, setLocalReady] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadLocal = useCallback(async () => {
    try {
      setLocalData(await local.loadAll());
      setError(null);
    } catch (e) {
      console.error(e);
      setError('Die gespeicherten Daten konnten nicht geladen werden. Ist privates Surfen aktiv?');
    } finally {
      setLocalReady(true);
    }
  }, []);

  useEffect(() => {
    reloadLocal();
  }, [reloadLocal]);

  // ---------- Geteilte Ordner laden ----------
  const userRef = useRef(me);
  userRef.current = me;

  const refreshRemote = useCallback(async () => {
    const uid = userRef.current;
    if (!uid || !supabase) return;
    try {
      const next = await remote.fetchSnapshot(uid);
      if (userRef.current !== uid) return;
      setSnap(next);
      setOnline(true);
      db.setMeta(SNAPSHOT_KEY, next).catch(() => {});
    } catch (e) {
      console.warn('Geteilte Ordner konnten nicht geladen werden', e);
      setOnline(false);
    } finally {
      setRemoteReady(true);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!me) {
      setSnap(null);
      setRemoteReady(true);
      return;
    }
    let alive = true;
    setRemoteReady(false);
    // Zuerst den gespeicherten Stand zeigen (schnell & offline), dann frisch laden.
    db.getMeta<Snapshot>(SNAPSHOT_KEY)
      .then((cached) => {
        if (alive && cached?.userId === me) {
          setSnap(cached);
          setRemoteReady(true);
        }
      })
      .catch(() => {})
      .finally(() => alive && refreshRemote());
    return () => {
      alive = false;
    };
  }, [me, authReady, refreshRemote]);

  // Live-Aktualisierung + beim Zurückkehren in die App + alle 60 s als Rückfallebene.
  useEffect(() => {
    if (!me || !supabase) return;
    const client = supabase;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refreshRemote, 400);
    };
    const channel = client.channel(`lernapp-${me}`);
    for (const table of ['shares', 'share_members', 'folders', 'files']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    }
    channel.subscribe();
    const onVisible = () => document.visibilityState === 'visible' && soon();
    const onOffline = () => setOnline(false);
    if (!navigator.onLine) setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', soon);
    window.addEventListener('focus', soon);
    const interval = setInterval(() => document.visibilityState === 'visible' && refreshRemote(), 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      client.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', soon);
      window.removeEventListener('focus', soon);
    };
  }, [me, refreshRemote]);

  const reload = useCallback(async () => {
    await Promise.all([reloadLocal(), refreshRemote()]);
  }, [reloadLocal, refreshRemote]);

  // ---------- Zusammengeführte Sicht ----------
  const merged = useMemo(() => merge(localData, snap, me), [localData, snap, me]);
  const { folders, files, orphans } = merged;

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const shareMap = useMemo(() => new Map((snap?.shares ?? []).map((s) => [s.id, s])), [snap]);
  const profileMap = useMemo(() => new Map((snap?.profiles ?? []).map((p) => [p.id, p.username])), [snap]);

  const userName = useCallback((id: string | null | undefined) => (id ? profileMap.get(id) ?? 'Unbekannt' : 'Unbekannt'), [profileMap]);
  const shareOf = useCallback((item: Item | undefined) => (item?.shareId ? shareMap.get(item.shareId) : undefined), [shareMap]);
  const isOwner = useCallback((shareId: string | undefined) => !!shareId && !!me && shareMap.get(shareId)?.ownerId === me, [shareMap, me]);
  const isRoot = useCallback((f: Folder | undefined) => !!f?.shareId && shareMap.get(f.shareId)?.rootId === f.id, [shareMap]);
  const isOrphan = useCallback((id: string) => orphans.has(id), [orphans]);
  const canModify = useCallback((item: Item) => !item.shareId || isOwner(item.shareId) || (!!me && item.createdBy === me), [isOwner, me]);
  const canEditFolder = useCallback((f: Folder) => canModify(f) || isRoot(f), [canModify, isRoot]);
  const canAddIn = useCallback(
    (id: string | null) => {
      if (id === null) return true;
      const f = byId.get(id);
      if (!f) return false;
      return !f.shareId || online;
    },
    [byId, online],
  );

  /** Wo ein Ordner gespeichert ist: 'local' oder die ID des geteilten Ordners. */
  const storeOf = useCallback((folderId: string | null) => (folderId ? byId.get(folderId)?.shareId ?? 'local' : 'local'), [byId]);

  const containsSharedRoot = useCallback(
    (folderId: string) => [...subtreeIds(folders, folderId)].some((id) => id !== folderId && isRoot(byId.get(id))),
    [folders, byId, isRoot],
  );

  /** Darf ich diesen geteilten Ordner samt Inhalt entfernen (Besitzer oder alles darin von mir)? */
  const canRemoveRemoteFolder = useCallback(
    (f: Folder) => {
      if (isOwner(f.shareId)) return true;
      if (!me || f.createdBy !== me) return false;
      const ids = subtreeIds(folders, f.id);
      return folders.every((x) => !ids.has(x.id) || x.createdBy === me) && files.every((x) => !ids.has(x.folderId) || x.createdBy === me);
    },
    [folders, files, isOwner, me],
  );

  const deleteProblem = useCallback(
    (folderIds: string[], fileIds: string[]) => {
      let remoteInvolved = false;
      for (const id of folderIds) {
        const f = byId.get(id);
        if (!f) continue;
        if (!f.shareId) {
          if (containsSharedRoot(id)) return `„${f.name}“ enthält einen geteilten Ordner. Beende dort zuerst das Teilen oder verschiebe ihn.`;
          continue;
        }
        remoteInvolved = true;
        if (isRoot(f)) {
          if (!isOwner(f.shareId)) return `Nur ${userName(shareOf(f)?.ownerId)} (Besitzer) kann „${f.name}“ löschen. Du kannst den Ordner stattdessen verlassen.`;
        } else if (!canRemoveRemoteFolder(f)) {
          return f.createdBy === me
            ? `„${f.name}“ enthält Einträge von anderen – die kannst du nicht löschen.`
            : `„${f.name}“ wurde von ${userName(f.createdBy)} erstellt – nur diese Person oder der Besitzer kann ihn löschen.`;
        }
      }
      for (const id of fileIds) {
        const f = files.find((x) => x.id === id);
        if (!f?.shareId) continue;
        remoteInvolved = true;
        if (!canModify(f)) return `„${fullName(f)}“ wurde von ${userName(f.createdBy)} hinzugefügt – nur diese Person oder der Besitzer kann sie löschen.`;
      }
      if (remoteInvolved && !online) return offlineError().message;
      return null;
    },
    [byId, files, containsSharedRoot, isRoot, isOwner, userName, shareOf, canRemoveRemoteFolder, canModify, me, online],
  );

  const moveProblem = useCallback(
    (folderIds: string[], fileIds: string[], targetId: string | null) => {
      if (targetId === SHARED_ROOT) return 'Hierhin kann nichts verschoben werden.';
      if (targetId === null && fileIds.length) return 'Dateien können nur in Ordnern liegen.';
      const target = storeOf(targetId);
      let remoteInvolved = target !== 'local';
      for (const id of folderIds) {
        const f = byId.get(id);
        if (!f) continue;
        if (!canMoveFolder(folders, id, targetId)) return 'Ein Ordner kann dorthin nicht verschoben werden (zu tief verschachtelt oder in sich selbst).';
        if (isRoot(f)) {
          if (!isOwner(f.shareId)) return `„${f.name}“ ist ein geteilter Ordner – nur der Besitzer kann ihn verschieben.`;
          if (target !== 'local') return 'Ein geteilter Ordner kann nicht in einen anderen geteilten Ordner verschoben werden.';
          continue;
        }
        const src = f.shareId ?? 'local';
        if (src === 'local') {
          if (target !== 'local' && containsSharedRoot(id)) return `„${f.name}“ enthält einen geteilten Ordner und kann daher nicht in einen geteilten Ordner.`;
          continue;
        }
        remoteInvolved = true;
        if (src === target ? !canModify(f) : !canRemoveRemoteFolder(f)) {
          return `„${f.name}“ wurde von ${userName(f.createdBy)} erstellt – nur diese Person oder der Besitzer kann ihn verschieben.`;
        }
      }
      for (const id of fileIds) {
        const f = files.find((x) => x.id === id);
        if (!f?.shareId) continue;
        remoteInvolved = true;
        if (!canModify(f)) return `„${fullName(f)}“ wurde von ${userName(f.createdBy)} hinzugefügt – nur diese Person oder der Besitzer kann sie verschieben.`;
      }
      if (remoteInvolved && !online) return offlineError().message;
      return null;
    },
    [byId, files, folders, storeOf, isRoot, isOwner, containsSharedRoot, canModify, canRemoveRemoteFolder, userName, online],
  );

  const shareProblem = useCallback(
    (folderId: string) => {
      const f = byId.get(folderId);
      if (!f) return 'Ordner nicht gefunden.';
      if (!me) return 'Melde dich an, um Ordner zu teilen.';
      if (f.shareId) return null; // schon geteilt -> Mitglieder verwalten
      if (orphans.has(folderId)) return 'Dieser geteilte Ordner ist gerade nicht verfügbar.';
      if (containsSharedRoot(folderId)) return `„${f.name}“ enthält bereits einen geteilten Ordner – teile stattdessen die einzelnen Ordner.`;
      if (!online) return offlineError().message;
      return null;
    },
    [byId, me, orphans, containsSharedRoot, online],
  );

  // ---------- "!" – Neues von anderen ----------
  const baseline = useCallback(
    (shareId: string | undefined) => {
      const s = shareId ? shareMap.get(shareId) : undefined;
      if (!s) return undefined;
      if (s.ownerId === me) return s.createdAt;
      return snap?.members.find((m) => m.shareId === shareId && m.userId === me)?.addedAt ?? s.createdAt;
    },
    [shareMap, snap, me],
  );

  const seenAt = useCallback(
    (folderId: string) => {
      const f = byId.get(folderId);
      if (!f?.shareId) return undefined;
      return snap?.seen[folderId] ?? baseline(f.shareId);
    },
    [byId, snap, baseline],
  );

  const isNewSince = useCallback(
    (item: Item, since: string | undefined) =>
      !!item.shareId && !!since && !!item.updatedBy && item.updatedBy !== me && time(item.updatedAt) > time(since),
    [me],
  );

  const unread = useMemo(() => {
    const out = new Set<string>();
    if (!snap || !me) return out;
    const direct = new Set<string>();
    const check = (item: Item, parentId: string | null) => {
      if (parentId && isNewSince(item, seenAt(parentId))) direct.add(parentId);
    };
    snap.folders.forEach((f) => f.parentId && check(f, f.parentId));
    snap.files.forEach((f) => check(f, f.folderId));
    // Neu mit mir geteilt und noch nie geöffnet.
    snap.shares.forEach((s) => s.ownerId !== me && !snap.seen[s.rootId] && direct.add(s.rootId));
    for (const id of direct) {
      let cur: string | null | undefined = id;
      for (let i = 0; cur && cur !== SHARED_ROOT && !out.has(cur) && i < 64; i++) {
        out.add(cur);
        cur = byId.get(cur)?.parentId;
      }
    }
    return out;
  }, [snap, me, isNewSince, seenAt, byId]);

  // Über eine Referenz, damit markSeen stabil bleibt (sonst Endlosschleife: markSeen -> neuer Stand -> neues markSeen …).
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const markSeen = useCallback(
    (folderId: string) => {
      if (!me || !byIdRef.current.get(folderId)?.shareId) return;
      const stamp = new Date().toISOString();
      setSnap((s) => (s ? { ...s, seen: { ...s.seen, [folderId]: stamp } } : s));
      remote
        .markSeen(folderId)
        .then((serverTime) => setSnap((s) => (s ? { ...s, seen: { ...s.seen, [folderId]: serverTime } } : s)))
        .catch(() => {});
    },
    [me],
  );

  // ---------- Ändern ----------
  const requireOnline = useCallback(() => {
    if (!online) throw offlineError();
  }, [online]);

  const createFolder = useCallback<LibraryValue['createFolder']>(
    async (parentId, input) => {
      if (parentId === SHARED_ROOT) throw new Error('Neue Ordner bitte unter „Meine Ordner“ anlegen.');
      if (parentId && depthOf(folders, parentId) >= MAX_DEPTH) throw new Error('Maximale Ordnertiefe erreicht.');
      const store = storeOf(parentId);
      if (store === 'local') {
        const f = await local.createFolder(parentId, input);
        await reloadLocal();
        return f;
      }
      requireOnline();
      const f = await remote.createFolder(store, parentId!, input);
      await refreshRemote();
      return f;
    },
    [folders, storeOf, reloadLocal, refreshRemote, requireOnline],
  );

  const deleteMany = useCallback<LibraryValue['deleteMany']>(
    async (folderIds, fileIds) => {
      const problem = deleteProblem(folderIds, fileIds);
      if (problem) throw new Error(problem);
      const tops = topLevel(folders, folderIds);
      const loose = looseFiles(folders, files, tops, fileIds);
      const localFolders = tops.filter((id) => !byId.get(id)?.shareId);
      const rootFolders = tops.filter((id) => isRoot(byId.get(id)));
      const remoteFolders = tops.filter((id) => byId.get(id)?.shareId && !rootFolders.includes(id));
      const localFiles = loose.filter((id) => !files.find((f) => f.id === id)?.shareId);
      const remoteFiles = loose.filter((id) => files.find((f) => f.id === id)?.shareId);

      if (localFolders.length || localFiles.length) await local.deleteMany(localData, localFolders, localFiles);
      if (remoteFolders.length || remoteFiles.length) await remote.deleteMany(folders, files, remoteFolders, remoteFiles);
      for (const id of rootFolders) {
        await remote.deleteShare(byId.get(id)!.shareId!, folders, files);
        await local.deletePlaceholder(id).catch(() => {});
      }
      await reload();
    },
    [deleteProblem, folders, files, byId, isRoot, localData, reload],
  );

  const deleteFolder = useCallback<LibraryValue['deleteFolder']>((id) => deleteMany([id], []), [deleteMany]);
  const deleteFile = useCallback<LibraryValue['deleteFile']>((id) => deleteMany([], [id]), [deleteMany]);

  const moveMany = useCallback<LibraryValue['moveMany']>(
    async (folderIds, fileIds, targetId) => {
      const problem = moveProblem(folderIds, fileIds, targetId);
      if (problem) throw new Error(problem);
      const tops = topLevel(folders, folderIds);
      const loose = looseFiles(folders, files, tops, fileIds);
      const target = storeOf(targetId);

      // Eigene geteilte Ordner: nur der Platzhalter unter "Meine Ordner" wandert.
      for (const id of tops.filter((x) => isRoot(byId.get(x)))) {
        const f = byId.get(id)!;
        await local.putPlaceholder({ id, parentId: targetId, name: f.name, shareId: f.shareId!, createdAt: f.createdAt });
      }

      // Nach Speicherort gruppieren.
      const groups = new Map<string, { folders: string[]; files: string[] }>();
      const add = (store: string, kind: 'folders' | 'files', id: string) => {
        if (!groups.has(store)) groups.set(store, { folders: [], files: [] });
        groups.get(store)![kind].push(id);
      };
      tops.filter((x) => !isRoot(byId.get(x))).forEach((id) => add(byId.get(id)?.shareId ?? 'local', 'folders', id));
      loose.forEach((id) => add(files.find((f) => f.id === id)?.shareId ?? 'local', 'files', id));

      for (const [src, g] of groups) {
        if (src === target) {
          if (src === 'local') await local.moveMany(localData, g.folders, g.files, targetId);
          else await remote.moveMany(g.folders, g.files, targetId!);
          continue;
        }
        // Zwischen Gerät und geteiltem Ordner: kopieren, dann am alten Ort löschen.
        const bundle = await makeBundle(folders, files, g.folders, g.files, loadBlob);
        if (target === 'local') await local.importBundle(targetId, bundle);
        else await remote.importBundle(target, targetId, bundle);
        if (src === 'local') await local.deleteMany(localData, g.folders, g.files);
        else await remote.deleteMany(folders, files, g.folders, g.files);
      }
      await reload();
    },
    [moveProblem, folders, files, storeOf, isRoot, byId, localData, reload],
  );

  const updateFolder = useCallback<LibraryValue['updateFolder']>(
    async (folder, input) => {
      if (folder.shareId) {
        requireOnline();
        await remote.updateFolder(folder, input);
        // Platzhalter auf dem Gerät mitbenennen (für die Anzeige, wenn offline/abgemeldet).
        const ph = localData.folders.find((f) => f.id === folder.id && f.shareId);
        if (ph) await local.putPlaceholder({ ...ph, shareId: ph.shareId!, name: input.name.trim() });
      } else {
        const stored = localData.folders.find((f) => f.id === folder.id) ?? folder;
        await local.updateFolder(stored, input);
      }
      if (input.parentId !== undefined && input.parentId !== folder.parentId) await moveMany([folder.id], [], input.parentId);
      else await reload();
    },
    [localData, moveMany, reload, requireOnline],
  );

  const addFiles = useCallback<LibraryValue['addFiles']>(
    async (folderId, items, onProgress) => {
      const store = storeOf(folderId);
      if (store === 'local') {
        await local.addFiles(folderId, items, onProgress);
        await reloadLocal();
        return;
      }
      requireOnline();
      try {
        await remote.addFiles(store, folderId, items, onProgress);
      } finally {
        await refreshRemote();
      }
    },
    [storeOf, reloadLocal, refreshRemote, requireOnline],
  );

  const updateFile = useCallback<LibraryValue['updateFile']>(
    async (file, patch) => {
      const changed = (patch.name !== undefined && patch.name.trim() !== file.name) || (patch.description ?? '') !== (file.description ?? '');
      if (changed) {
        if (file.shareId) {
          requireOnline();
          await remote.updateFile(file, patch);
        } else await local.updateFile(file, patch);
      }
      if (patch.folderId && patch.folderId !== file.folderId) await moveMany([], [file.id], patch.folderId);
      else await reload();
    },
    [moveMany, reload, requireOnline],
  );

  // ---------- Teilen ----------
  const shareFolder = useCallback<LibraryValue['shareFolder']>(
    async (folderId, userIds, onProgress) => {
      const problem = shareProblem(folderId);
      if (problem) throw new Error(problem);
      onProgress?.('Dateien werden vorbereitet …');
      const bundle = await makeBundle(folders, files, [folderId], [], loadBlob);
      const shareId = await remote.createShare(folderId);
      try {
        const total = bundle.files.length;
        onProgress?.(total ? `Hochladen … 0/${total}` : 'Hochladen …');
        await remote.importBundle(shareId, null, bundle, (n) => onProgress?.(`Hochladen … ${n}/${total}`));
        await remote.addMembers(shareId, userIds);
      } catch (e) {
        await remote.deleteShare(shareId, [], []).catch(() => {});
        throw e;
      }
      await local.convertToPlaceholder(localData, folderId, shareId);
      await reload();
    },
    [shareProblem, folders, files, localData, reload],
  );

  const stopSharing = useCallback<LibraryValue['stopSharing']>(
    async (shareId, onProgress) => {
      const share = shareMap.get(shareId);
      if (!share || share.ownerId !== me) throw new Error('Nur der Besitzer kann das Teilen beenden.');
      requireOnline();
      const root = byId.get(share.rootId);
      if (!root) throw new Error('Ordner nicht gefunden.');
      onProgress?.('Dateien werden heruntergeladen …');
      const bundle = await makeBundle(folders, files, [root.id], [], loadBlob);
      const target = root.parentId === SHARED_ROOT ? null : root.parentId;
      onProgress?.('Wird auf diesem Gerät gespeichert …');
      await local.importBundle(target, bundle);
      onProgress?.('Wird vom Server entfernt …');
      await remote.deleteShare(shareId, folders, files);
      await reload();
    },
    [shareMap, me, byId, folders, files, reload, requireOnline],
  );

  const addMembers = useCallback<LibraryValue['addMembers']>(
    async (shareId, userIds) => {
      requireOnline();
      await remote.addMembers(shareId, userIds);
      await refreshRemote();
    },
    [refreshRemote, requireOnline],
  );

  const removeMember = useCallback<LibraryValue['removeMember']>(
    async (shareId, userId) => {
      requireOnline();
      await remote.removeMember(shareId, userId);
      await refreshRemote();
    },
    [refreshRemote, requireOnline],
  );

  const leaveShare = useCallback<LibraryValue['leaveShare']>(
    async (shareId) => {
      if (!me) return;
      requireOnline();
      await remote.removeMember(shareId, me);
      await refreshRemote();
    },
    [me, refreshRemote, requireOnline],
  );

  // Beim Abmelden zwischengespeicherte geteilte Daten vom Gerät entfernen.
  const prevUser = useRef(me);
  useEffect(() => {
    if (prevUser.current && !me) {
      db.deleteBlobsWithPrefix(REMOTE).catch(() => {});
      db.setMeta(SNAPSHOT_KEY, null).catch(() => {});
    }
    prevUser.current = me;
  }, [me]);

  const ready = localReady && authReady && remoteReady;

  const value = useMemo<LibraryValue>(
    () => ({
      ready,
      error,
      folders,
      files,
      createFolder,
      updateFolder,
      deleteFolder,
      addFiles,
      updateFile,
      deleteFile,
      deleteMany,
      moveMany,
      reload,
      me: user,
      online,
      shares: snap?.shares ?? [],
      members: snap?.members ?? [],
      profiles: snap?.profiles ?? [],
      userName,
      shareOf,
      isRoot,
      isOwner,
      isOrphan,
      canModify,
      canEditFolder,
      canAddIn,
      deleteProblem,
      moveProblem,
      shareProblem,
      unread,
      seenAt,
      isNewSince,
      markSeen,
      shareFolder,
      stopSharing,
      addMembers,
      removeMember,
      leaveShare,
      refreshRemote,
    }),
    [
      ready, error, folders, files, createFolder, updateFolder, deleteFolder, addFiles, updateFile, deleteFile, deleteMany, moveMany, reload,
      user, online, snap, userName, shareOf, isRoot, isOwner, isOrphan, canModify, canEditFolder, canAddIn, deleteProblem, moveProblem,
      shareProblem, unread, seenAt, isNewSince, markSeen, shareFolder, stopSharing, addMembers, removeMember, leaveShare, refreshRemote,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary außerhalb von LibraryProvider');
  return v;
}
