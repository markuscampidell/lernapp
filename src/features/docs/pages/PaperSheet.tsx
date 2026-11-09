import { useState } from 'react';
import { Sheet } from '../../../components/Sheet';
import { paperStyle } from './PagedDoc';
import type { InkPage, PaperKind } from './ink';

const KINDS: [PaperKind, string][] = [
  ['blank', 'Leer'],
  ['lined', 'Liniert'],
  ['grid', 'Kariert'],
];
const PAPERS = ['#ffffff', '#fbf7ec', '#fff6c7', '#e9f4ff', '#eaf7ea', '#fde9f1', '#f1f1f1', '#2b2b2b'];

/** Hintergrund einer Seite wählen: leer/liniert/kariert und beliebige Farbe. */
export function PaperSheet({ page, index, onApply, onClose }: { page: InkPage; index: number; onApply: (bg: PaperKind, paper: string, all: boolean) => void; onClose: () => void }) {
  const [bg, setBg] = useState<PaperKind>(page.bg);
  const [paper, setPaper] = useState(page.paper);
  return (
    <Sheet
      title={`Seite ${index + 1}: Hintergrund`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => onApply(bg, paper, true)}>
            Für alle Seiten
          </button>
          <button className="btn primary grow" onClick={() => onApply(bg, paper, false)}>
            Übernehmen
          </button>
        </>
      }
    >
      <div className="paper-kinds">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className={`paper-kind${bg === k ? ' on' : ''}`} onClick={() => setBg(k)} aria-pressed={bg === k}>
            <span className="paper-sample" style={paperStyle({ bg: k, paper })} />
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <span className="field-label">Farbe</span>
        <div className="paper-colors">
          {PAPERS.map((c) => (
            <button key={c} type="button" className={`swatch big${paper === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setPaper(c)} aria-label={`Farbe ${c}`} />
          ))}
          <label className={`swatch big custom${!PAPERS.includes(paper) ? ' on' : ''}`} title="Eigene Farbe" style={!PAPERS.includes(paper) ? { background: paper } : undefined}>
            <input type="color" value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Eigene Farbe" />
          </label>
        </div>
      </div>
    </Sheet>
  );
}
