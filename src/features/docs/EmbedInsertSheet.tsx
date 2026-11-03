import { useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { useLibrary } from '../../state/Library';
import { pathOf } from '../../domain/tree';
import { fileKind } from '../../lib/files';
import { loadBlob } from '../../storage/blobs';
import { EMBED_LABEL, lastCopied, parseEmbed, type EmbedData, type EmbedKind } from './embeds';

/** Diagramm/Glücksrad in ein Text-Dokument einfügen: zuletzt kopiertes, neues oder eines aus den eigenen Dateien. */
export function EmbedInsertSheet({ kind, onClose, onNew, onPick }: { kind: EmbedKind; onClose: () => void; onNew: () => void; onPick: (e: EmbedData) => void }) {
  const { files, folders } = useLibrary();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const copied = useMemo(() => lastCopied(kind), [kind]);
  const label = EMBED_LABEL[kind];
  const icon = kind === 'chart' ? ('chart' as const) : ('wheel' as const);
  const charts = useMemo(
    () => files.filter((f) => fileKind(f) === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [files, kind],
  );

  const pickFile = async (id: string, blobId: string) => {
    setBusy(id);
    setErr(null);
    try {
      const blob = await loadBlob(blobId);
      if (!blob) throw new Error(`${label} konnte nicht geladen werden – bist du online?`);
      onPick(parseEmbed(kind, await blob.text()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title={`${label} einfügen`} onClose={onClose}>
      <div className="add-menu">
        {copied && (
          <button className="card card-btn row-card add-option" onClick={() => onPick(copied.embed)}>
            <span className={`thumb add-icon add-${kind}`}>
              <Icon name="paste" size={22} />
            </span>
            <div className="card-main">
              <strong>Kopiertes {label} einfügen</strong>
              <span className="muted small ellipsis">{copied.text}</span>
            </div>
            <Icon name="chevron" />
          </button>
        )}
        <button className="card card-btn row-card add-option" onClick={onNew}>
          <span className={`thumb add-icon add-${kind}`}>
            <Icon name="plus" size={22} />
          </span>
          <div className="card-main">
            <strong>{kind === 'chart' ? 'Neues Diagramm' : 'Neues Glücksrad'}</strong>
            <span className="muted small">Direkt hier im Dokument erstellen</span>
          </div>
          <Icon name="chevron" />
        </button>
        {charts.length > 0 && <p className="muted small chart-pick-label">{kind === 'chart' ? 'Aus deinen Diagrammen' : 'Aus deinen Glücksrädern'} (wird als Kopie eingefügt)</p>}
        {charts.map((f) => (
          <button key={f.id} className="card card-btn row-card add-option" onClick={() => pickFile(f.id, f.blobId)} disabled={!!busy}>
            <span className={`thumb file-thumb kind-${kind}`}>
              <Icon name={icon} size={22} />
            </span>
            <div className="card-main">
              <strong className="wrap-text">{f.name}</strong>
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
