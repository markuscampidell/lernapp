import { useState } from 'react';
import { useAuth } from '../../cloud/auth';
import { MIN_PASSWORD } from '../../cloud/supabase';
import { Icon } from '../../components/Icon';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { useLibrary } from '../../state/Library';
import { formatSize } from '../../lib/files';

/** Anmelden/Registrieren – oder, wenn angemeldet, Konto-Infos (Abmelden, Passwort ändern). */
export function AccountCard({ showAccount = true }: { showAccount?: boolean }) {
  const auth = useAuth();
  if (!auth.enabled) {
    return (
      <div className="notice warning">
        Teilen ist noch nicht eingerichtet: In <code>src/cloud/supabase.ts</code> fehlen Server-Adresse und Schlüssel.
      </div>
    );
  }
  if (!auth.ready) return <p className="muted">Lädt …</p>;
  if (auth.user) return showAccount ? <AccountInfo /> : null;
  return <LoginForm />;
}

function LoginForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === 'register' && password !== repeat) return setErr('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      if (mode === 'login') await signIn(username, password);
      else await signUp(username, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card account-form" onSubmit={submit}>
      <div className="segmented" role="tablist">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Anmelden
        </button>
        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Registrieren
        </button>
      </div>
      <label className="field">
        <span className="field-label">Benutzername</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
          required
        />
        {mode === 'register' && <span className="muted small">3–20 Zeichen: Buchstaben, Ziffern, „-“ und „_“. Alle angemeldeten Personen sehen deinen Benutzernamen.</span>}
      </label>
      <label className="field">
        <span className="field-label">Passwort</span>
        <input
          type="password"
          name="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={mode === 'register' ? MIN_PASSWORD : undefined}
          required
        />
      </label>
      {mode === 'register' && (
        <label className="field">
          <span className="field-label">Passwort wiederholen</span>
          <input type="password" name="password-repeat" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          <span className="muted small">Merk es dir gut – ohne E-Mail-Adresse lässt es sich nicht zurücksetzen.</span>
        </label>
      )}
      {err && <p className="notice critical">{err}</p>}
      <button className="btn primary" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Bitte warten …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
      </button>
    </form>
  );
}

function AccountInfo() {
  const { user, signOut, changePassword } = useAuth();
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await changePassword(password);
      setStatus({ kind: 'good', text: 'Passwort geändert.' });
      setPassword('');
      setChanging(false);
    } catch (e) {
      setStatus({ kind: 'critical', text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="person">
        <span className="avatar">{user!.username.slice(0, 1)}</span>
        <div className="card-main">
          <span className="muted small">Angemeldet als</span>
          <strong className="ellipsis">{user!.username}</strong>
        </div>
      </div>
      {changing ? (
        <form className="account-form" onSubmit={save}>
          <input type="text" name="username" autoComplete="username" value={user!.username} readOnly hidden />
          <label className="field">
            <span className="field-label">Neues Passwort</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={MIN_PASSWORD} required />
          </label>
          <div className="input-row">
            <button type="button" className="btn ghost" onClick={() => setChanging(false)}>
              Abbrechen
            </button>
            <button type="submit" className="btn primary grow" disabled={busy || password.length < MIN_PASSWORD}>
              Speichern
            </button>
          </div>
        </form>
      ) : (
        <div className="input-row wrap">
          <button className="btn ghost" onClick={() => (setChanging(true), setStatus(null))}>
            Passwort ändern
          </button>
          <button
            className="btn ghost danger"
            onClick={() => confirm('Abmelden? Geteilte Ordner sind dann auf diesem Gerät nicht mehr sichtbar.') && signOut()}
          >
            <Icon name="logout" size={18} /> Abmelden
          </button>
          <button className="btn ghost danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={18} /> Konto löschen
          </button>
        </div>
      )}
      <SyncSetting />
      {deleting && <DeleteAccountSheet onClose={() => setDeleting(false)} />}
      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
    </div>
  );
}

/** „Meine Ordner“ auf allen Geräten: eigene Ordner automatisch hochladen (mit niemandem geteilt). */
function SyncSetting() {
  const { user, setSync } = useAuth();
  const { sync, retrySync, folders, files, online } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async (on: boolean) => {
    if (on) {
      const localFiles = files.filter((f) => !f.shareId);
      const localFolders = folders.filter((f) => !f.shareId);
      const size = localFiles.reduce((n, f) => n + (f.size || 0), 0);
      const ok = confirm(
        `„Meine Ordner“ auf all deinen Geräten haben?\n\n` +
          `Deine Ordner auf diesem Gerät (${localFolders.length} Ordner, ${localFiles.length} Dateien, ${formatSize(size)}) werden auf den Server hochgeladen ` +
          `und erscheinen auf jedem Gerät, auf dem du angemeldet bist. Sie bleiben privat, solange du sie nicht mit jemandem teilst.\n\n` +
          `Grenzen des kostenlosen Servers: höchstens 50 MB pro Datei und etwa 1 GB insgesamt (für alle Konten zusammen). ` +
          `Neue Dateien kannst du dann nur mit Internetverbindung hinzufügen.`,
      );
      if (!ok) return;
    } else if (!confirm('Ausschalten? Neue Ordner bleiben dann nur auf dem Gerät, auf dem du sie erstellst. Bereits hochgeladene Ordner bleiben auf allen Geräten.')) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await setSync(on);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack sync-setting">
      <label className="toggle-row">
        <span>
          „Meine Ordner“ auf allen Geräten
          <span className="muted small block">
            Eigene Ordner werden automatisch hochgeladen und erscheinen überall, wo du als {user?.username} angemeldet bist. Nur du siehst sie.
          </span>
        </span>
        <input type="checkbox" className="switch" checked={sync.on} disabled={busy || !online} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {sync.on && sync.busy && <p className="notice info">{sync.busy}</p>}
      {sync.on && !sync.busy && sync.pending > sync.errors.length && (
        <p className="muted small">{online ? 'Wird gleich hochgeladen …' : 'Offline – wird hochgeladen, sobald du wieder online bist.'}</p>
      )}
      {sync.on && sync.errors.length > 0 && (
        <div className="notice warning stack">
          {sync.errors.map((e) => (
            <span key={e.id}>
              „{e.name}“ konnte nicht hochgeladen werden: {e.message}
            </span>
          ))}
          <button className="link" onClick={retrySync}>
            Erneut versuchen
          </button>
        </div>
      )}
      {err && <p className="notice critical">{err}</p>}
    </div>
  );
}
