import { useEffect, useMemo, useState } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { useAuth } from '../../cloud/auth';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { AccountCard } from '../account/AccountCard';
import { UserPicker } from './UserPicker';

/**
 * Teilen aus einer Datei heraus: Entweder den Ordner, in dem sie liegt, ganz normal teilen –
 * oder einen eigenen Ordner nur für diese Datei anlegen und nur ihn teilen.
 */
export function FileShareSheet({ file, onClose, onFolder }: { file: FileItem; onClose: () => void; onFolder: (target: Folder) => void }) {
  const lib = useLibrary();
  const { user } = useAuth();
  const [step, setStep] = useState<'choose' | 'people'>('choose');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { refreshRemote } = lib;

  useEffect(() => {
    refreshRemote();
  }, [refreshRemote, user?.id]);

  const parent = lib.folders.find((f) => f.id === file.folderId);
  // Gleiches Ziel wie das Personen-Symbol im Ordner selbst.
  const ownSub = !!parent?.shareId && !lib.isRoot(parent) && lib.isOwner(parent.shareId);
  const target = !parent ? undefined : !parent.shareId || lib.isRoot(parent) || ownSub ? parent : lib.folders.find((f) => f.id === lib.shareOf(parent)?.rootId);
  const targetShare = target && lib.isRoot(target) ? lib.shareOf(target) : undefined;
  const others = targetShare ? lib.peopleOf(targetShare.id).filter((id) => id !== user?.id) : [];
  const exclude = useMemo(() => new Set(user ? [user.id] : []), [user]);
  const problem = lib.shareFileProblem(file.id);

  if (!user) {
    return (
      <Sheet title="Teilen" onClose={onClose}>
        <p className="muted">Zum Teilen brauchst du ein Konto. Melde dich an oder registriere dich – das dauert nur einen Moment.</p>
        <AccountCard />
      </Sheet>
    );
  }

  if (step === 'people') {
    return (
      <Sheet
        title={`„${file.name}“ teilen`}
        onClose={() => !busy && onClose()}
        leading={
          <button className="icon-btn" aria-label="Zurück" onClick={() => setStep('choose')} disabled={!!busy}>
            <Icon name="back" />
          </button>
        }
        footer={
          <button
            className="btn primary grow"
            disabled={!!problem || !!busy}
            onClick={async () => {
              setErr(null);
              setBusy('Teilen …');
              try {
                await lib.shareFile(file.id, [...selected], (msg) => setBusy(msg));
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy ?? (selected.size ? `Mit ${selected.size} ${selected.size === 1 ? 'Person' : 'Personen'} teilen` : 'Teilen')}
          </button>
        }
      >
        <p className="muted small">
          In „{parent?.name ?? '…'}“ entsteht der Ordner „{file.name}“, die Datei kommt hinein und nur dieser Ordner wird geteilt. Die Personen sehen ihn
          unter „Geteilte Ordner“ und können dort auch eigene Dateien hinzufügen.
        </p>
        {problem ? <p className="notice warning">{problem}</p> : <UserPicker profiles={lib.profiles} exclude={exclude} selected={selected} onChange={setSelected} />}
        {err && <p className="notice critical">{err}</p>}
      </Sheet>
    );
  }

  return (
    <Sheet title={`„${file.name}“ teilen`} onClose={onClose}>
      <div className="stack">
        <p className="muted small">Geteilt werden immer Ordner. Was möchtest du teilen?</p>
        {target && (
          <button className="choice" onClick={() => onFolder(target)}>
            <strong>
              <Icon name="folder" size={16} /> {others.length ? `Personen von „${target.name}“` : `Ganzen Ordner „${target.name}“ teilen`}
            </strong>
            <span className="muted small">
              {others.length
                ? `„${target.name}“ ist schon geteilt mit ${others.map((id) => lib.userName(id)).join(', ')} – die Datei sehen sie bereits.`
                : 'Alle Dateien und Unterordner darin werden mitgeteilt.'}
            </span>
          </button>
        )}
        <button className="choice" onClick={() => setStep('people')} disabled={!!problem}>
          <strong>
            <Icon name="file" size={16} /> Nur diese Datei teilen
          </strong>
          <span className="muted small">{problem ?? `Legt an derselben Stelle den Ordner „${file.name}“ an, verschiebt die Datei hinein und teilt nur ihn.`}</span>
        </button>
      </div>
    </Sheet>
  );
}
