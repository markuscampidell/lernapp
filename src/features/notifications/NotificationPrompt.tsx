import { useEffect, useState } from 'react';
import { useAuth } from '../../cloud/auth';
import { enablePush, pushState } from '../../cloud/push';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';

// Pro Gerät einmal fragen, ob man Benachrichtigungen möchte (danach nur noch über die Einstellungen).
// v2: mit „Neues in geteilten Ordnern“ fragen wir alle, die noch nicht eingeschaltet haben, noch einmal.
const ASKED_KEY = 'lernapp-push-asked-v2';

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
  const [open, setOpen] = useState<false | 'ask' | 'install'>(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || asked()) return;
    let alive = true;
    // Nur fragen, wenn Einschalten hier überhaupt geht (nicht blockiert, nicht iPhone-Browser ohne Installation usw.).
    pushState().then((s) => {
      if (!alive) return;
      if (s === 'off') setOpen('ask');
      // iPhone/iPad im Browser: Einschalten geht erst in der installierten App – einmal erklären, wie.
      else if (s === 'ios-install') setOpen('install');
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

  if (open === 'install')
    return (
      <Sheet
        title="Benachrichtigungen"
        onClose={close}
        footer={
          <button className="btn primary grow" onClick={close}>
            Verstanden
          </button>
        }
      >
        <p>Damit du mitbekommst, wenn in euren Ordnern etwas Neues ist, kann dir die Lernapp Benachrichtigungen schicken.</p>
        <p>
          Auf iPhone und iPad geht das nur in der installierten App: unten auf <strong>Teilen</strong> tippen →{' '}
          <strong>„Zum Home-Bildschirm“</strong>, dann die Lernapp von dort öffnen. Dort wirst du noch einmal gefragt.
        </p>
      </Sheet>
    );

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
        <li>jemand etwas Neues in einen eurer Ordner legt (z. B. eine Zusammenfassung oder Infos),</li>
        <li>jemand deine Dateien ändert, kommentiert oder dir antwortet,</li>
        <li>jemand einen Ordner mit dir teilt?</li>
      </ul>
      <p className="muted small">Auch wenn die App geschlossen ist. Worüber genau, kannst du jederzeit unter Einstellungen → Benachrichtigungen auswählen.</p>
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}
