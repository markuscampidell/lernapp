import { useState, type ReactNode } from 'react';
import { useLibrary } from '../state/Library';
import { openLightbox } from './Lightbox';

/**
 * Profilbild einer Person – oder ihr Anfangsbuchstabe. children ersetzt beides (z. B. ein Häkchen bei Auswahl).
 * expand: Antippen zeigt das Profilbild groß (nur wenn es eines gibt).
 */
export function Avatar({ id, name, size, children, expand }: { id: string | null | undefined; name?: string; size?: 'sm' | 'lg'; children?: ReactNode; expand?: boolean }) {
  const { avatarOf, userName } = useLibrary();
  const url = avatarOf(id);
  const [broken, setBroken] = useState<string | null>(null);
  const label = name ?? userName(id);
  const shown = !children && url && broken !== url ? url : null;
  const cls = `avatar${size ? ` avatar-${size}` : ''}`;
  if (expand && shown) {
    const open = (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openLightbox({ src: shown, alt: `Profilbild von ${label}`, round: true });
    };
    return (
      <span
        className={`${cls} zoomable`}
        role="button"
        tabIndex={0}
        aria-label={`Profilbild von ${label} vergrößern`}
        title="Vergrößern"
        onClick={open}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      >
        <img src={shown} alt="" loading="lazy" onError={() => setBroken(shown)} />
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      {children ?? (shown ? <img src={shown} alt="" loading="lazy" onError={() => setBroken(shown)} /> : label.slice(0, 1))}
    </span>
  );
}
