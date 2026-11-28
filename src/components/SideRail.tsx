import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

/** Platz für die Aktions-Knöpfe direkt unter der Kopfzeile einer geöffneten Datei (nur am Handy genutzt). */
export const RailSlot = createContext<HTMLElement | null>(null);

const PHONE = '(max-width: 699px)';
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const m = window.matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * Aktions-Knöpfe einer Datei (z. B. „Quiz starten“, „Bearbeiten“) – immer erreichbar, egal wie weit man gescrollt hat.
 * Am PC fest rechts in der Bildschirmmitte (dort ist neben den Seiten Platz). Am Handy in einer schmalen Reihe fest
 * unter der Kopfzeile – rechts in der Mitte lägen sie über dem Text.
 */
export function SideRail({ children }: { children: ReactNode }) {
  const slot = useContext(RailSlot);
  const phone = usePhone();
  const rail = (
    <div className={`side-rail${slot && phone ? ' in-slot' : ''}`} role="toolbar" aria-label="Aktionen">
      {children}
    </div>
  );
  return slot && phone ? createPortal(rail, slot) : rail;
}

export function RailButton({
  icon,
  label,
  onClick,
  primary,
  disabled,
  title,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button className={`rail-btn${primary ? ' primary' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <Icon name={icon} size={22} />
      <span className="rail-label">{label}</span>
    </button>
  );
}
