import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/Icon';
import type { PenSettings, PenTool } from './PagedDoc';

const KEY = 'lernapp:stift';
export const PEN_COLORS = ['#1c1c1b', '#2a5bd7', '#d63b3a', '#1f8a4c', '#e08a00', '#7b4fd1'];
export const HL_COLORS = ['#ffe14d', '#8de08a', '#ff8fc8', '#8fd3ff', '#ffb35c'];
const PEN_SIZES = [1.6, 3, 5.5];
const HL_SIZES = [12, 18, 28];

const DEFAULTS: PenSettings = { tool: 'pen', color: PEN_COLORS[0], size: 3, hlColor: HL_COLORS[0], hlSize: 18, eraseWhole: false };

/** Stift-Einstellungen (bleiben auf dem Gerät gespeichert). */
export function usePenSettings() {
  const [settings, set] = useState<PenSettings>(() => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PenSettings>) };
    } catch {
      return DEFAULTS;
    }
  });
  const update = (patch: Partial<PenSettings>) =>
    set((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* egal */
      }
      return next;
    });
  return [settings, update] as const;
}

interface Props {
  settings: PenSettings;
  onChange: (patch: Partial<PenSettings>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Zusätzliche Schalter (z. B. "Mit Finger zeichnen"). */
  extra?: ReactNode;
}

const TOOLS: [PenTool, IconName, string][] = [
  ['pen', 'pen', 'Stift'],
  ['hl', 'highlighter', 'Textmarker'],
  ['eraser', 'eraser', 'Radierer'],
  ['lasso', 'lasso', 'Lasso (auswählen, verschieben, Größe ändern)'],
];

/** Werkzeugleiste zum Schreiben mit dem Stift. */
export function PenBar({ settings, onChange, onUndo, onRedo, canUndo, canRedo, extra }: Props) {
  const t = settings.tool;
  const hl = t === 'hl';
  const colors = hl ? HL_COLORS : PEN_COLORS;
  const color = hl ? settings.hlColor : settings.color;
  const sizes = hl ? HL_SIZES : PEN_SIZES;
  const size = hl ? settings.hlSize : settings.size;
  const custom = !colors.includes(color);
  return (
    <div className="doc-toolbar pen-bar" role="toolbar" aria-label="Stift" data-no-swipe onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <button type="button" className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Rückgängig" title="Rückgängig">
        <Icon name="undo" size={19} />
      </button>
      <button type="button" className="icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="Wiederholen" title="Wiederholen">
        <Icon name="redo" size={19} />
      </button>
      <span className="toolbar-sep" aria-hidden="true" />
      {TOOLS.map(([id, icon, label]) => (
        <button key={id} type="button" className={`icon-btn${t === id ? ' on' : ''}`} aria-pressed={t === id} onClick={() => onChange({ tool: id })} aria-label={label} title={label}>
          <Icon name={icon} size={19} />
        </button>
      ))}
      <span className="toolbar-sep" aria-hidden="true" />
      {(t === 'pen' || t === 'hl' || t === 'lasso') && (
        <>
          {(t === 'lasso' ? PEN_COLORS : colors).map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${(t === 'lasso' ? settings.color : color) === c ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(hl ? { hlColor: c } : { color: c })}
              aria-label={`Farbe ${c}`}
              title={t === 'lasso' ? 'Farbe für „Farbe übernehmen“' : 'Farbe'}
            />
          ))}
          <label className={`swatch custom${custom && t !== 'lasso' ? ' on' : ''}`} title="Eigene Farbe" style={custom && t !== 'lasso' ? { background: color } : undefined}>
            <input type="color" value={t === 'lasso' ? settings.color : color} onChange={(e) => onChange(hl ? { hlColor: e.target.value } : { color: e.target.value })} aria-label="Eigene Farbe" />
          </label>
        </>
      )}
      {(t === 'pen' || t === 'hl') && (
        <>
          <span className="toolbar-sep" aria-hidden="true" />
          {sizes.map((z, i) => (
            <button key={z} type="button" className={`icon-btn size-btn${size === z ? ' on' : ''}`} onClick={() => onChange(hl ? { hlSize: z } : { size: z })} aria-label={`Stärke ${i + 1}`} title={`Stärke ${i + 1}`}>
              <span className="size-dot" style={{ width: 4 + i * 4, height: 4 + i * 4, background: color }} />
            </button>
          ))}
        </>
      )}
      {t === 'eraser' && (
        <div className="segmented small-seg">
          <button type="button" className={!settings.eraseWhole ? 'active' : ''} onClick={() => onChange({ eraseWhole: false })}>
            Teile
          </button>
          <button type="button" className={settings.eraseWhole ? 'active' : ''} onClick={() => onChange({ eraseWhole: true })}>
            Ganze Striche
          </button>
        </div>
      )}
      {extra}
    </div>
  );
}
