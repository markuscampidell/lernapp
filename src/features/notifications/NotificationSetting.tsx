import { useEffect, useState } from 'react';
import { useAuth } from '../../cloud/auth';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../../cloud/push';
import { useLibrary } from '../../state/Library';

/** Benachrichtigungen auf diesem Gerät ein-/ausschalten (gehört zum angemeldeten Konto). */
export function NotificationSetting() {
  const { user } = useAuth();
  const { online } = useLibrary();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [user?.id]);

  if (!user || !state) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      if (on) await enablePush();
      else await disablePush();
    } catch (e) {
      setMsg({ kind: 'critical', text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' });
    } finally {
      setState(await pushState());
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sendTestPush();
      setMsg({ kind: 'good', text: 'Gesendet – die Benachrichtigung sollte in ein paar Sekunden erscheinen.' });
    } catch (e) {
      setMsg({ kind: 'critical', text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' });
    } finally {
      setBusy(false);
    }
  };

  const hint: Partial<Record<PushState, string>> = {
    unsupported: 'Dieser Browser unterstützt keine Benachrichtigungen.',
    'ios-install': 'Auf iPhone und iPad gehen Benachrichtigungen nur in der installierten App: Teilen-Symbol → „Zum Home-Bildschirm“, dann die App von dort öffnen.',
    dev: 'Im Entwicklungsmodus nicht verfügbar – nur in der veröffentlichten App.',
    denied: 'Benachrichtigungen sind für die Lernapp blockiert. Erlaube sie in den Website- bzw. App-Einstellungen deines Geräts und lade die Seite neu.',
  };
  const available = state === 'on' || state === 'off';

  return (
    <>
      <h3 className="section-title">Benachrichtigungen</h3>
      <div className="card stack">
        <label className="toggle-row">
          <span>
            Benachrichtigungen auf diesem Gerät
            <span className="muted small block">
              Wenn jemand deine Dateien kommentiert oder dir antwortet, einen Ordner mit dir teilt oder dir Ordner übergibt – auch wenn
              die App geschlossen ist. Für {user.username}.
            </span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={state === 'on'}
            disabled={busy || !available || !online}
            onChange={(e) => toggle(e.target.checked)}
          />
        </label>
        {hint[state] && <p className="notice warning">{hint[state]}</p>}
        {state === 'on' && (
          <button className="link" onClick={test} disabled={busy || !online}>
            Test-Benachrichtigung senden
          </button>
        )}
        {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
      </div>
    </>
  );
}
