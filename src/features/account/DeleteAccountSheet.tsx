import { useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { SearchBox } from '../../components/SearchBox';
import { Icon } from '../../components/Icon';
import { useLibrary } from '../../state/Library';

const NOBODY = 'niemand';

/** Konto löschen: eigene geteilte Ordner an eine Person übergeben (oder löschen), dann bestätigen. */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const { me, ownedRoots, shares, members, profiles, online, handoversReady, deleteAccount } = useLibrary();
  const [choice, setChoice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasShares = ownedRoots.length > 0;

  // Personen in meinen geteilten Ordnern zuerst, dann alle anderen.
  const memberIds = useMemo(() => {
    const mine = new Set(shares.filter((s) => s.ownerId === me?.id).map((s) => s.id));
    return new Set(members.filter((m) => mine.has(m.shareId)).map((m) => m.userId));
  }, [shares, members, me]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter((p) => p.id !== me?.id && (!q || p.username.toLowerCase().includes(q)))
      .filter((p) => q || memberIds.has(p.id))
      .sort((a, b) => Number(memberIds.has(b.id)) - Number(memberIds.has(a.id)) || a.username.localeCompare(b.username, 'de', { sensitivity: 'base' }));
  }, [profiles, me, query, memberIds]);

  const recipientName = choice && choice !== NOBODY ? profiles.find((p) => p.id === choice)?.username : undefined;
  const nameOk = !!me && confirmName.trim().toLowerCase() === me.username.toLowerCase();
  const ready = nameOk && (!hasShares || choice !== null) && online && handoversReady && !busy;

  const submit = async () => {
    setErr(null);
    setBusy('Bitte warten …');
    try {
      await deleteAccount(hasShares && choice !== NOBODY ? choice : null, setBusy);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(null);
    }
  };

  return (
    <Sheet
      title="Konto löschen"
      onClose={() => !busy && onClose()}
      footer={
        <div className="input-row">
          <button className="btn ghost" onClick={onClose} disabled={!!busy}>
            Abbrechen
          </button>
          <button className="btn danger-fill grow" onClick={submit} disabled={!ready}>
            {busy ?? 'Konto endgültig löschen'}
          </button>
        </div>
      }
    >
      <div className="stack">
        {!handoversReady && (
          <p className="notice warning">Der Server ist noch nicht bereit: Bitte supabase/004_konto_loeschen.sql im Supabase „SQL Editor“ ausführen.</p>
        )}
        {!online && <p className="notice warning">Keine Verbindung zum Server – das Konto kann nur online gelöscht werden.</p>}

        <p className="muted small">
          Dein Konto <strong>{me?.username}</strong> wird gelöscht und du wirst abgemeldet. „Meine Ordner“ auf diesem Gerät bleiben erhalten. Was du in
          geteilten Ordnern anderer hinzugefügt hast, bleibt dort (ohne deinen Namen).
        </p>

        {hasShares && (
          <>
            <div className="stack">
              <span className="field-label">
                Wer bekommt deine geteilten Ordner? ({ownedRoots.length}: {ownedRoots.map((f) => f.name).join(', ')})
              </span>
              <button
                type="button"
                className={`person${choice === NOBODY ? ' selected' : ''}`}
                onClick={() => setChoice(NOBODY)}
                aria-pressed={choice === NOBODY}
              >
                <span className="avatar">{choice === NOBODY ? <Icon name="check" size={18} /> : <Icon name="trash" size={18} />}</span>
                <span className="grow">
                  <strong>Niemand</strong>
                  <span className="muted small"> – für alle endgültig löschen</span>
                </span>
              </button>
              <SearchBox value={query} onChange={setQuery} placeholder="Andere Person suchen" />
              {list.length === 0 ? (
                <p className="muted small">{query ? 'Niemand gefunden.' : 'In deinen geteilten Ordnern ist sonst niemand – suche nach einem Benutzernamen.'}</p>
              ) : (
                <div className="people people-scroll">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`person${choice === p.id ? ' selected' : ''}`}
                      onClick={() => setChoice(p.id)}
                      aria-pressed={choice === p.id}
                    >
                      <span className="avatar">{choice === p.id ? <Icon name="check" size={18} /> : p.username.slice(0, 1)}</span>
                      <strong className="grow ellipsis">{p.username}</strong>
                      {memberIds.has(p.id) && <span className="muted small">Mitglied</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {choice === NOBODY && (
              <p className="notice critical">Alle deine geteilten Ordner werden samt Inhalt für alle Mitglieder gelöscht.</p>
            )}
            {recipientName && (
              <p className="notice info">
                {recipientName} wird gefragt, ob sie/er die Ordner übernimmt – weiter geteilt oder in die eigenen Ordner. Bis dahin sehen die Mitglieder sie
                weiter. Lehnt {recipientName} ab oder entscheidet nicht innerhalb von 30 Tagen, wird alles gelöscht.
              </p>
            )}
          </>
        )}

        <label className="field">
          <span className="field-label">Zum Bestätigen deinen Benutzernamen eingeben</span>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={me?.username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </Sheet>
  );
}
