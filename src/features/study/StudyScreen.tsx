import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  bar,
  bodyClass,
}: {
  /** Feste Leiste zwischen Kopfzeile und Inhalt (scrollt nicht mit). */
  bar?: ReactNode;
  bodyClass?: string;
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
  // Kopfzeile und Werkzeugleisten immer sichtbar halten: Öffnet sich am Handy die Tastatur, schiebt der Browser
  // die ganze Seite nach oben (und die Leisten aus dem Bild). Dann passt sich der Bildschirm dem sichtbaren Bereich an.
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const vv = window.visualViewport;
    const fit = () => {
      if (vv) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = 'auto';
      }
      // Der Browser scrollt beim Tippen manchmal auch den Rahmen selbst – zurück an den Anfang
      if (el.scrollTop) el.scrollTop = 0;
      if (window.scrollY && document.body.style.overflow === 'hidden') window.scrollTo(0, 0);
    };
    fit();
    // Die Tastatur fährt animiert ein – Safari meldet das oft erst am Ende. Deshalb nach dem Antippen eines
    // Eingabefelds eine Weile bei jedem Bild nachziehen, damit die Leisten gar nicht erst aus dem Bild rutschen.
    let follow = 0;
    let until = 0;
    const loop = () => {
      fit();
      follow = performance.now() < until ? requestAnimationFrame(loop) : 0;
    };
    const track = () => {
      until = performance.now() + 1200;
      if (!follow) follow = requestAnimationFrame(loop);
    };
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('resize', track);
    vv?.addEventListener('scroll', fit);
    el.addEventListener('scroll', fit);
    el.addEventListener('focusin', track);
    el.addEventListener('focusout', track);
    window.addEventListener('scroll', fit);
    return () => {
      if (follow) cancelAnimationFrame(follow);
      vv?.removeEventListener('resize', track);
      el.removeEventListener('focusin', track);
      el.removeEventListener('focusout', track);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      el.removeEventListener('scroll', fit);
      window.removeEventListener('scroll', fit);
    };
  }, []);
  return (
    <div ref={screen} className="viewer study-screen" role="dialog" aria-modal="true" aria-label={title}>
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
      {bar && <div className="study-bar">{bar}</div>}
      <div className={`viewer-body study-body${bodyClass ? ` ${bodyClass}` : ''}`}>
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
