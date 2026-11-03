import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cleanWheel, discSvg, frameSvg, pick, SIZE, type Wheel, type WheelEntry } from './wheel';

const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drehbares Glücksrad. Jede Person dreht für sich, nichts wird gespeichert.
 * Bei „Gezogene entfernen“ fehlen gezogene Einträge bis „Zurücksetzen“.
 */
export function WheelSpinner({ wheel, actions }: { wheel: Wheel; actions?: ReactNode }) {
  const all = useMemo(() => cleanWheel(wheel).entries, [wheel]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const active = useMemo(() => all.filter((e) => !removed.has(e.id)), [all, removed]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelEntry | null>(null);
  const pending = useRef<WheelEntry | null>(null);
  const disc = useMemo(() => discSvg(active), [active]);
  const duration = reduceMotion ? 0.6 : 4.2;

  const spin = () => {
    if (spinning || active.length < 1) return;
    // Gezogenes erst beim nächsten Drehen herausnehmen (sonst springt das Rad unter dem Zeiger).
    let entries = active;
    if (wheel.removePicked && result) {
      const next = new Set(removed);
      next.add(result.id);
      entries = all.filter((e) => !next.has(e.id));
      setRemoved(next);
      if (!entries.length) return;
    }
    const p = pick(entries);
    if (!p) return;
    pending.current = p.entry;
    setResult(null);
    setSpinning(true);
    // Zeiger zeigt nach oben: dort soll der Zielwinkel des Rades landen.
    setRotation((r) => {
      const now = ((r % 360) + 360) % 360;
      const target = (((360 - p.angle - now) % 360) + 360) % 360;
      return r + (reduceMotion ? 360 : 360 * 5) + target;
    });
  };

  const done = () => {
    setSpinning(false);
    setResult(pending.current);
  };

  /** Gezogenen Eintrag für die nächsten Drehungen herausnehmen (nur hier, die Datei bleibt unverändert). */
  const takeOut = () => {
    if (!result) return;
    setRemoved((r) => new Set(r).add(result.id));
    setResult(null);
  };

  const reset = () => {
    setRemoved(new Set());
    setResult(null);
  };

  const left = wheel.removePicked && result ? active.length - 1 : active.length;
  const allGone = all.length > 0 && left <= 0 && !spinning;
  const anyOut = removed.size > 0 || (wheel.removePicked && !!result);

  return (
    <div className="wheel-spinner">
      {wheel.title.trim() && <strong className="wheel-title">{wheel.title}</strong>}
      <button type="button" className="wheel-stage" onClick={spin} disabled={spinning || active.length < 1} aria-label="Glücksrad drehen">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-hidden="true">
          <g
            style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '50% 50%', transition: spinning ? `transform ${duration}s cubic-bezier(0.12, 0.6, 0.12, 1)` : 'none' }}
            onTransitionEnd={done}
            dangerouslySetInnerHTML={{ __html: disc }}
          />
          <g dangerouslySetInnerHTML={{ __html: frameSvg() }} />
        </svg>
      </button>
      <div className="wheel-result" aria-live="polite">
        {spinning ? <span className="muted">Dreht …</span> : result ? <strong>{result.label}</strong> : <span className="muted">{all.length ? 'Tippe aufs Rad oder auf „Drehen“' : 'Noch keine Einträge'}</span>}
      </div>
      <div className="wheel-actions">
        {actions}
        {!wheel.removePicked && result && !spinning && (
          <button type="button" className="btn ghost small" onClick={takeOut} title="Nur für die nächsten Drehungen – die Einträge bleiben gespeichert">
            <Icon name="close" size={16} /> Rausnehmen
          </button>
        )}
        {anyOut && (
          <button type="button" className="btn ghost small" onClick={reset} disabled={spinning}>
            Zurücksetzen
          </button>
        )}
        <button type="button" className="btn primary" onClick={spin} disabled={spinning || active.length < 1 || allGone}>
          <Icon name="wheel" size={18} /> Drehen
        </button>
      </div>
      {(wheel.removePicked || removed.size > 0) && all.length > 0 && (
        <p className="muted small wheel-left">{allGone ? 'Keine Einträge mehr im Rad – „Zurücksetzen“ holt alle zurück.' : `Noch ${left} von ${all.length} im Rad.`}</p>
      )}
    </div>
  );
}
