import { useEffect, useState, type ReactNode } from 'react';
import type { FileItem } from '../../domain/types';
import { useBackToClose } from '../../lib/router';
import { Icon } from '../../components/Icon';
import { EditingLock, EditingNotice, useEditors } from '../../cloud/editing';

/** Vollbild-Ansicht für Editoren und Lernmodi (Zurück-Taste schließt). */
export function StudyScreen({
  title,
  subtitle,
  onClose,
  actions,
  children,
  footer,
  editing,
}: {
  /** Diese geteilte Datei wird hier bearbeitet: anzeigen, wenn jemand anderes sie gerade auch bearbeitet. */
  editing?: FileItem;
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useBackToClose(onClose);
  const { others, mine } = useEditors(editing);
  // Wer zuerst da war, wird nicht blockiert – nur wer später dazukommt.
  const earlier = others.filter((o) => o.since <= mine);
  // Einmal gesperrt, bleibt gesperrt: der geladene Inhalt ist evtl. veraltet, also neu öffnen.
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (earlier.length > 0) setLocked(true);
  }, [earlier.length]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="viewer study-screen" role="dialog" aria-modal="true" aria-label={title}>
      <header className="viewer-header">
        <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="viewer-title">
          <strong className="ellipsis">{title}</strong>
          {subtitle && <span className="muted small ellipsis">{subtitle}</span>}
        </div>
        {actions}
      </header>
      <div className="viewer-body study-body">
        <EditingNotice others={others} />
        {children}
      </div>
      {footer && <footer className="study-footer">{footer}</footer>}
      {locked && <EditingLock others={earlier} onClose={onClose} />}
    </div>
  );
}

/** Seitenweise blättern: ‹ Karte 3 von 10 › plus Nummern zum Springen. */
export function Pager({
  index,
  count,
  noun,
  onIndex,
  marks,
}: {
  index: number;
  count: number;
  noun: string;
  onIndex: (i: number) => void;
  /** Seiten mit Problem (rot markiert). */
  marks?: Set<number>;
}) {
  return (
    <div className="pager">
      <div className="pager-row">
        <button className="icon-btn" aria-label="Vorherige" disabled={index === 0} onClick={() => onIndex(index - 1)}>
          <Icon name="back" />
        </button>
        <strong className="grow center-text">
          {noun} {index + 1} von {count}
        </strong>
        <button className="icon-btn" aria-label="Nächste" disabled={index >= count - 1} onClick={() => onIndex(index + 1)}>
          <Icon name="chevron" />
        </button>
      </div>
      {count > 1 && (
        <div className="pager-dots" data-no-swipe>
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              className={`pager-dot${i === index ? ' active' : ''}${marks?.has(i) ? ' bad' : ''}`}
              onClick={() => onIndex(i)}
              aria-label={`${noun} ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
