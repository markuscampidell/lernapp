import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * Schaut regelmäßig nach, ob eine neuere Version der App online ist (dist/version.json),
 * und zeigt dann „Neue Version ist da – Aktualisieren“. Nur im fertigen Build, nicht beim Entwickeln.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id?: string };
        if (id && id !== __BUILD_ID__) setReady(true);
      } catch {
        /* offline – später nochmal */
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="sparkle" size={20} />
      <span className="grow">Neue Version ist da</span>
      <button className="btn primary small" onClick={() => location.reload()}>
        Aktualisieren
      </button>
    </div>
  );
}
