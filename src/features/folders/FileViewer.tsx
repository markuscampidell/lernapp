import { useEffect, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf } from '../../domain/tree';
import { loadBlob } from '../../storage/blobs';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { downloadBlob, fileKind, formatDate, formatSize, fullName, isTouchDevice, KIND_LABEL } from '../../lib/files';
import { PdfView } from './PdfView';
import { useBackToClose } from '../../lib/router';
import { FileEditorSheet } from './FileEditorSheet';
import { CardsPanel, QuizPanel } from '../study/StudyPanels';
import { DocPanel } from '../docs/DocPanel';
import { FileShareSheet } from '../share/FileShareSheet';
import { ShareSheet } from '../share/ShareSheet';
import { cloudEnabled } from '../../cloud/supabase';
import { afterBack } from '../../lib/router';
import type { Folder } from '../../domain/types';
import { ChartPanel } from '../charts/ChartPanel';

const MAX_TEXT = 2 * 1024 * 1024;

/** Vollbild-Ansicht einer Datei mit Vorschau und Aktionen. */
export function FileViewer({ file: initial, onClose }: { file: FileItem; onClose: () => void }) {
  const { files, folders, me, userName, isOrphan } = useLibrary();
  // Immer die aktuelle Version (nach Umbenennen/Verschieben).
  const file = files.find((f) => f.id === initial.id);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);
  // Teilen: erst Auswahl (ganzer Ordner / nur diese Datei), dann ggf. der normale Teilen-Dialog des Ordners.
  const [sharing, setSharing] = useState(false);
  const [shareFolder, setShareFolder] = useState<Folder | null>(null);

  const kind = fileKind(initial);
  const readsText = kind === 'text' || kind === 'flashcards' || kind === 'quiz' || kind === 'richtext' || kind === 'chart';
  useBackToClose(onClose);

  // Neu laden, wenn sich der Inhalt ändert (z. B. Karteikarten bearbeitet).
  const blobId = file?.blobId ?? initial.blobId;
  const version = file?.updatedAt ?? initial.updatedAt;
  useEffect(() => {
    let u: string | undefined;
    let alive = true;
    loadBlob(blobId).then(async (b) => {
      if (!alive) return;
      if (!b) return setMissing(true);
      setBlob(b);
      u = URL.createObjectURL(b);
      setUrl(u);
      // Eigene Lern-Dateien immer lesen (Dokumente mit Bildern können groß sein), andere Texte nur bis 2 MB.
      if (readsText && (kind !== 'text' || b.size <= MAX_TEXT)) setText(await b.text());
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [blobId, version, readsText, kind]);

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
  // „Senden“ = an eine andere App übergeben (System-Teilen-Menü, z. B. WhatsApp, Mail). Nur auf Handys/Tablets –
  // am PC ist das Menü oft nicht vorhanden oder tut nichts. Mit Personen teilt man über den Ordner.
  const shareable = (() => {
    if (!blob || !isTouchDevice || !navigator.canShare) return false;
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
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // abgebrochen
      alert('Senden hat nicht geklappt – die Datei wird stattdessen heruntergeladen.');
      downloadBlob(blob, name);
    }
  };
  const open = () => url && window.open(url, '_blank', 'noopener');

  let body: React.ReactNode;
  if (missing)
    body = (
      <p className="notice critical">
        {file.shareId ? 'Die Datei konnte nicht geladen werden – bist du online?' : 'Der Inhalt dieser Datei wurde nicht gefunden.'}
      </p>
    );
  else if (!blob || !url) body = <p className="muted">Lädt …</p>;
  else if (kind === 'image') body = <img className="viewer-media" src={url} alt={file.name} />;
  else if (kind === 'video') body = <video className="viewer-media" src={url} controls playsInline />;
  else if (kind === 'audio') body = <audio className="viewer-audio" src={url} controls />;
  else if (kind === 'pdf') body = <PdfView blob={blob} />;
  else if (kind === 'text' && text !== null) body = <pre className="viewer-text">{text}</pre>;
  else if (kind === 'flashcards' && text !== null) body = <CardsPanel file={file} text={text} />;
  else if (kind === 'quiz' && text !== null) body = <QuizPanel file={file} text={text} />;
  else if (kind === 'richtext' && text !== null) body = <DocPanel file={file} text={text} />;
  else if (kind === 'chart' && text !== null) body = <ChartPanel file={file} text={text} />;
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
          <strong className="wrap-text">{name}</strong>
          <span className="muted small ellipsis">
            {KIND_LABEL[kind]} · {formatSize(file.size)} · {formatDate(file.createdAt)}
          </span>
        </div>
        {(kind === 'pdf' || kind === 'image' || kind === 'text' || kind === 'video' || kind === 'audio') && (
          <button className="icon-btn" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen" onClick={open} disabled={!url}>
            <Icon name="open" />
          </button>
        )}
        {cloudEnabled && !isOrphan(file.folderId) && (
          <button className="icon-btn" aria-label="Teilen" title="Teilen" onClick={() => setSharing(true)}>
            <Icon name="users" />
          </button>
        )}
        {shareable && (
          <button className="icon-btn" aria-label="An andere App senden" title="An andere App senden" onClick={share}>
            <Icon name="share" />
          </button>
        )}
        <button className="icon-btn" aria-label="Herunterladen" title="Herunterladen" onClick={() => blob && downloadBlob(blob, name)} disabled={!blob}>
          <Icon name="download" />
        </button>
        <button className="icon-btn" aria-label="Details" title="Details" onClick={() => setEditing(true)}>
          <Icon name="info" />
        </button>
      </header>
      <div className="viewer-body">
        {(file.description || where) && (
          <div className="viewer-info">
            {file.description && <p className="break">{file.description}</p>}
            <p className="muted small">
              <Icon name="folder" size={14} /> {where}
              {file.shareId && ` · hinzugefügt von ${file.createdBy === me?.id ? 'dir' : userName(file.createdBy)}`}
            </p>
          </div>
        )}
        {body}
      </div>
      {editing && <FileEditorSheet file={file} onClose={() => setEditing(false)} />}
      {sharing && (
        <FileShareSheet
          file={file}
          onClose={() => setSharing(false)}
          onFolder={(target) => {
            setSharing(false);
            afterBack(() => setShareFolder(target));
          }}
        />
      )}
      {shareFolder && <ShareSheet folder={shareFolder} onClose={() => setShareFolder(null)} />}
    </div>
  );
}
