import { useEffect, useMemo, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { downloadBlob } from '../../lib/files';
import { ChartEditor } from './ChartEditor';
import { chartSvg, copyChart, formatNumber, parseChart, prepareCopy, type Prepared } from './chart';

/** Ansicht einer Diagramm-Datei: Diagramm, Kopieren (zum Einfügen in Text-Dokumente), Bearbeiten. */
export function ChartPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const chart = useMemo(() => parseChart(text), [text]);
  const svg = useMemo(() => chartSvg(chart), [chart]);
  const [editing, setEditing] = useState(false);
  const copy = useChartCopy(chart);
  const editable = canModify(file) && (!file.shareId || online);

  return (
    <div className="doc-panel chart-panel">
      <div className="doc-panel-actions">
        <button className="btn ghost" onClick={() => copy.prepared && downloadBlob(copy.prepared.png!, `${file.name}.png`)} disabled={!copy.prepared?.png}>
          <Icon name="download" size={18} /> Bild
        </button>
        <button className="btn ghost" onClick={copy.run} disabled={!copy.prepared}>
          <Icon name={copy.done ? 'check' : 'copy'} size={18} /> {copy.done ? 'Kopiert' : 'Kopieren'}
        </button>
        {editable && (
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        )}
      </div>
      {copy.done && <p className="notice info">Kopiert – in einem Text-Dokument einfügen (Strg+V bzw. lange tippen → Einfügen) oder dort über „Diagramm“ in der Leiste.</p>}
      <div className="card chart-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      {chart.points.length > 0 && (
        <div className="card chart-table-wrap">
        <table className="chart-table">
          <tbody>
            {chart.points.map((p) => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td className="num">
                  {formatNumber(p.value)}
                  {chart.unit && ` ${chart.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {editing && <ChartEditor file={file} initial={chart} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Kopieren vorbereiten (Bild erzeugen), damit der Klick sofort in die Zwischenablage schreiben kann. */
export function useChartCopy(chart: Parameters<typeof prepareCopy>[0] | null) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setPrepared(null);
    setDone(false);
    if (chart) prepareCopy(chart).then((p) => alive && setPrepared(p));
    return () => {
      alive = false;
    };
  }, [chart]);
  const run = async () => {
    if (!prepared) return;
    await copyChart(prepared);
    // Auch wenn nur die App-interne Kopie klappt, kann man in der App einfügen.
    setDone(true);
  };
  return { prepared, done, run };
}
