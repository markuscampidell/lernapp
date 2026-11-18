import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Feste Knöpfe rechts in der Bildschirmmitte (z. B. „Quiz starten“, „Bearbeiten“) –
 * immer erreichbar, egal wie weit man in einer Datei gescrollt hat.
 */
export function SideRail({ children }: { children: ReactNode }) {
  return (
    <div className="side-rail" role="toolbar" aria-label="Aktionen">
      {children}
    </div>
  );
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
