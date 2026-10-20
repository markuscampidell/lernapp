import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { checkGpu, deleteModel, isDownloaded, MODELS, unload, useEngineState, type GpuInfo } from '../../ai/local';
import { setModelKey, useModelKey, type ModelKey } from '../../ai/settings';

/** Einstellungen für die lokale KI: Modellgröße wählen, heruntergeladene Modelle löschen. */
export function AiSettings() {
  const current = useModelKey();
  const engine = useEngineState();
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    Promise.all(MODELS.map(async (m) => [m.key, await isDownloaded(m.key)] as const)).then((r) => setDownloaded(Object.fromEntries(r)));

  useEffect(() => {
    checkGpu().then(setGpu);
    refresh();
  }, [engine.status]);

  const choose = async (key: ModelKey) => {
    if (key === current) return;
    if (engine.status === 'ready' || engine.status === 'loading') await unload();
    setModelKey(key);
  };

  const remove = async (key: ModelKey) => {
    const m = MODELS.find((x) => x.key === key)!;
    if (!confirm(`KI-Modell „${m.label}“ von diesem Gerät löschen? Du kannst es später wieder herunterladen.`)) return;
    setBusy(true);
    try {
      await deleteModel(key);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <p className="muted small">
        Die KI läuft direkt auf deinem Gerät (Modelle: <strong>Qwen3</strong>, frei nutzbar). Kein Konto, kostenlos – deine
        Dateien verlassen das Gerät nicht. Größere Modelle antworten besser, brauchen aber mehr Speicher und sind langsamer.
      </p>
      {gpu && !gpu.ok && <p className="notice warning">{gpu.reason}</p>}
      <ul className="list">
        {MODELS.map((m) => (
          <li key={m.key} className={`card model-option${current === m.key ? ' on' : ''}`}>
            <button className="model-main" onClick={() => choose(m.key)} disabled={busy || engine.status === 'loading'}>
              <span className={`tick${current === m.key ? ' on' : ''}`} aria-hidden="true">
                {current === m.key && <Icon name="check" size={16} />}
              </span>
              <span className="card-main">
                <strong>
                  {m.label} <span className="muted small">· {m.size}</span>
                </strong>
                <span className="muted small">{m.hint}</span>
                {downloaded[m.key] && <span className="badge good-badge fit">heruntergeladen</span>}
              </span>
            </button>
            {downloaded[m.key] && (
              <button className="icon-btn item-delete" aria-label={`${m.label} löschen`} title="Modell löschen" disabled={busy} onClick={() => remove(m.key)}>
                <Icon name="trash" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        Hinweis: Auch die KI kann Fehler machen. Prüfe wichtige Antworten über die angegebene Quelle. Bilder und eingescannte
        Seiten kann sie noch nicht lesen.
      </p>
    </div>
  );
}
