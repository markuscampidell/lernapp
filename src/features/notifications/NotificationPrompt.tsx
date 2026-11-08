import { useEffect, useState } from 'react';
import { useAuth } from '../../cloud/auth';
import { enablePush, pushState } from '../../cloud/push';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';

// Pro Gerät einmal fragen, ob man Benachrichtigungen möchte (danach nur noch über die Einstellungen).
const ASKED_KEY = 'lernapp-push-asked';

const asked = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return true;
  }
};
const markAsked = () => {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* privater Modus o. ä. */
  }
};

/** Beim ersten Öffnen (angemeldet, Benachrichtigungen möglich, aber aus): einmal fragen. */
export function NotificationPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || asked()) return;
    let alive = true;
    // Nur fragen, wenn Einschalten hier überhaupt geht (nicht blockiert, nicht iPhone-Browser ohne Installation usw.).
    pushState().then((s) => {
      if (!alive) return;
      if (s === 'off') setOpen(true);
      else if (s === 'on' || s === 'denied') markAsked();
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!open || !user) return null;

  const close = () => {
    markAsked();
    setOpen(false);
  };

  const yes = async () => {
    setBusy(true);
    setErr(null);
    try {
      await enablePush();
      close();
    } catch (e) {
      markAsked();
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Benachrichtigungen"
      onClose={close}
      footer={
        <div className="input-row wrap">
          <button className="btn ghost" onClick={close} disabled={busy}>
            {err ? 'Schließen' : 'Nein, danke'}
          </button>
          {!err && (
            <button className="btn primary" onClick={yes} disabled={busy}>
              <Icon name="check" size={18} /> Ja, einschalten
            </button>
          )}
        </div>
      }
    >
      <p>Möchtest du auf diesem Gerät benachrichtigt werden, wenn</p>
      <ul>
        <li>jemand deine Dateien kommentiert oder dir antwortet,</li>
        <li>jemand einen Ordner mit dir teilt,</li>
        <li>dir jemand Ordner übergibt?</li>
      </ul>
      <p className="muted small">Auch wenn die App geschlossen ist. Du kannst das jederzeit unter Einstellungen → Benachrichtigungen ändern.</p>
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}
