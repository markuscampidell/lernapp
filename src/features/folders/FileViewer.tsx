import { useEffect, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf } from '../../domain/tree';
import { db } from '../../storage/db';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { downloadBlob, fileKind, formatDate, formatSize, fullName, KIND_LABEL } from '../../lib/files';
import { PdfView } from './PdfView';
import { useBackToClose } from '../../lib/router';
import { FileEditorSheet } from './FileEditorSheet';

const MAX_TEXT = 2 * 1024 * 1024;

/** Vollbild-Ansicht einer Datei mit Vorschau und Aktionen. */
export function FileViewer({ file: initial, onClose }: { file: FileItem; onClose: () => void }) {
  const { files, folders } = useLibrary();
  // Immer die aktuelle Version (nach Umbenennen/Verschieben).
  const file = files.find((f) => f.id === initial.id);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);

  const kind = fileKind(initial);
  useBackToClose(onClose);

  useEffect(() => {
    let u: string | undefined;
    db.getBlob(initial.blobId).then(async (b) => {
      if (!b) return setMissing(true);
      setBlob(b);
      u = URL.createObjectURL(b);
      setUrl(u);
      if (kind === 'text' && b.size <= MAX_TEXT) setText(await b.text());
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [initial.blobId, kind]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!file) onClose(); // gelöscht
  }, [file, onClose]);
  if (!file) return null;

  const name = fullName(file);
  const shareable = (() => {
    if (!blob || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [new File([blob], name, { type: file.mime })] });
    } catch {
      return false;
    }
  })();

  const share = async () => {
    if (!blob) return;
    try {
      await navigator.share({ files: [new File([blob], name, { type: file.mime })], title: file.name });
    } catch {
      /* abgebrochen */
    }
  };
  const open = () => url && window.open(url, '_blank', 'noopener');

  let body: React.ReactNode;
  if (missing) body = <p className="notice critical">Der Inhalt dieser Datei wurde nicht gefunden.</p>;
  else if (!blob || !url) body = <p className="muted">Lädt …</p>;
  else if (kind === 'image') body = <img className="viewer-media" src={url} alt={file.name} />;
  else if (kind === 'video') body = <video className="viewer-media" src={url} controls playsInline />;
  else if (kind === 'audio') body = <audio className="viewer-audio" src={url} controls />;
  else if (kind === 'pdf') body = <PdfView blob={blob} />;
  else if (kind === 'text' && text !== null) body = <pre className="viewer-text">{text}</pre>;
  else
    body = (
      <div className="empty viewer-fallback">
        <p className="empty-title">Keine Vorschau für {KIND_LABEL[kind] === 'Datei' ? 'diesen Dateityp' : `${KIND_LABEL[kind]}en`}</p>
        <p className="muted">Öffne die Datei mit einer passenden App auf deinem Gerät.</p>
        <div className="input-row center">
          {shareable && (
            <button className="btn primary" onClick={share}>
              <Icon name="share" size={18} /> Öffnen mit …
            </button>
          )}
          <button className={`btn ${shareable ? 'ghost' : 'primary'}`} onClick={() => downloadBlob(blob, name)}>
            <Icon name="download" size={18} /> Herunterladen
          </button>
        </div>
      </div>
    );

  const where = pathOf(folders, file.folderId).map((p) => p.name).join(' / ');

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={name}>
      <header className="viewer-header">
        <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <Icon name="back" />
        </button>
        <div className="viewer-title">
          <strong className="ellipsis">{name}</strong>
          <span className="muted small ellipsis">
            {KIND_LABEL[kind]} · {formatSize(file.size)} · {formatDate(file.createdAt)}
          </span>
        </div>
        {(kind === 'pdf' || kind === 'image' || kind === 'text' || kind === 'video' || kind === 'audio') && (
          <button className="icon-btn" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen" onClick={open} disabled={!url}>
            <Icon name="open" />
          </button>
        )}
        {shareable && (
          <button className="icon-btn" aria-label="Teilen" title="Teilen" onClick={share}>
            <Icon name="share" />
          </button>
        )}
        <button className="icon-btn" aria-label="Herunterladen" title="Herunterladen" onClick={() => blob && downloadBlob(blob, name)} disabled={!blob}>
          <Icon name="download" />
        </button>
        <button className="icon-btn" aria-label="Bearbeiten" title="Bearbeiten" onClick={() => setEditing(true)}>
          <Icon name="edit" />
        </button>
      </header>
      <div className="viewer-body">
        {(file.description || where) && (
          <div className="viewer-info">
            {file.description && <p>{file.description}</p>}
            <p className="muted small">
              <Icon name="folder" size={14} /> {where}
            </p>
          </div>
        )}
        {body}
      </div>
      {editing && <FileEditorSheet file={file} onClose={() => setEditing(false)} />}
    </div>
  );
}
