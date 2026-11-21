import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useBackToClose } from '../lib/router';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Optionales Element links vom Titel (z. B. Zurück-Knopf). */
  leading?: ReactNode;
  /** Fest unter dem scrollenden Inhalt (über dem Fuß). Auf niedrigen Bildschirmen scrollt es mit. */
  pinned?: ReactNode;
}

/** Unten aufklappendes Blatt auf Handys, zentrierter Dialog auf größeren Bildschirmen. */
export function Sheet({ title, onClose, children, footer, leading, pinned }: SheetProps) {
  useBackToClose(onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Direkt in <body>: sonst schneiden feste Leisten (z. B. oben in der Ordner-Übersicht) den Dialog ab.
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-header">
          {leading}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>
        {pinned ? (
          <div className="sheet-main">
            <div className="sheet-body">{children}</div>
            <div className="sheet-pinned">{pinned}</div>
          </div>
        ) : (
          <div className="sheet-body">{children}</div>
        )}
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
