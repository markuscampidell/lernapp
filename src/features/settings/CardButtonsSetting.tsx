import { cloudEnabled } from '../../cloud/supabase';
import { setCardButton, useCardButtons, type CardButtons } from '../../lib/cardButtons';

/** Einstellungen → Auf diesem Gerät: welche Knöpfe an Ordnern und Dateien zu sehen sind. */
export function CardButtonsSetting() {
  const b = useCardButtons();
  const rows: [keyof CardButtons, string][] = [
    ...(cloudEnabled ? ([['people', 'Personen']] as [keyof CardButtons, string][]) : []),
    ['move', 'Verschieben'],
    ['info', 'Details'],
  ];
  return (
    <>
      <h3 className="section-title">Knöpfe an Ordnern und Dateien</h3>
      <div className="card stack">
        {rows.map(([key, label]) => (
          <div key={key} className="toggle-row">
            <span>{label}</span>
            <input type="checkbox" className="switch" aria-label={label} checked={b[key]} onChange={(e) => setCardButton(key, e.target.checked)} />
          </div>
        ))}
      </div>
    </>
  );
}
