import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { listModels, pickDefaultModel, type ModelInfo } from '../../ai/gemini';
import { setApiKey, setModel, useAiSettings } from '../../ai/settings';

const MODELS_CACHE = 'lernapp/gemini-models';

const cachedModels = (): ModelInfo[] => {
  try {
    return JSON.parse(localStorage.getItem(MODELS_CACHE) ?? '[]');
  } catch {
    return [];
  }
};

/** Einstellungen für die KI: eigener Gemini-Schlüssel und Modell. */
export function AiSettings() {
  const { apiKey, model } = useAiSettings();
  const [draft, setDraft] = useState(apiKey);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>(cachedModels);
  const [status, setStatus] = useState<{ kind: 'good' | 'critical' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(apiKey), [apiKey]);

  const test = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Schlüssel wird geprüft …' });
    try {
      const list = await listModels(key);
      if (!list.length) throw new Error('Für diesen Schlüssel sind keine passenden Gemini-Modelle verfügbar.');
      setApiKey(key);
      setModels(list);
      try {
        localStorage.setItem(MODELS_CACHE, JSON.stringify(list));
      } catch {
        /* egal */
      }
      if (!model || !list.some((m) => m.id === model)) setModel(pickDefaultModel(list));
      setStatus({ kind: 'good', text: 'Schlüssel funktioniert und ist gespeichert.' });
    } catch (e) {
      setStatus({ kind: 'critical', text: e instanceof Error ? e.message : 'Prüfen fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!confirm('Gemini-Schlüssel von diesem Gerät entfernen?')) return;
    setApiKey('');
    setDraft('');
    setStatus(null);
  };

  return (
    <div className="card stack">
      <p className="muted small">
        Die KI nutzt <strong>Google Gemini</strong> mit deinem eigenen, kostenlosen Schlüssel. Er bleibt nur auf diesem Gerät
        gespeichert und wird nur direkt an Google geschickt.
      </p>
      <ol className="steps small">
        <li>
          Öffne{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com/apikey
          </a>{' '}
          und melde dich mit deinem Google-Konto an.
        </li>
        <li>Tippe auf „API-Schlüssel erstellen“ und kopiere ihn.</li>
        <li>Füge ihn hier ein und tippe auf „Prüfen & speichern“.</li>
      </ol>
      <div className="field">
        <div className="field-label">
          <span>Gemini-API-Schlüssel</span>
          {apiKey && <span className="badge good-badge">gespeichert</span>}
        </div>
        <div className="input-row">
          <TextLine
            className={show ? undefined : 'masked'}
            aria-label="Gemini-API-Schlüssel"
            spellCheck={false}
            autoCapitalize="off"
            placeholder="AIza…"
            value={draft}
            onChange={setDraft}
            enterKeyHint="done"
            onEnter={test}
          />
          <button className="icon-btn" aria-label={show ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'} onClick={() => setShow((s) => !s)}>
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
      </div>
      <div className="input-row wrap">
        <button className="btn primary" onClick={test} disabled={busy || !draft.trim()}>
          Prüfen & speichern
        </button>
        {apiKey && (
          <button className="btn ghost danger" onClick={remove} disabled={busy}>
            Entfernen
          </button>
        )}
      </div>
      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}

      {apiKey && models.length > 0 && (
        <div className="field">
          <div className="field-label">
            <span>Modell</span>
            <span className="muted small">„Flash“ ist schnell und im Gratis-Kontingent</span>
          </div>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="muted small">
        Gut zu wissen: Deine gewählten Dateien werden für Antworten an Google geschickt. Für Nutzer in der EU verwendet Google
        sie laut seinen Bedingungen nicht zum Verbessern seiner Produkte – sehr vertrauliche Unterlagen gehören trotzdem nicht
        hinein. Google erlaubt die API laut Bedingungen erst ab 18 Jahren. Das Gratis-Kontingent ist begrenzt (Anfragen pro
        Minute und pro Tag).
      </p>
    </div>
  );
}
