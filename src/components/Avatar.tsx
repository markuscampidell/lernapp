import { useState, type ReactNode } from 'react';
import { useLibrary } from '../state/Library';

/** Profilbild einer Person – oder ihr Anfangsbuchstabe. children ersetzt beides (z. B. ein Häkchen bei Auswahl). */
export function Avatar({ id, name, size, children }: { id: string | null | undefined; name?: string; size?: 'sm' | 'lg'; children?: ReactNode }) {
  const { avatarOf, userName } = useLibrary();
  const url = avatarOf(id);
  const [broken, setBroken] = useState<string | null>(null);
  const label = name ?? userName(id);
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ''}`} aria-hidden="true">
      {children ?? (url && broken !== url ? <img src={url} alt="" loading="lazy" onError={() => setBroken(url)} /> : label.slice(0, 1))}
    </span>
  );
}
