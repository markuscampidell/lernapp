import { useEffect, useMemo, useState } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { useAuth } from '../../cloud/auth';
import { afterBack, folderHash, replace } from '../../lib/router';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { AccountCard } from '../account/AccountCard';
import { UserPicker } from './UserPicker';

/**
 * „Personen“ eines Ordners oder einer Datei – überall gleich aufgebaut:
 * Besitzer, dann wer über den übergeordneten geteilten Ordner Zugriff hat (fest), dann wer nur hier hinzugefügt wurde.
 * Der Besitzer kann Personen hinzufügen; sie sehen dann nur diesen Ordner (bzw. nur diese Datei).
 */
export function ShareSheet({ folder: target, file, onClose }: { folder?: Folder; file?: FileItem; onClose: () => void }) {
  const lib = useLibrary();
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { refreshRemote } = lib;

  // Frische Liste aller Personen (neu Registrierte).
  useEffect(() => {
    refreshRemote();
  }, [refreshRemote, user?.id]);

  // Bei einer Datei: der Ordner, in dem sie liegt.
  const folder = file ? lib.folders.find((f) => f.id === file.folderId) : target;
  const name = file ? file.name : folder?.name ?? '…';
  // Eigener geteilter Ordner (dieser Ordner ist dessen oberster) – nur bei Ordnern.
  const share = !file && folder && lib.isRoot(folder) ? lib.shareOf(folder) : undefined;
  // Der geteilte Ordner darüber, über den andere schon Zugriff haben.
  const above = share ? lib.parentShareOf(share.id) : folder?.shareId ? lib.shareOf(folder) : undefined;
  // Bei Dateien heißt die Gruppe wie der Ordner, in dem die Datei liegt; bei Ordnern wie der oberste geteilte Ordner darüber.
  const aboveName = file ? folder?.name ?? '…' : above ? lib.folders.find((f) => f.id === above.rootId)?.name ?? '…' : '';
  const aboveRootName = above ? lib.folders.find((f) => f.id === above.rootId)?.name ?? '…' : '';
  const ownerId = share?.ownerId ?? above?.ownerId ?? user?.id ?? '';
  const amOwner = !!user && ownerId === user.id;

  const memberIds = useMemo(() => (share ? lib.members.filter((m) => m.shareId === share.id).map((m) => m.userId) : []), [lib.members, share]);
  const inherited = useMemo(() => new Set(above ? lib.peopleOf(above.id) : []), [above, lib]);
  const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort((a, b) => lib.userName(a).localeCompare(lib.userName(b), 'de', { sensitivity: 'base' }));
  const fromAbove = sorted([...inherited].filter((id) => id !== ownerId));
  const onlyHere = sorted(memberIds.filter((id) => !inherited.has(id) && id !== ownerId));
  // Wer schon Zugriff hat, kann nicht noch einmal hinzugefügt werden.
  const exclude = useMemo(() => new Set([ownerId, ...(user ? [user.id] : []), ...memberIds, ...inherited]), [ownerId, user, memberIds, inherited]);

  // Hinzufügen: in den eigenen geteilten Ordner – sonst wird der Ordner (bzw. die Datei in einem eigenen Ordner) neu geteilt.
  const addProblem = !user
    ? 'Melde dich an.'
    : file
    ? lib.shareFileProblem(file.id)
    : share
    ? amOwner
      ? lib.online
        ? null
        : 'Offline – Änderungen sind gerade nicht möglich.'
      : 'Nur der Besitzer kann Personen hinzufügen.'
    : folder
    ? lib.shareProblem(folder.id)
    : 'Ordner nicht gefunden.';
  const canAdd = amOwner && !addProblem;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      return true;
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!user) {
    return (
      <Sheet title={`„${name}“ – Personen`} onClose={onClose}>
        <p className="muted">Zum Teilen brauchst du ein Konto. Melde dich an oder registriere dich – das dauert nur einen Moment.</p>
        <AccountCard />
      </Sheet>
    );
  }
  if (!folder) return null;

  const add = async () => {
    const ids = [...selected];
    if (share) {
      if (await run('Wird hinzugefügt …', () => lib.addMembers(share.id, ids))) {
        setSelected(new Set());
        setAdding(false);
      }
      return;
    }
    let newId = folder.id;
    const here = !file && location.hash.includes(encodeURIComponent(folder.id));
    const ok = await run('Wird hinzugefügt …', async () => {
      newId = file ? await lib.shareFile(file.id, ids, (msg) => setBusy(msg)) : await lib.shareFolder(folder.id, ids, (msg) => setBusy(msg));
    });
    if (!ok) return;
    onClose();
    // Unterordner wurde neu angelegt (neue ID) -> dorthin wechseln.
    if (newId !== folder.id && here) afterBack(() => replace(folderHash(newId)));
  };

  // ---------- Personen hinzufügen ----------
  if (adding) {
    const inner = !file && !folder.shareId ? [...subtreeIds(lib.folders, folder.id)].filter((id) => id !== folder.id && lib.isRoot(lib.folders.find((f) => f.id === id))) : [];
    return (
      <Sheet
        title="Personen hinzufügen"
        onClose={() => !busy && onClose()}
        leading={
          <button className="icon-btn" aria-label="Zurück" onClick={() => (setAdding(false), setSelected(new Set()))} disabled={!!busy}>
            <Icon name="back" />
          </button>
        }
        footer={
          <button className="btn primary grow" disabled={!selected.size || !!busy || !!addProblem} onClick={add}>
            {busy ?? (selected.size ? `${selected.size} ${selected.size === 1 ? 'Person' : 'Personen'} hinzufügen` : 'Hinzufügen')}
          </button>
        }
      >
        <p className="muted small">
          {file
            ? `Die neuen Personen sehen nur diese Datei. Dafür entsteht in „${folder.name}“ der Ordner „${file.name}“, die Datei kommt hinein und nur er wird mit ihnen geteilt.`
            : above
            ? `Die neuen Personen sehen nur „${folder.name}“, nicht den Rest von „${aboveName}“.`
            : share
            ? `Die neuen Personen sehen „${folder.name}“ mit allem darin.`
            : `„${folder.name}“ wird mit allem darin auf den Server geladen und bleibt bei dir unter „Meine Ordner“. Die Personen sehen ihn unter „Geteilte Ordner“. Max. 50 MB pro Datei.`}
        </p>
        {inner.length > 0 && (
          <p className="notice info">
            {inner.length === 1 ? 'Ein Ordner darin ist' : `${inner.length} Ordner darin sind`} bereits eigens geteilt – die neuen Personen sehen{' '}
            {inner.length === 1 ? 'ihn' : 'sie'} mit.
          </p>
        )}
        {addProblem ? <p className="notice warning">{addProblem}</p> : <UserPicker profiles={lib.profiles} exclude={exclude} selected={selected} onChange={setSelected} />}
        {err && <p className="notice critical">{err}</p>}
      </Sheet>
    );
  }

  // ---------- Personen ansehen ----------
  // Verlassen: dort, wo ich wirklich Mitglied bin. Habe ich über einen äußeren Ordner Zugriff, hilft nur, den zu verlassen.
  const meDirect = !!share && memberIds.includes(user.id) && !inherited.has(user.id);
  const viaShare = (() => {
    if (meDirect || amOwner) return undefined;
    for (let s = above, i = 0; s && i < 16; s = lib.parentShareOf(s.id), i++) if (lib.members.some((m) => m.shareId === s!.id && m.userId === user.id)) return s;
    return undefined;
  })();
  const aboveMember = !!viaShare;
  const viaName = viaShare ? lib.folders.find((f) => f.id === viaShare.rootId)?.name ?? '…' : '';
  const footer = busy ? (
    <button className="btn ghost grow" disabled>
      {busy}
    </button>
  ) : share && amOwner && onlyHere.length > 0 ? (
    <button
      className="btn ghost danger grow"
      disabled={!lib.online}
      onClick={async () => {
        const text = above
          ? `Teilen von „${folder.name}“ beenden?\n\nDie nur hier hinzugefügten Personen sehen den Ordner dann nicht mehr. Die Personen von „${aboveName}“ sehen ihn weiterhin.`
          : lib.sync.on
          ? `Teilen von „${folder.name}“ beenden?\n\nDie anderen Personen sehen den Ordner dann nicht mehr. Für dich bleibt er auf allen deinen Geräten.`
          : `Teilen von „${folder.name}“ beenden?\n\nAlle Inhalte (auch die der anderen) werden auf dieses Gerät heruntergeladen und für alle anderen entfernt.`;
        if (!confirm(text)) return;
        if (await run('Wird beendet …', () => lib.stopSharing(share.id, (msg) => setBusy(msg)))) onClose();
      }}
    >
      Teilen beenden
    </button>
  ) : meDirect || aboveMember ? (
    <button
      className="btn ghost danger grow"
      disabled={!lib.online}
      onClick={async () => {
        const which = meDirect ? share! : viaShare!;
        const whichName = meDirect ? folder.name : viaName;
        if (!confirm(`„${whichName}“ verlassen? Du siehst den Ordner dann nicht mehr. Deine Einträge darin bleiben für die anderen erhalten.`)) return;
        if (await run('Wird verlassen …', () => lib.leaveShare(which.id))) {
          onClose();
          afterBack(() => replace('#geteilt'));
        }
      }}
    >
      „{meDirect ? folder.name : viaName}“ verlassen
    </button>
  ) : undefined;

  const removeOnlyHere = (id: string) => {
    if (!share) return;
    const keeps = innerSharesWith(id);
    const text =
      `${lib.userName(id)} aus „${folder.name}“ entfernen?` +
      (keeps.length ? `\n\n${lib.userName(id)} wurde auch eigens zu ${keeps.map((n) => `„${n}“`).join(', ')} hinzugefügt und sieht ${keeps.length === 1 ? 'diesen Ordner' : 'diese Ordner'} weiterhin.` : '');
    if (confirm(text)) run('Wird entfernt …', () => lib.removeMember(share.id, id));
  };
  /** Eigens geteilte Ordner darin, zu denen diese Person zusätzlich direkt hinzugefügt ist (behält dort Zugriff). */
  function innerSharesWith(personId: string) {
    return lib.shares
      .filter((s) => {
        if (s.id === share!.id || !lib.members.some((m) => m.shareId === s.id && m.userId === personId)) return false;
        for (let p = lib.parentShareOf(s.id), i = 0; p && i < 16; p = lib.parentShareOf(p.id), i++) if (p.id === share!.id) return true;
        return false;
      })
      .map((s) => lib.folders.find((f) => f.id === s.rootId)?.name ?? '…');
  }

  const nobody = fromAbove.length === 0 && onlyHere.length === 0;
  return (
    <Sheet title={`„${name}“ – Personen`} onClose={() => !busy && onClose()} footer={footer}>
      <div className="people">
        <PersonRow id={ownerId} you={ownerId === user.id} label="Besitzer" />
      </div>

      {fromAbove.length > 0 && (
        <section className="people-group">
          <h3 className="people-group-title">
            <Icon name="folder" size={15} /> Von „{aboveName}“
          </h3>
          <p className="muted small">
            {file ? 'Alle Personen dieses Ordners sehen die Datei.' : `Alle Personen von „${aboveName}“ sehen diesen Ordner.`} Das lässt sich hier nicht ändern
            {amOwner ? ` – nur in „${aboveRootName}“ selbst.` : '.'}
          </p>
          <div className="people">
            {fromAbove.map((id) => (
              <PersonRow key={id} id={id} you={id === user.id} label="Mitglied" />
            ))}
          </div>
        </section>
      )}

      {onlyHere.length > 0 && (
        <section className="people-group">
          <h3 className="people-group-title">
            <Icon name="users" size={15} /> {above ? 'Nur in diesem Ordner' : 'Mitglieder'}
          </h3>
          {above && <p className="muted small">Diese Personen sehen nur „{folder.name}“, nicht den Rest von „{aboveName}“.</p>}
          {(
            <div className="people">
              {onlyHere.map((id) => (
                <PersonRow key={id} id={id} you={id === user.id} label="Mitglied">
                  {amOwner && (
                    <button className="btn ghost small danger" disabled={!!busy || !lib.online} onClick={() => removeOnlyHere(id)}>
                      Entfernen
                    </button>
                  )}
                </PersonRow>
              ))}
            </div>
          )}
        </section>
      )}

      {nobody && <p className="muted small">{file ? 'Nur du siehst diese Datei.' : 'Noch mit niemandem geteilt – nur du siehst diesen Ordner.'}</p>}

      {amOwner && (
        <button className="btn ghost" onClick={() => setAdding(true)} disabled={!canAdd} title={addProblem ?? undefined}>
          <Icon name="plus" size={18} /> Personen hinzufügen
        </button>
      )}
      {amOwner && addProblem && <p className="muted small">{addProblem}</p>}
      <p className="muted small">
        {amOwner
          ? 'Mitglieder können Dateien und Unterordner hinzufügen und ihre eigenen Einträge ändern oder löschen. Du kannst alles ändern.'
          : `Mitglieder können Dateien und Unterordner hinzufügen und ihre eigenen Einträge ändern oder löschen. Alles andere verwaltet ${lib.userName(ownerId)}.`}
      </p>
      {!lib.online && <p className="notice warning">Offline – Änderungen sind gerade nicht möglich.</p>}
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}

/** Eine Person in der Liste, rechts optional ein Knopf. */
function PersonRow({ id, label, you, children }: { id: string; label: string; you?: boolean; children?: React.ReactNode }) {
  const { userName } = useLibrary();
  return (
    <div className="person">
      <Avatar id={id} expand />
      <div className="card-main">
        <strong className="ellipsis">
          {userName(id)}
          {you && <span className="muted"> (du)</span>}
        </strong>
        <span className="muted small">{label}</span>
      </div>
      {children}
    </div>
  );
}
