import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { navigate } from '../../lib/router';
import { checkGpu, ensureEngine, isDownloaded, MODELS, useEngineState, type GpuInfo } from '../../ai/local';
import { useModelKey } from '../../ai/settings';

/**
 * Zeigt an, ob die lokale KI bereit ist: WebGPU vorhanden? Modell schon heruntergeladen?
 * Gibt `children` erst frei, wenn die KI benutzt werden kann (heruntergeladen oder geladen).
 */
export function ModelGate({ children }: { children: React.ReactNode }) {
  const key = useModelKey();
  const engine = useEngineState();
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const model = MODELS.find((m) => m.key === key)!;

  useEffect(() => {
    checkGpu().then(setGpu);
  }, []);
  useEffect(() => {
    setDownloaded(null);
    isDownloaded(key).then(setDownloaded);
  }, [key, engine.status]);

  if (!gpu || downloaded === null) return <p className="muted small">Lädt …</p>;

  if (!gpu.ok) {
    return (
      <div className="card ai-card">
        <span className="ai-icon warn">
          <Icon name="ai" size={28} />
        </span>
        <h2>KI auf diesem Gerät nicht verfügbar</h2>
        <p className="muted">{gpu.reason}</p>
      </div>
    );
  }

  const loadingBar =
    engine.status === 'loading' ? (
      <div className="model-progress" role="status">
        <div className="meter wide">
          <div className="meter-fill" style={{ width: `${Math.max(3, Math.round(engine.progress * 100))}%` }} />
        </div>
        <span className="muted small">{engine.text}</span>
      </div>
    ) : null;

  if (!downloaded && engine.status !== 'ready') {
    return (
      <div className="card ai-card">
        <span className="ai-icon">
          <Icon name="ai" size={28} />
        </span>
        <h2>KI einrichten</h2>
        <p className="muted">
          Die KI läuft direkt auf deinem Gerät – ohne Konto, kostenlos, und deine Dateien verlassen das Gerät nicht. Dafür wird
          einmalig ein KI-Modell heruntergeladen.
        </p>
        <div className="model-pick">
          <strong>
            Modell „{model.label}“ · {model.size}
          </strong>
          <span className="muted small">{model.hint}</span>
          <button className="link" onClick={() => navigate('#einstellungen')}>
            Anderes Modell wählen
          </button>
        </div>
        <p className="muted small">Am besten im WLAN herunterladen. Danach funktioniert die KI auch offline.</p>
        {engine.status === 'error' && <p className="notice critical">{engine.error}</p>}
        {loadingBar ?? (
          <button className="btn primary" onClick={() => ensureEngine().catch(() => {})}>
            <Icon name="download" size={18} /> Herunterladen ({model.size})
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {loadingBar && <div className="card">{loadingBar}</div>}
      {engine.status === 'error' && <p className="notice critical">{engine.error}</p>}
      {children}
    </>
  );
}
