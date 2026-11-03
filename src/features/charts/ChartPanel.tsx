import { useMemo, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { downloadBlob } from '../../lib/files';
import { ChartEditor } from './ChartEditor';
import { chartSvg, formatNumber, parseChart } from './chart';
import { useEmbedCopy } from '../docs/embeds';

/** Ansicht einer Diagramm-Datei: Diagramm, Kopieren (zum Einfügen in Text-Dokumente), Bearbeiten. */
export function ChartPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const chart = useMemo(() => parseChart(text), [text]);
  const svg = useMemo(() => chartSvg(chart), [chart]);
  const [editing, setEditing] = useState(false);
  const embed = useMemo(() => ({ kind: 'chart' as const, data: chart }), [chart]);
  const copy = useEmbedCopy(embed);
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
