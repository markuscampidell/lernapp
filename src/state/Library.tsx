import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Access, FileItem, Folder } from '../domain/types';
import { MAX_DEPTH, SHARED_ROOT } from '../domain/types';
import { canMoveFolder, depthOf, subtreeIds } from '../domain/tree';
import { db } from '../storage/db';
import { loadBlob, REMOTE } from '../storage/blobs';
import { fileKind, fullName } from '../lib/files';
import { useAuth, type User } from '../cloud/auth';
import { supabase } from '../cloud/supabase';
import * as remote from '../cloud/remote';
import { newId } from '../lib/id';
import { comparable, mergeParts, summarize, type ChangePart } from '../features/changes/diff';
import type { Handover, Member, Profile, Share, Snapshot } from '../cloud/remote';
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
  /** Inhalt einer Datei ersetzen (eigene Lern-Dateien wie Karteikarten/Quiz). */
  replaceFileContent: (file: FileItem, blob: Blob, name?: string) => Promise<void>;
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
  /** Kommentare an einer Datei: Anzahl und ob es neue von anderen gibt (seit ich sie zuletzt gelesen habe). */
  commentInfo: (fileId: string) => { count: number; unread: boolean };
  /** Was andere seit meinem letzten Öffnen an der Datei geändert haben – pro Person zusammengefasst. */
  changesFor: (fileId: string) => { userId: string | null; parts: ChangePart[]; at: string }[];
  /** Änderungen dieser Datei als gesehen markieren (beim Öffnen). */
  markChangesSeen: (fileId: string) => void;
  /** Kommentare dieser Datei als gelesen merken. */
  markCommentsRead: (fileId: string) => void;
  /** Adresse des Profilbilds einer Person (undefined = keins). */
  avatarOf: (id: string | null | undefined) => string | undefined;
  shareOf: (item: Item | undefined) => Share | undefined;
  isRoot: (folder: Folder | undefined) => boolean;
  isOwner: (shareId: string | undefined) => boolean;
  /** Geteilter Ordner, in dem dieser geteilte Ordner liegt (dessen Personen sehen ihn mit). */
  parentShareOf: (shareId: string | undefined) => Share | undefined;
  /** Alle, die einen geteilten Ordner sehen: Besitzer, Mitglieder und die Personen der Ordner, in denen er liegt. */
  peopleOf: (shareId: string | undefined) => string[];
  /** Platzhalter eines geteilten Ordners, der hier gerade nicht verfügbar ist (abgemeldet, gelöscht …). */
  isOrphan: (folderId: string) => boolean;
  /** Darf ich den Eintrag ändern (umbenennen, Inhalt bearbeiten, verschieben)? */
  canModify: (item: Item) => boolean;
  canEditFolder: (folder: Folder) => boolean;
  /** Darf ich den Eintrag löschen? (Bei Ordnern zählt zusätzlich der Inhalt, siehe deleteProblem.) */
  canDeleteItem: (item: Item) => boolean;
  /** Was andere Mitglieder mit dem Eintrag dürfen (inkl. Vererbung). */
  accessOf: (item: Item) => Access;
  /** Vererbter Wert, falls der Eintrag selbst nichts eingestellt hat. */
  inheritedAccessOf: (item: Item) => Access;
  /** Darf ich die Rechte des Eintrags einstellen (Ersteller oder Besitzer)? */
  canSetAccess: (item: Item) => boolean;
  setAccess: (item: Item, access: Access | null) => Promise<void>;
  canAddIn: (folderId: string | null) => boolean;
  /** null = erlaubt, sonst der Grund. */
  deleteProblem: (folderIds: string[], fileIds: string[]) => string | null;
  moveProblem: (folderIds: string[], fileIds: string[], targetId: string | null) => string | null;
  shareProblem: (folderId: string) => string | null;
  /** Warum diese Datei nicht in einem eigenen Ordner geteilt werden kann (null = geht). */
  shareFileProblem: (fileId: string) => string | null;
  /** Neuen Ordner (Name = Dateiname) an derselben Stelle anlegen, die Datei hineinlegen und nur ihn teilen. Gibt die Ordner-ID zurück. */
  shareFile: (fileId: string, userIds: string[], onProgress?: (msg: string) => void) => Promise<string>;
  /** Ordner mit "!" (neue Inhalte von anderen oder neu geteilt). */
  unread: Set<string>;
  /** Zeitpunkt, ab dem Einträge in diesem Ordner als neu gelten. */
  seenAt: (folderId: string) => string | undefined;
  isNewSince: (item: Item, since: string | undefined) => boolean;
  markSeen: (folderId: string) => void;
  /** Teilt einen Ordner. Ein Unterordner eines eigenen geteilten Ordners wird dabei neu angelegt – zurück kommt die (ggf. neue) ID. */
  shareFolder: (folderId: string, userIds: string[], onProgress?: (msg: string) => void) => Promise<string>;
  stopSharing: (shareId: string, onProgress?: (msg: string) => void) => Promise<void>;
  addMembers: (shareId: string, userIds: string[]) => Promise<void>;
  removeMember: (shareId: string, userId: string) => Promise<void>;
  leaveShare: (shareId: string) => Promise<void>;
  refreshRemote: () => Promise<void>;

  // ---------- Konto löschen & Übergaben ----------
  /** An mich übergebene geteilte Ordner, über die ich noch entscheiden muss. */
  handovers: Handover[];
  /** Server kennt Konto-Löschen/Übergaben (supabase/004_konto_loeschen.sql ausgeführt). */
  handoversReady: boolean;
  handoverStats: (h: Handover) => HandoverStats;
  /** Übernehmen: 'shared' = weiter geteilt, ich bin Besitzer; 'local' = in „Meine Ordner“ auf dieses Gerät. */
  claimHandover: (id: string, mode: 'shared' | 'local', onProgress?: (msg: string) => void) => Promise<void>;
  /** Ablehnen: alles wird endgültig gelöscht. */
  declineHandover: (id: string) => Promise<void>;
  /** Geteilte Ordner, die mir gehören (die oberste Ebene davon). */
  ownedRoots: Folder[];
  /** Automatisches Hochladen von „Meine Ordner“ (Konto-Einstellung "Auf allen Geräten"). */
  sync: SyncState;
  /** Fehlgeschlagene Ordner erneut versuchen. */
  retrySync: () => void;
  /**
   * Eigenes Konto löschen; recipient bekommt die eigenen geteilten Ordner (null = alles löschen).
   * wipeLocal: auch „Meine Ordner“ (und alles andere) auf diesem Gerät löschen.
   */
  deleteAccount: (recipient: string | null, wipeLocal: boolean, onProgress?: (msg: string) => void) => Promise<void>;
}

export interface SyncState {
  on: boolean;
  /** Was gerade hochgeladen wird (null = nichts). */
  busy: string | null;
  /** Ordner, die nicht hochgeladen werden konnten. */
  errors: { id: string; name: string; message: string }[];
  /** Ordner, die noch nur auf diesem Gerät liegen. */
  pending: number;
}

export interface HandoverStats {
  folders: number;
  files: number;
  bytes: number;
  /** Namen der obersten Ordner. */
  names: string[];
  /** Personen, die die Ordner weiterhin sehen, wenn sie geteilt bleiben. */
  people: string[];
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
    // Liegt in einem anderen geteilten Ordner, den ich sehe -> dort anzeigen.
    if (share?.inside && remoteIds.has(share.inside)) {
      folders.push({ ...f, parentId: share.inside });
      continue;
    }
    const ph = placeholders.get(f.id);
    // Eigene geteilte Ordner stehen immer unter "Meine Ordner": dort, wo sie auf diesem Gerät liegen, sonst ganz oben.
    // Unter "Geteilte Ordner" stehen nur Ordner, die andere mit mir geteilt haben.
    const mine = share?.ownerId === me;
    const mounted = ph && mine && (ph.parentId === null || (localIds.has(ph.parentId) && !placeholders.has(ph.parentId)));
    folders.push({ ...f, parentId: mounted ? ph.parentId : mine ? null : SHARED_ROOT });
  }
  return { folders, files: [...localData.files, ...(snap?.files ?? [])], orphans };
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady, signOut } = useAuth();
  const me = user?.id;
  const [localData, setLocalData] = useState<local.LocalData>({ folders: [], files: [] });
  const [localReady, setLocalReady] = useState(false);
  // Vollständiger Stand vom Server; "snap" blendet Ordner aus, die mir übergeben wurden und noch auf eine Entscheidung warten.
  const [rawSnap, setSnap] = useState<Snapshot | null>(null);
  /** Wann (Gerätezeit) der zuletzt erfolgreich vom Server geladene Stand angefragt wurde – nicht der gespeicherte. */
  const [freshAt, setFreshAt] = useState<{ uid: string; at: number } | null>(null);
  const pendingShares = useMemo(() => new Set((rawSnap?.handovers ?? []).flatMap((h) => h.shareIds)), [rawSnap]);
  const snap = useMemo<Snapshot | null>(() => {
    if (!rawSnap || !pendingShares.size) return rawSnap;
    return {
      ...rawSnap,
      shares: rawSnap.shares.filter((s) => !pendingShares.has(s.id)),
      members: rawSnap.members.filter((m) => !pendingShares.has(m.shareId)),
      folders: rawSnap.folders.filter((f) => !pendingShares.has(f.shareId!)),
      files: rawSnap.files.filter((f) => !pendingShares.has(f.shareId!)),
    };
  }, [rawSnap, pendingShares]);
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
    const started = Date.now();
    try {
      const next = await remote.fetchSnapshot(uid);
      if (userRef.current !== uid) return;
      setSnap(next);
      setFreshAt({ uid, at: started });
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
    setFreshAt(null);
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
    for (const table of ['shares', 'share_members', 'folders', 'files', 'profiles', 'comments', 'file_changes']) {
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

  // Abgelaufene Übergaben (30 Tage ohne Entscheidung) aufräumen – einmal pro Anmeldung.
  useEffect(() => {
    if (!me || !supabase) return;
    let alive = true;
    remote
      .expireHandovers()
      .then((changed) => {
        if (alive && changed) refreshRemote();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me, refreshRemote]);

  // Eigene geteilte Ordner, die auf einem anderen Gerät gelöscht wurden: Platzhalter hier entfernen.
  // Nur mit frischem Stand vom Server (nicht offline/zwischengespeichert), nur eigene, und nur Platzhalter,
  // die schon vor dieser Abfrage existierten (sonst würde ein gerade eben geteilter Ordner verschwinden).
  useEffect(() => {
    if (!me || !online || !rawSnap || !freshAt || freshAt.uid !== me) return;
    const shareIds = new Set(rawSnap.shares.map((s) => s.id));
    const gone = localData.folders.filter(
      (f) => f.shareId && !shareIds.has(f.shareId) && (!f.createdBy || f.createdBy === me) && Date.parse(f.updatedAt) < freshAt.at,
    );
    if (!gone.length) return;
    (async () => {
      for (const f of gone) await local.deletePlaceholder(f.id).catch(() => {});
      await reloadLocal();
    })();
  }, [me, online, rawSnap, freshAt, localData, reloadLocal]);

  // ---------- Zusammengeführte Sicht ----------
  const merged = useMemo(() => merge(localData, snap, me), [localData, snap, me]);
  const { folders, files, orphans } = merged;

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const shareMap = useMemo(() => new Map((snap?.shares ?? []).map((s) => [s.id, s])), [snap]);
  const profileMap = useMemo(() => new Map((snap?.profiles ?? []).map((p) => [p.id, p.username])), [snap]);

  const userName = useCallback((id: string | null | undefined) => (id ? profileMap.get(id) ?? 'Unbekannt' : 'Unbekannt'), [profileMap]);
  const avatarMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of snap?.profiles ?? []) {
      if (!p.avatarPath) continue;
      try {
        m.set(p.id, remote.avatarUrl(p.avatarPath));
      } catch {
        /* kein Server */
      }
    }
    return m;
  }, [snap]);
  // Kommentare: Anzahl je Datei und „gelesen bis“ (nur auf diesem Gerät gemerkt).
  const [commentsRead, setCommentsRead] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('lernapp-kommentare-gelesen') ?? '{}');
    } catch {
      return {};
    }
  });
  const commentStats = useMemo(() => {
    const m = new Map<string, { count: number; lastOther: string }>();
    for (const c of snap?.comments ?? []) {
      const e = m.get(c.fileId) ?? { count: 0, lastOther: '' };
      e.count++;
      if (c.userId !== user?.id && c.createdAt > e.lastOther) e.lastOther = c.createdAt;
      m.set(c.fileId, e);
    }
    return m;
  }, [snap, user?.id]);
  const commentInfo = useCallback(
    (fileId: string) => {
      const e = commentStats.get(fileId);
      if (!e) return { count: 0, unread: false };
      return { count: e.count, unread: !!e.lastOther && e.lastOther > (commentsRead[fileId] ?? '') };
    },
    [commentStats, commentsRead],
  );
  const markCommentsRead = useCallback((fileId: string) => {
    setCommentsRead((prev) => {
      const next = { ...prev, [fileId]: new Date().toISOString() };
      try {
        localStorage.setItem('lernapp-kommentare-gelesen', JSON.stringify(next));
      } catch {
        /* privat/voll */
      }
      return next;
    });
  }, []);
  // Änderungen anderer, die ich noch nicht gesehen habe (gerade gesehene sofort ausblenden, bevor der Server antwortet).
  const [justSeen, setJustSeen] = useState<Set<string>>(new Set());
  const changesFor = useCallback(
    (fileId: string) => {
      const seen = new Set(snap?.changesSeen ?? []);
      const mine = (snap?.changes ?? []).filter((c) => c.fileId === fileId && c.userId !== user?.id && !seen.has(c.id) && !justSeen.has(c.id));
      const byUser = new Map<string | null, typeof mine>();
      mine.forEach((c) => byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]));
      return [...byUser.entries()].map(([userId, list]) => ({
        userId,
        parts: mergeParts(list.map((c) => c.summary as ChangePart[])),
        at: list[list.length - 1].createdAt,
      }));
    },
    [snap, user?.id, justSeen],
  );
  const markChangesSeen = useCallback(
    (fileId: string) => {
      const seen = new Set(snap?.changesSeen ?? []);
      const ids = (snap?.changes ?? []).filter((c) => c.fileId === fileId && c.userId !== user?.id && !seen.has(c.id)).map((c) => c.id);
      if (!ids.length) return;
      setJustSeen((prev) => new Set([...prev, ...ids]));
      remote.markChangesSeen(fileId).catch(() => {});
    },
    [snap, user?.id],
  );
  const avatarOf = useCallback((id: string | null | undefined) => (id ? avatarMap.get(id) : undefined), [avatarMap]);
  const shareOf = useCallback((item: Item | undefined) => (item?.shareId ? shareMap.get(item.shareId) : undefined), [shareMap]);
  const isOwner = useCallback((shareId: string | undefined) => !!shareId && !!me && shareMap.get(shareId)?.ownerId === me, [shareMap, me]);
  const isRoot = useCallback((f: Folder | undefined) => !!f?.shareId && shareMap.get(f.shareId)?.rootId === f.id, [shareMap]);
  const isOrphan = useCallback((id: string) => orphans.has(id), [orphans]);
  /** Rechte erben – nur über Ordner derselben Person; sonst "nur lesen". */
  const inheritFrom = useCallback(
    (folderId: string | null, creator: string | null | undefined): Access => {
      let id = folderId;
      for (let i = 0; id && i < 64; i++) {
        const f = byId.get(id);
        if (!f?.shareId || f.createdBy !== creator) return 'read';
        if (f.access) return f.access;
        // Auch über den obersten Ordner hinaus: liegt er in einem anderen geteilten Ordner, zeigt parentId dorthin (sonst Ende = „Nur lesen“).
        id = f.parentId;
      }
      return 'read';
    },
    [byId],
  );
  const inheritedAccessOf = useCallback(
    (item: Item): Access => {
      if ('folderId' in item) return inheritFrom(item.folderId, item.createdBy);
      return inheritFrom(item.parentId, item.createdBy);
    },
    [inheritFrom],
  );
  const accessOf = useCallback((item: Item): Access => item.access ?? inheritedAccessOf(item), [inheritedAccessOf]);
  const mine = useCallback((item: Item) => !item.shareId || isOwner(item.shareId) || (!!me && item.createdBy === me), [isOwner, me]);
  // Den obersten Ordner eines geteilten Ordners (Name, Bild) ändert nur der Besitzer – die Rechte gelten nur für den Inhalt.
  const canModify = useCallback(
    (item: Item) => mine(item) || (accessOf(item) !== 'read' && !('parentId' in item && isRoot(item))),
    [mine, accessOf, isRoot],
  );
  const canDeleteItem = useCallback((item: Item) => mine(item) || (accessOf(item) === 'delete' && !('parentId' in item && isRoot(item))), [mine, accessOf, isRoot]);
  const canEditFolder = canModify;
  const canSetAccess = useCallback((item: Item) => !!item.shareId && !!me && (isOwner(item.shareId) || item.createdBy === me), [isOwner, me]);
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

  /** Geteilte Ordner, die (auf beliebiger Ebene) in diesem Ordner liegen. */
  const sharedRootsIn = useCallback(
    (folderId: string) => [...subtreeIds(folders, folderId)].filter((id) => id !== folderId && isRoot(byId.get(id))).map((id) => byId.get(id)!),
    [folders, byId, isRoot],
  );
  /** Nur die äußersten davon (die direkt zu diesem Ordner gehören, nicht zu einem anderen darin). */
  const outerRootsIn = useCallback(
    (folderId: string) => {
      const out: Folder[] = [];
      let level = [folderId];
      while (level.length) {
        const next: string[] = [];
        for (const f of folders) {
          if (!f.parentId || !level.includes(f.parentId)) continue;
          if (isRoot(f)) out.push(f);
          else next.push(f.id);
        }
        level = next;
      }
      return out;
    },
    [folders, isRoot],
  );
  const parentShareOf = useCallback(
    (shareId: string | undefined) => {
      const inside = shareId ? shareMap.get(shareId)?.inside : undefined;
      const sid = inside ? byId.get(inside)?.shareId : undefined;
      return sid ? shareMap.get(sid) : undefined;
    },
    [shareMap, byId],
  );
  const peopleOf = useCallback(
    (shareId: string | undefined) => {
      const out = new Set<string>();
      let s = shareId ? shareMap.get(shareId) : undefined;
      for (let i = 0; s && i < 16; i++) {
        out.add(s.ownerId);
        snap?.members.forEach((m) => m.shareId === s!.id && out.add(m.userId));
        s = parentShareOf(s.id);
      }
      return [...out];
    },
    [shareMap, snap, parentShareOf],
  );

  /** Darf ich diesen geteilten Ordner samt Inhalt entfernen (Besitzer, oder alles darin darf ich löschen)? */
  const canRemoveRemoteFolder = useCallback(
    (f: Folder) => {
      if (isOwner(f.shareId)) return true;
      if (isRoot(f) || !canDeleteItem(f)) return false;
      const ids = subtreeIds(folders, f.id);
      return folders.every((x) => !ids.has(x.id) || canDeleteItem(x)) && files.every((x) => !ids.has(x.folderId) || canDeleteItem(x));
    },
    [folders, files, isOwner, isRoot, canDeleteItem],
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
        const foreign = sharedRootsIn(id).find((r) => !isOwner(r.shareId));
        if (foreign) return `„${f.name}“ enthält den geteilten Ordner „${foreign.name}“ – nur ${userName(shareOf(foreign)?.ownerId)} (Besitzer) kann ihn löschen.`;
        if (isRoot(f)) {
          if (!isOwner(f.shareId)) return `Nur ${userName(shareOf(f)?.ownerId)} (Besitzer) kann „${f.name}“ löschen. Du kannst den Ordner stattdessen verlassen.`;
        } else if (!canRemoveRemoteFolder(f)) {
          return canDeleteItem(f)
            ? `„${f.name}“ enthält Einträge von anderen, die du nicht löschen darfst.`
            : `„${f.name}“ wurde von ${userName(f.createdBy)} erstellt – du darfst ihn nicht löschen.`;
        }
      }
      for (const id of fileIds) {
        const f = files.find((x) => x.id === id);
        if (!f?.shareId) continue;
        remoteInvolved = true;
        if (!canDeleteItem(f)) return `„${fullName(f)}“ wurde von ${userName(f.createdBy)} hinzugefügt – du darfst sie nicht löschen.`;
      }
      if (remoteInvolved && !online) return offlineError().message;
      return null;
    },
    [byId, files, containsSharedRoot, sharedRootsIn, isRoot, isOwner, userName, shareOf, canRemoveRemoteFolder, canDeleteItem, online],
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
          if (target !== 'local' && !isOwner(target)) return 'Ein geteilter Ordner kann nur in eigene geteilte Ordner verschoben werden.';
          if (target !== 'local' || shareMap.get(f.shareId!)?.inside) remoteInvolved = true;
          continue;
        }
        const src = f.shareId ?? 'local';
        if (src === 'local') {
          if (target !== 'local' && containsSharedRoot(id)) return `„${f.name}“ enthält einen geteilten Ordner und kann daher nicht in einen geteilten Ordner.`;
          continue;
        }
        remoteInvolved = true;
        if (src !== target && containsSharedRoot(id)) return `„${f.name}“ enthält einen geteilten Ordner und kann daher nur innerhalb dieses geteilten Ordners verschoben werden.`;
        if (src === target ? !canModify(f) : !canRemoveRemoteFolder(f)) {
          return src === target
            ? `„${f.name}“ wurde von ${userName(f.createdBy)} erstellt – du darfst ihn nicht verschieben.`
            : `„${f.name}“ kann nur aus dem geteilten Ordner heraus, wenn du alles darin löschen darfst.`;
        }
      }
      for (const id of fileIds) {
        const f = files.find((x) => x.id === id);
        if (!f?.shareId) continue;
        remoteInvolved = true;
        if (f.shareId === target ? !canModify(f) : !canDeleteItem(f)) {
          return `„${fullName(f)}“ wurde von ${userName(f.createdBy)} hinzugefügt – du darfst sie ${f.shareId === target ? 'nicht verschieben' : 'nicht aus dem geteilten Ordner nehmen'}.`;
        }
      }
      if (remoteInvolved && !online) return offlineError().message;
      return null;
    },
    [byId, files, folders, storeOf, isRoot, isOwner, shareMap, containsSharedRoot, canModify, canDeleteItem, canRemoveRemoteFolder, userName, online],
  );

  const shareProblem = useCallback(
    (folderId: string) => {
      const f = byId.get(folderId);
      if (!f) return 'Ordner nicht gefunden.';
      if (!me) return 'Melde dich an, um Ordner zu teilen.';
      if (f.shareId && isRoot(f)) return null; // schon geteilt -> Mitglieder verwalten
      // Unterordner eines eigenen geteilten Ordners (z. B. „Auf allen Geräten“): kann eigens mit weiteren Personen geteilt werden.
      if (f.shareId) {
        if (!isOwner(f.shareId)) return 'Nur der Besitzer kann einen Unterordner eigens mit weiteren Personen teilen.';
        if (orphans.has(folderId)) return 'Dieser geteilte Ordner ist gerade nicht verfügbar.';
        if (!online) return offlineError().message;
        return null;
      }
      if (orphans.has(folderId)) return 'Dieser geteilte Ordner ist gerade nicht verfügbar.';
      const foreign = sharedRootsIn(folderId).find((r) => !isOwner(r.shareId));
      if (foreign) return `„${f.name}“ enthält „${foreign.name}“, der dir nicht gehört.`;
      if (!online) return offlineError().message;
      return null;
    },
    [byId, me, orphans, sharedRootsIn, isOwner, isRoot, online],
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
    // (Nicht für geteilte Ordner, die nur mitkommen, weil sie in einem anderen geteilten Ordner liegen.)
    const remoteIds = new Set(snap.folders.map((f) => f.id));
    snap.shares.forEach((s) => s.ownerId !== me && !snap.seen[s.rootId] && !(s.inside && remoteIds.has(s.inside)) && direct.add(s.rootId));
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

      // Darin liegende geteilte Ordner werden mitgelöscht.
      const nested = [...rootFolders, ...remoteFolders].flatMap((id) => sharedRootsIn(id).map((f) => f.id));
      for (const id of nested) {
        await remote.deleteShare(byId.get(id)!.shareId!, folders, files);
        await local.deletePlaceholder(id).catch(() => {});
      }
      if (localFolders.length || localFiles.length) await local.deleteMany(localData, localFolders, localFiles);
      if (remoteFolders.length || remoteFiles.length) await remote.deleteMany(folders, files, remoteFolders, remoteFiles);
      for (const id of rootFolders) {
        await remote.deleteShare(byId.get(id)!.shareId!, folders, files);
        await local.deletePlaceholder(id).catch(() => {});
      }
      await reload();
    },
    [deleteProblem, folders, files, byId, isRoot, sharedRootsIn, localData, reload],
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
      // In einen eigenen geteilten Ordner: dort auf dem Server einhängen (dann sehen ihn auch dessen Personen).
      for (const id of tops.filter((x) => isRoot(byId.get(x)))) {
        const f = byId.get(id)!;
        if (target === 'local') {
          if (shareMap.get(f.shareId!)?.inside) await remote.setInside(f.shareId!, null);
          await local.putPlaceholder({ id, parentId: targetId, name: f.name, shareId: f.shareId!, createdAt: f.createdAt, createdBy: me });
        } else {
          await remote.setInside(f.shareId!, targetId);
          await local.deletePlaceholder(id).catch(() => {});
        }
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
    [moveProblem, folders, files, storeOf, isRoot, byId, shareMap, localData, reload],
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

  const replaceFileContent = useCallback<LibraryValue['replaceFileContent']>(
    async (file, blob, name) => {
      if (file.shareId) {
        requireOnline();
        if (!canModify(file)) throw new Error('Nur die Person, die die Datei hinzugefügt hat, oder der Besitzer kann sie ändern.');
        // Vorher/Nachher vergleichen, damit die anderen sehen, was sich geändert hat (stark vereinfacht).
        const kind = fileKind(file);
        let before: string | null = null;
        if (comparable(kind) && file.size < 20 * 1024 * 1024) {
          const old = await loadBlob(file.blobId).catch(() => undefined);
          before = old ? await old.text().catch(() => null) : null;
        }
        const summary: ChangePart[] = before === null ? [{ unit: 'version', added: 1, removed: 0, changed: 0 }] : summarize(kind, before, await blob.text());
        await remote.replaceContent(file, blob, name);
        await remote.recordChange(file.id, summary).catch(() => {});
        await refreshRemote();
      } else {
        await local.replaceContent(file, blob, name);
        await reloadLocal();
      }
    },
    [canModify, refreshRemote, reloadLocal, requireOnline],
  );

  const setAccess = useCallback<LibraryValue['setAccess']>(
    async (item, access) => {
      if (!item.shareId) return;
      requireOnline();
      if (!canSetAccess(item)) throw new Error('Nur die Person, die den Eintrag erstellt hat, oder der Besitzer kann die Rechte ändern.');
      await remote.setAccess('folderId' in item ? 'files' : 'folders', item.id, access);
      await refreshRemote();
    },
    [canSetAccess, refreshRemote, requireOnline],
  );

  // ---------- Teilen ----------
  /**
   * Unterordner eines eigenen geteilten Ordners eigens teilen: Er wird (mit neuen IDs, die alten sind auf dem Server belegt)
   * als eigener geteilter Ordner angelegt, an derselben Stelle eingehängt und erst danach am alten Ort entfernt.
   * Wer den äußeren Ordner hat, sieht ihn weiterhin; die neuen Personen sehen nur diesen Ordner.
   */
  const splitShare = useCallback(
    async (sub: Folder, userIds: string[], onProgress?: (msg: string) => void): Promise<string> => {
      const outer = sub.shareId!;
      onProgress?.('Dateien werden vorbereitet …');
      const nested = outerRootsIn(sub.id);
      const bundle = await makeBundle(folders, files, [sub.id], [], loadBlob, nested.map((f) => f.id));
      const ids = new Map<string, string>();
      bundle.folders.forEach((f) => ids.set(f.id, newId()));
      bundle.files.forEach((f) => ids.set(f.id, newId()));
      const moved = {
        folders: bundle.folders.map((f) => ({ ...f, id: ids.get(f.id)!, parentId: f.parentId && (ids.get(f.parentId) ?? null) })),
        files: bundle.files.map((f) => ({ ...f, id: ids.get(f.id)!, folderId: f.folderId && (ids.get(f.folderId) ?? null) })),
      };
      const rootId = ids.get(sub.id)!;
      const shareId = await remote.createShare(rootId);
      try {
        const total = moved.files.length;
        onProgress?.(total ? `Wird übertragen … 0/${total}` : 'Wird übertragen …');
        await remote.importBundle(shareId, null, moved, (n) => onProgress?.(`Wird übertragen … ${n}/${total}`));
        await remote.setInside(shareId, sub.parentId);
        for (const f of nested) await remote.setInside(f.shareId!, ids.get(f.parentId!) ?? sub.parentId);
        await remote.addMembers(shareId, userIds);
      } catch (e) {
        for (const f of nested) await remote.setInside(f.shareId!, f.parentId).catch(() => {});
        await remote.deleteShare(shareId, [], []).catch(() => {});
        throw e;
      }
      onProgress?.('Wird aufgeräumt …');
      // Eigene Rechte-Einstellungen und Häkchen mitnehmen (beides nicht im Paket).
      for (const f of folders) if (f.shareId === outer && f.access && ids.has(f.id)) await remote.setAccess('folders', ids.get(f.id)!, f.access).catch(() => {});
      for (const f of files) if (f.shareId === outer && f.access && ids.has(f.id)) await remote.setAccess('files', ids.get(f.id)!, f.access).catch(() => {});
      await remote.copyChecks(new Map([...ids].filter(([old]) => files.some((f) => f.id === old)))).catch(() => {});
      // Nur Einträge des äußeren Ordners löschen (eingehängte andere geteilte Ordner sind schon umgehängt).
      await remote.deleteMany(folders.filter((f) => f.shareId === outer), files.filter((f) => f.shareId === outer), [sub.id], []);
      await refreshRemote();
      return rootId;
    },
    [outerRootsIn, folders, files, refreshRemote],
  );

  const shareFileProblem = useCallback(
    (fileId: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return 'Datei nicht gefunden.';
      if (!me) return 'Melde dich an, um zu teilen.';
      const parent = byId.get(file.folderId);
      if (!parent) return 'Ordner nicht gefunden.';
      if (parent.shareId && !isOwner(parent.shareId))
        return 'Diese Datei liegt in einem geteilten Ordner von jemand anderem – dort kann nur der ganze Ordner geteilt werden.';
      if (orphans.has(parent.id)) return 'Dieser geteilte Ordner ist gerade nicht verfügbar.';
      if (depthOf(folders, parent.id) >= MAX_DEPTH) return 'Hier ist kein weiterer Unterordner möglich (maximale Ordnertiefe).';
      if (!online) return offlineError().message;
      return null;
    },
    [files, me, byId, isOwner, orphans, folders, online],
  );

  const shareFile = useCallback<LibraryValue['shareFile']>(
    async (fileId, userIds, onProgress) => {
      const problem = shareFileProblem(fileId);
      if (problem) throw new Error(problem);
      const file = files.find((f) => f.id === fileId)!;
      const parent = byId.get(file.folderId)!;
      onProgress?.('Datei wird vorbereitet …');
      const bundle = await makeBundle(folders, files, [], [file.id], loadBlob);
      const rootId = newId();
      const created = new Date().toISOString();
      // Auf dem Server ist die alte ID noch belegt – dann eine neue.
      const newFileId = file.shareId ? newId() : file.id;
      const moved = {
        folders: [{ id: rootId, parentId: null, name: file.name, createdAt: created }],
        files: bundle.files.map((f) => ({ ...f, id: newFileId, folderId: rootId })),
      };
      const shareId = await remote.createShare(rootId);
      try {
        onProgress?.('Hochladen …');
        await remote.importBundle(shareId, null, moved);
        // In einem eigenen geteilten Ordner (z. B. „Auf allen Geräten“) dort einhängen.
        if (parent.shareId) await remote.setInside(shareId, parent.id);
        await remote.addMembers(shareId, userIds);
      } catch (e) {
        await remote.deleteShare(shareId, [], []).catch(() => {});
        throw e;
      }
      onProgress?.('Wird aufgeräumt …');
      if (parent.shareId) {
        if (file.access) await remote.setAccess('files', newFileId, file.access).catch(() => {});
        await remote.copyChecks(new Map([[file.id, newFileId]])).catch(() => {});
        const outer = parent.shareId;
        await remote.deleteMany(folders.filter((f) => f.shareId === outer), files.filter((f) => f.shareId === outer), [], [file.id]);
      } else {
        // Ordner auf dem Gerät: Platzhalter für den neuen geteilten Ordner an derselben Stelle, Datei hier entfernen.
        await local.putPlaceholder({ id: rootId, parentId: parent.id, name: file.name, shareId, createdAt: created, createdBy: me });
        await local.deleteMany(localData, [], [file.id]);
      }
      await reload();
      return rootId;
    },
    [shareFileProblem, files, byId, folders, me, localData, reload],
  );

  const shareFolder = useCallback<LibraryValue['shareFolder']>(
    async (folderId, userIds, onProgress) => {
      const problem = shareProblem(folderId);
      if (problem) throw new Error(problem);
      const sub = byId.get(folderId);
      if (sub?.shareId) return splitShare(sub, userIds, onProgress);
      onProgress?.('Dateien werden vorbereitet …');
      // Bereits geteilte Ordner darin bleiben eigene geteilte Ordner und werden nur eingehängt.
      const nested = outerRootsIn(folderId);
      const bundle = await makeBundle(folders, files, [folderId], [], loadBlob, nested.map((f) => f.id));
      const shareId = await remote.createShare(folderId);
      try {
        const total = bundle.files.length;
        onProgress?.(total ? `Hochladen … 0/${total}` : 'Hochladen …');
        await remote.importBundle(shareId, null, bundle, (n) => onProgress?.(`Hochladen … ${n}/${total}`));
        for (const f of nested) await remote.setInside(f.shareId!, f.parentId);
        await remote.addMembers(shareId, userIds);
      } catch (e) {
        for (const f of nested) await remote.setInside(f.shareId!, null).catch(() => {});
        await remote.deleteShare(shareId, [], []).catch(() => {});
        throw e;
      }
      await local.convertToPlaceholder(localData, folderId, shareId, me!);
      await reload();
      return folderId;
    },
    [shareProblem, byId, splitShare, outerRootsIn, folders, files, localData, reload],
  );

  const stopSharing = useCallback<LibraryValue['stopSharing']>(
    async (shareId, onProgress) => {
      const share = shareMap.get(shareId);
      if (!share || share.ownerId !== me) throw new Error('Nur der Besitzer kann das Teilen beenden.');
      requireOnline();
      const root = byId.get(share.rootId);
      if (!root) throw new Error('Ordner nicht gefunden.');
      // Liegt in einem anderen geteilten Ordner: nur die eigenen Personen entfernen – er bleibt dort für dessen Personen.
      // Ebenso bei "Auf allen Geräten": der Ordner bleibt auf dem Server, nur die anderen Personen verlieren den Zugriff.
      if (parentShareOf(shareId) || user?.sync) {
        onProgress?.('Personen werden entfernt …');
        for (const m of snap?.members.filter((x) => x.shareId === shareId) ?? []) await remote.removeMember(shareId, m.userId);
        await refreshRemote();
        return;
      }
      onProgress?.('Dateien werden heruntergeladen …');
      const nested = outerRootsIn(root.id);
      const bundle = await makeBundle(folders, files, [root.id], [], loadBlob, nested.map((f) => f.id));
      const target = root.parentId === SHARED_ROOT ? null : root.parentId;
      onProgress?.('Wird auf diesem Gerät gespeichert …');
      await local.importBundle(target, bundle);
      // Darin liegende geteilte Ordner bleiben geteilt und an ihrer Stelle.
      for (const f of nested) await local.putPlaceholder({ id: f.id, parentId: f.parentId, name: f.name, shareId: f.shareId!, createdAt: f.createdAt, createdBy: me });
      onProgress?.('Wird vom Server entfernt …');
      await remote.deleteShare(shareId, folders, files);
      await reload();
    },
    [shareMap, me, user, byId, folders, files, snap, parentShareOf, outerRootsIn, refreshRemote, reload, requireOnline],
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

  // ---------- Konto löschen & Übergaben ----------
  const handovers = useMemo(() => rawSnap?.handovers ?? [], [rawSnap]);

  /** Alles, was zu einer Übergabe gehört (aus dem vollständigen Stand, auch wenn es ausgeblendet ist). */
  const handoverParts = useCallback(
    (id: string) => {
      const h = rawSnap?.handovers?.find((x) => x.id === id);
      if (!h || !rawSnap) throw new Error('Diese Übergabe gibt es nicht mehr.');
      const set = new Set(h.shareIds);
      const hShares = rawSnap.shares.filter((s) => set.has(s.id));
      const hFolders = rawSnap.folders.filter((f) => set.has(f.shareId!));
      const hFiles = rawSnap.files.filter((f) => set.has(f.shareId!));
      const folderIds = new Set(hFolders.map((f) => f.id));
      // Oberste Ebene: geteilte Ordner, die nicht in einem anderen davon liegen.
      const tops = hShares.filter((s) => !(s.inside && folderIds.has(s.inside)) && folderIds.has(s.rootId));
      return { h, hShares, hFolders, hFiles, folderIds, tops };
    },
    [rawSnap],
  );

  const handoverStats = useCallback(
    (h: Handover): HandoverStats => {
      const { hShares, hFolders, hFiles, tops } = handoverParts(h.id);
      const ids = new Set(hShares.map((s) => s.id));
      const people = new Set<string>();
      rawSnap?.members.forEach((m) => ids.has(m.shareId) && m.userId !== me && people.add(m.userId));
      return {
        folders: hFolders.length,
        files: hFiles.length,
        bytes: hFiles.reduce((sum, f) => sum + (f.size || 0), 0),
        names: tops.map((s) => hFolders.find((f) => f.id === s.rootId)?.name ?? '').filter(Boolean),
        people: [...people].map((id) => profileMap.get(id) ?? 'Unbekannt').sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })),
      };
    },
    [handoverParts, rawSnap, me, profileMap],
  );

  const claimHandover = useCallback<LibraryValue['claimHandover']>(
    async (id, mode, onProgress) => {
      requireOnline();
      const { hShares, hFolders, hFiles, folderIds, tops } = handoverParts(id);
      if (mode === 'shared') {
        await remote.closeHandover(id);
        // Wie bei eigenen geteilten Ordnern: unter „Meine Ordner“ (auf diesem Gerät) anzeigen.
        for (const s of tops) {
          const root = hFolders.find((f) => f.id === s.rootId)!;
          await local.putPlaceholder({ id: root.id, parentId: null, name: root.name, shareId: s.id, createdAt: root.createdAt, createdBy: me });
        }
        await reload();
        return;
      }
      onProgress?.('Dateien werden heruntergeladen …');
      // Innere geteilte Ordner liegen danach als normale Unterordner dort, wo sie eingehängt waren.
      const tree = hFolders.map((f) => {
        if (f.parentId !== null) return f;
        const s = hShares.find((x) => x.rootId === f.id);
        return s?.inside && folderIds.has(s.inside) ? { ...f, parentId: s.inside } : f;
      });
      const bundle = await makeBundle(tree, hFiles, tops.map((s) => s.rootId), [], loadBlob);
      const total = bundle.files.length;
      onProgress?.('Wird auf diesem Gerät gespeichert …');
      await local.importBundle(null, bundle, (n) => onProgress?.(`Wird auf diesem Gerät gespeichert … ${n}/${total}`));
      onProgress?.('Wird vom Server entfernt …');
      for (const s of hShares) await remote.deleteShare(s.id, hFolders, hFiles);
      await remote.closeHandover(id);
      await reload();
    },
    [requireOnline, handoverParts, reload],
  );

  const declineHandover = useCallback<LibraryValue['declineHandover']>(
    async (id) => {
      requireOnline();
      const { hShares, hFolders, hFiles } = handoverParts(id);
      for (const s of hShares) await remote.deleteShare(s.id, hFolders, hFiles);
      await remote.closeHandover(id);
      await refreshRemote();
    },
    [requireOnline, handoverParts, refreshRemote],
  );

  const ownedRoots = useMemo(
    () => folders.filter((f) => isRoot(f) && isOwner(f.shareId) && !parentShareOf(f.shareId)),
    [folders, isRoot, isOwner, parentShareOf],
  );

  const deleteAccount = useCallback<LibraryValue['deleteAccount']>(
    async (recipient, wipeLocal, onProgress) => {
      if (!me || !supabase) throw new Error('Du bist nicht angemeldet.');
      requireOnline();
      onProgress?.('Wird vorbereitet …');
      // Frischer Stand: auch Ordner, die mir übergeben wurden und noch warten, gehören dazu.
      const fresh = await remote.fetchSnapshot(me);
      if (!fresh.handoversReady) throw new Error(remote.NOT_READY);
      const owned = fresh.shares.filter((s) => s.ownerId === me);
      if (!recipient) {
        for (let i = 0; i < owned.length; i++) {
          onProgress?.(`Geteilte Ordner werden gelöscht … ${i + 1}/${owned.length}`);
          await remote.deleteShare(owned[i].id, fresh.folders, fresh.files);
        }
      }
      onProgress?.('Konto wird gelöscht …');
      await remote.deleteOwnAccount(recipient);
      if (wipeLocal) {
        onProgress?.('Daten auf diesem Gerät werden gelöscht …');
        await db.clearAll();
      } else {
        // Platzhalter der eigenen geteilten Ordner auf diesem Gerät entfernen („Meine Ordner“ bleiben).
        const ownedIds = new Set(owned.map((s) => s.id));
        for (const f of localData.folders) {
          if (f.shareId && ownedIds.has(f.shareId)) await local.deletePlaceholder(f.id).catch(() => {});
        }
      }
      // Das Konto gibt es nicht mehr – nur noch auf dem Gerät abmelden.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => signOut());
      await reloadLocal();
    },
    [me, requireOnline, localData, signOut, reloadLocal],
  );

  // ---------- „Meine Ordner“ auf allen Geräten ----------
  // Ist es eingeschaltet, wird jeder eigene Ordner der obersten Ebene, der nur auf diesem Gerät liegt,
  // automatisch „mit niemandem geteilt“ – so erscheint er auf allen Geräten dieses Kontos.
  // Immer nur ein Ordner auf einmal; danach lädt der Stand neu und der nächste ist dran.
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<SyncState['errors']>([]);
  const syncRunning = useRef(false);
  const syncOn = !!user?.sync && !!supabase;
  const localTops = useMemo(() => localData.folders.filter((f) => f.parentId === null && !f.shareId), [localData]);
  const nextToSync = useMemo(
    () => (syncOn ? localTops.find((f) => !syncErrors.some((e) => e.id === f.id)) : undefined),
    [syncOn, localTops, syncErrors],
  );

  useEffect(() => {
    if (!nextToSync || !online || !localReady || !authReady || !remoteReady || syncRunning.current) return;
    syncRunning.current = true;
    const f = nextToSync;
    setSyncBusy(`„${f.name}“ wird hochgeladen …`);
    shareFolder(f.id, [], (msg) => setSyncBusy(`„${f.name}“: ${msg}`))
      .catch((e) => setSyncErrors((list) => [...list, { id: f.id, name: f.name, message: e instanceof Error ? e.message : 'Das hat nicht geklappt.' }]))
      .finally(() => {
        syncRunning.current = false;
        setSyncBusy(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextToSync, online, remoteReady]);

  const retrySync = useCallback(() => setSyncErrors([]), []);
  const sync = useMemo<SyncState>(
    () => ({ on: syncOn, busy: syncBusy, errors: syncErrors.filter((e) => localTops.some((f) => f.id === e.id)), pending: syncOn ? localTops.length : 0 }),
    [syncOn, syncBusy, syncErrors, localTops],
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
      replaceFileContent,
      deleteMany,
      moveMany,
      reload,
      me: user,
      online,
      shares: snap?.shares ?? [],
      members: snap?.members ?? [],
      profiles: snap?.profiles ?? [],
      userName,
      avatarOf,
      commentInfo,
      markCommentsRead,
      changesFor,
      markChangesSeen,
      shareOf,
      isRoot,
      isOwner,
      isOrphan,
      canModify,
      canEditFolder,
      canDeleteItem,
      accessOf,
      inheritedAccessOf,
      canSetAccess,
      setAccess,
      canAddIn,
      deleteProblem,
      moveProblem,
      shareProblem,
      unread,
      seenAt,
      isNewSince,
      markSeen,
      shareFolder,
      shareFileProblem,
      shareFile,
      stopSharing,
      addMembers,
      removeMember,
      leaveShare,
      refreshRemote,
      parentShareOf,
      peopleOf,
      handovers,
      handoversReady: rawSnap?.handoversReady !== false,
      handoverStats,
      claimHandover,
      declineHandover,
      ownedRoots,
      deleteAccount,
      sync,
      retrySync,
    }),
    [
      ready, error, folders, files, createFolder, updateFolder, deleteFolder, addFiles, updateFile, deleteFile, replaceFileContent, deleteMany, moveMany, reload,
      user, online, snap, userName, avatarOf, commentInfo, markCommentsRead, changesFor, markChangesSeen, shareOf, isRoot, isOwner, isOrphan, canModify, canEditFolder, canDeleteItem, accessOf, inheritedAccessOf, canSetAccess, setAccess, canAddIn, deleteProblem, moveProblem,
      shareProblem, unread, seenAt, isNewSince, markSeen, shareFolder, shareFileProblem, shareFile, stopSharing, addMembers, removeMember, leaveShare, refreshRemote, parentShareOf, peopleOf,
      handovers, rawSnap, handoverStats, claimHandover, declineHandover, ownedRoots, deleteAccount, sync, retrySync,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary außerhalb von LibraryProvider');
  return v;
}
