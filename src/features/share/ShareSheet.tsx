import { Avatar } from '../../components/Avatar';
import { useEffect, useMemo, useState } from 'react';
import type { Folder } from '../../domain/types';
import { subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { useAuth } from '../../cloud/auth';
import { afterBack, folderHash, replace } from '../../lib/router';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { AccountCard } from '../account/AccountCard';
import { UserPicker } from './UserPicker';

/** Ordner teilen bzw. Personen eines geteilten Ordners verwalten. */
export function ShareSheet({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const lib = useLibrary();
  const { user } = useAuth();
  const share = lib.isRoot(folder) ? lib.shareOf(folder) : undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { refreshRemote } = lib;

  // Frische Liste aller Personen (neu Registrierte).
  useEffect(() => {
    refreshRemote();
  }, [refreshRemote, user?.id]);

  const memberIds = useMemo(() => (share ? lib.members.filter((m) => m.shareId === share.id).map((m) => m.userId) : []), [lib.members, share]);
  const exclude = useMemo(() => new Set([...(user ? [user.id] : []), ...memberIds, ...(share ? [share.ownerId] : [])]), [user, memberIds, share]);

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

  // ---------- Nicht angemeldet ----------
  if (!user) {
    return (
      <Sheet title="Ordner teilen" onClose={onClose}>
        <p className="muted">Zum Teilen brauchst du ein Konto. Melde dich an oder registriere dich – das dauert nur einen Moment.</p>
        <AccountCard />
      </Sheet>
    );
  }

  // ---------- Noch nicht geteilt ----------
  if (!share) {
    const problem = lib.shareProblem(folder.id);
    // Unterordner eines eigenen geteilten Ordners (z. B. „Auf allen Geräten“) wird eigens geteilt.
    const outer = folder.shareId ? lib.shareOf(folder) : undefined;
    const outerName = outer ? lib.folders.find((f) => f.id === outer.rootId)?.name ?? '…' : '';
    const outerPeople = outer ? lib.peopleOf(outer.id).filter((id) => id !== user.id).map((id) => lib.userName(id)) : [];
    const inner = [...subtreeIds(lib.folders, folder.id)].filter((id) => id !== folder.id && lib.isRoot(lib.folders.find((f) => f.id === id)));
    return (
      <Sheet
        title={`„${folder.name}“ teilen`}
        onClose={() => !busy && onClose()}
        footer={
          <button
            className="btn primary grow"
            disabled={!!problem || !!busy}
            onClick={async () => {
              let newId = folder.id;
              const here = location.hash.includes(encodeURIComponent(folder.id));
              const ok = await run('Teilen …', async () => {
                newId = await lib.shareFolder(folder.id, [...selected], (msg) => setBusy(msg));
              });
              if (!ok) return;
              onClose();
              // Unterordner wurde neu angelegt (neue ID) -> dorthin wechseln.
              if (newId !== folder.id && here) afterBack(() => replace(folderHash(newId)));
            }}
          >
            {busy ?? (selected.size ? `Mit ${selected.size} ${selected.size === 1 ? 'Person' : 'Personen'} teilen` : 'Teilen')}
          </button>
        }
      >
        <p className="muted small">
          Der Ordner wird mit allem darin auf den Server geladen und bleibt bei dir unter „Meine Ordner“. Die ausgewählten Personen sehen ihn unter
          „Geteilte Ordner“ und können Dateien und Unterordner hinzufügen. Ändern oder löschen dürfen sie nur, was sie selbst erstellt haben – du als
          Besitzer darfst alles. Max. 50 MB pro Datei.
        </p>
        {outer && !problem && (
          <p className="notice info">
            Liegt in „{outerName}“{outerPeople.length ? ` (geteilt mit ${outerPeople.join(', ')} – sie sehen ihn weiterhin)` : ''}. Die ausgewählten Personen sehen nur
            diesen Ordner, nicht den Rest von „{outerName}“.
          </p>
        )}
        {inner.length > 0 && !problem && (
          <p className="notice info">
            {inner.length === 1 ? 'Ein Ordner darin ist' : `${inner.length} Ordner darin sind`} bereits geteilt. Die ausgewählten Personen sehen{' '}
            {inner.length === 1 ? 'ihn' : 'sie'} mit – wer bisher nur {inner.length === 1 ? 'diesen Ordner' : 'diese Ordner'} hatte, sieht weiterhin nur{' '}
            {inner.length === 1 ? 'ihn' : 'sie'}.
          </p>
        )}
        {problem ? <p className="notice warning">{problem}</p> : <UserPicker profiles={lib.profiles} exclude={exclude} selected={selected} onChange={setSelected} />}
        {err && <p className="notice critical">{err}</p>}
      </Sheet>
    );
  }

  // ---------- Geteilt: Personen verwalten ----------
  const owner = share.ownerId === user.id;
  const people = [share.ownerId, ...memberIds];
  // Liegt in einem anderen geteilten Ordner: dessen Personen sehen ihn mit.
  const parent = lib.parentShareOf(share.id);
  const parentName = parent ? lib.folders.find((f) => f.id === parent.rootId)?.name ?? '…' : '';
  const viaParent = parent ? lib.peopleOf(parent.id).filter((id) => !people.includes(id)) : [];
  const direct = owner || memberIds.includes(user.id);

  return (
    <Sheet
      title={`„${folder.name}“ – Personen`}
      onClose={() => !busy && onClose()}
      footer={
        adding ? (
          <>
            <button className="btn ghost" onClick={() => (setAdding(false), setSelected(new Set()))} disabled={!!busy}>
              Abbrechen
            </button>
            <button
              className="btn primary grow"
              disabled={!selected.size || !!busy}
              onClick={async () => {
                if (await run('Wird hinzugefügt …', () => lib.addMembers(share.id, [...selected]))) {
                  setSelected(new Set());
                  setAdding(false);
                }
              }}
            >
              {busy ?? `${selected.size || ''} hinzufügen`.trim()}
            </button>
          </>
        ) : owner && (parent || lib.sync.on) && memberIds.length === 0 ? undefined : owner ? (
          <button
            className="btn ghost danger grow"
            disabled={!!busy || !lib.online}
            onClick={async () => {
              const text = parent
                ? `Teilen von „${folder.name}“ beenden?\n\nDie hier hinzugefügten Personen sehen den Ordner dann nicht mehr. Er bleibt in „${parentName}“ für alle Personen von dort.`
                : lib.sync.on
                ? `Teilen von „${folder.name}“ beenden?\n\nDie anderen Personen sehen den Ordner dann nicht mehr. Für dich bleibt er auf allen deinen Geräten.`
                : `Teilen von „${folder.name}“ beenden?\n\nAlle Inhalte (auch die der anderen) werden auf dieses Gerät heruntergeladen und für alle anderen entfernt.`;
              if (!confirm(text)) return;
              if (await run('Wird beendet …', () => lib.stopSharing(share.id, (msg) => setBusy(msg)))) onClose();
            }}
          >
            {busy ?? 'Teilen beenden'}
          </button>
        ) : !direct ? undefined : (
          <button
            className="btn ghost danger grow"
            disabled={!!busy || !lib.online}
            onClick={async () => {
              if (!confirm(`„${folder.name}“ verlassen? Du siehst den Ordner dann nicht mehr. Deine Einträge darin bleiben für die anderen erhalten.`)) return;
              if (await run('Wird verlassen …', () => lib.leaveShare(share.id))) {
                onClose();
                afterBack(() => replace('#geteilt'));
              }
            }}
          >
            {busy ?? 'Ordner verlassen'}
          </button>
        )
      }
    >
      {adding ? (
        <UserPicker profiles={lib.profiles} exclude={exclude} selected={selected} onChange={setSelected} />
      ) : (
        <>
          <div className="people">
            {people.map((id) => (
              <div key={id} className="person">
                <Avatar id={id} />
                <div className="card-main">
                  <strong className="ellipsis">
                    {lib.userName(id)}
                    {id === user.id && <span className="muted"> (du)</span>}
                  </strong>
                  <span className="muted small">{id === share.ownerId ? 'Besitzer' : 'Mitglied'}</span>
                </div>
                {owner && id !== share.ownerId && (
                  <button
                    className="btn ghost small danger"
                    disabled={!!busy || !lib.online}
                    onClick={() => confirm(`${lib.userName(id)} aus „${folder.name}“ entfernen?`) && run('…', () => lib.removeMember(share.id, id))}
                  >
                    Entfernen
                  </button>
                )}
              </div>
            ))}
          </div>
          {parent && (
            <p className="muted small">
              Liegt in „{parentName}“ – {viaParent.length ? `außerdem sehen ihn ${viaParent.map((id) => (id === user.id ? 'du' : lib.userName(id))).join(', ')}.` : 'alle Personen von dort sehen ihn auch.'}
            </p>
          )}
          {owner && (
            <button className="btn ghost" onClick={() => setAdding(true)} disabled={!lib.online}>
              <Icon name="plus" size={18} /> Personen hinzufügen
            </button>
          )}
          <p className="muted small">
            {owner
              ? 'Mitglieder können Dateien und Unterordner hinzufügen und ihre eigenen Einträge ändern oder löschen. Du kannst alles ändern.'
              : `Du kannst Dateien und Unterordner hinzufügen und deine eigenen Einträge ändern oder löschen. Alles andere verwaltet ${lib.userName(share.ownerId)}.`}
          </p>
          {!lib.online && <p className="notice warning">Offline – Änderungen sind gerade nicht möglich.</p>}
        </>
      )}
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}
