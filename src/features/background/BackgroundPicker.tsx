import { useState } from 'react';
import { BACKGROUNDS, loadBackground, saveBackground } from '../../lib/background';
import { Icon } from '../../components/Icon';

/** Auswahl des Hintergrunds (Einstellungen → Auf diesem Gerät). */
export function BackgroundPicker() {
  const [current, setCurrent] = useState(loadBackground);
  return (
    <>
      <h3 className="section-title">Hintergrund</h3>
      <div className="bg-grid" role="radiogroup" aria-label="Hintergrund">
        {BACKGROUNDS.map((b) => (
          <button
            key={b.id}
            role="radio"
            aria-checked={current === b.id}
            className={`bg-option${current === b.id ? ' on' : ''}`}
            onClick={() => {
              setCurrent(b.id);
              saveBackground(b.id);
            }}
          >
            <span className={`bg-swatch bgp-${b.id}`}>
              {current === b.id && (
                <span className="bg-check">
                  <Icon name="check" size={16} />
                </span>
              )}
            </span>
            <span className="bg-name">{b.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
