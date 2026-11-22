import { setReducedMotion, useReducedMotion } from '../../lib/motion';

/** Einstellungen → Auf diesem Gerät: Animationen (Ein-/Ausblenden, Gleiten, Umdrehen …) abschalten. */
export function MotionSetting() {
  const on = useReducedMotion();
  return (
    <>
      <h3 className="section-title">Bewegung</h3>
      <div className="card stack">
        <div className="toggle-row">
          <span>
            Weniger Bewegung
            <span className="muted small block">Ohne Animationen – alles wechselt sofort. Anfangs wie am Gerät eingestellt.</span>
          </span>
          <input type="checkbox" className="switch" aria-label="Weniger Bewegung" checked={on} onChange={(e) => setReducedMotion(e.target.checked)} />
        </div>
      </div>
    </>
  );
}
