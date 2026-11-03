import { useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { useLibrary } from '../../state/Library';
import { pathOf } from '../../domain/tree';
import { fileKind } from '../../lib/files';
import { loadBlob } from '../../storage/blobs';
import { lastCopiedChart, parseChart, type Chart } from '../charts/chart';

/** Diagramm in ein Text-Dokument einfügen: zuletzt kopiertes, neues oder eines aus den eigenen Diagramm-Dateien. */
export function ChartInsertSheet({ onClose, onNew, onPick }: { onClose: () => void; onNew: () => void; onPick: (c: Chart) => void }) {
  const { files, folders } = useLibrary();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const copied = useMemo(() => lastCopiedChart(), []);
  const charts = useMemo(
    () => files.filter((f) => fileKind(f) === 'chart').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [files],
  );

  const pickFile = async (id: string, blobId: string) => {
    setBusy(id);
    setErr(null);
    try {
      const blob = await loadBlob(blobId);
      if (!blob) throw new Error('Das Diagramm konnte nicht geladen werden – bist du online?');
      onPick(parseChart(await blob.text()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Diagramm einfügen" onClose={onClose}>
      <div className="add-menu">
        {copied && (
          <button className="card card-btn row-card add-option" onClick={() => onPick(copied.chart)}>
            <span className="thumb add-icon add-chart">
              <Icon name="paste" size={22} />
            </span>
            <div className="card-main">
              <strong>Kopiertes Diagramm einfügen</strong>
              <span className="muted small ellipsis">{copied.text}</span>
            </div>
            <Icon name="chevron" />
          </button>
        )}
        <button className="card card-btn row-card add-option" onClick={onNew}>
          <span className="thumb add-icon add-chart">
            <Icon name="plus" size={22} />
          </span>
          <div className="card-main">
            <strong>Neues Diagramm</strong>
            <span className="muted small">Direkt hier im Dokument erstellen</span>
          </div>
          <Icon name="chevron" />
        </button>
        {charts.length > 0 && <p className="muted small chart-pick-label">Aus deinen Diagrammen (wird als Kopie eingefügt)</p>}
        {charts.map((f) => (
          <button key={f.id} className="card card-btn row-card add-option" onClick={() => pickFile(f.id, f.blobId)} disabled={!!busy}>
            <span className="thumb file-thumb kind-chart">
              <Icon name="chart" size={22} />
            </span>
            <div className="card-main">
              <strong className="ellipsis">{f.name}</strong>
              <span className="muted small ellipsis">{busy === f.id ? 'Lädt …' : pathOf(folders, f.folderId).map((p) => p.name).join(' / ')}</span>
            </div>
            <Icon name="chevron" />
          </button>
        ))}
        {err && <p className="notice critical">{err}</p>}
      </div>
    </Sheet>
  );
}
