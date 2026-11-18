// Hintergrund der App (nur auf diesem Gerät). Ein Muster legt auch hell/dunkel fest, damit Text lesbar bleibt.
export type Scheme = 'light' | 'dark';
export interface Background {
  id: string;
  name: string;
  /** null = wie das Gerät (hell/dunkel) */
  scheme: Scheme | null;
}

export const BACKGROUNDS: Background[] = [
  { id: 'standard', name: 'Standard', scheme: null },
  { id: 'punkte', name: 'Punkte', scheme: 'light' },
  { id: 'dunkel', name: 'Dunkel', scheme: 'dark' },
  { id: 'karo', name: 'Karopapier', scheme: 'light' },
  { id: 'tafel', name: 'Tafel', scheme: 'dark' },
  { id: 'strand', name: 'Strand', scheme: 'light' },
  { id: 'weltall', name: 'Weltall', scheme: 'dark' },
  { id: 'sonnenuntergang', name: 'Sonnenuntergang', scheme: 'light' },
  { id: 'berge', name: 'Berge', scheme: 'light' },
  { id: 'wald', name: 'Wald', scheme: 'dark' },
  { id: 'konfetti', name: 'Konfetti', scheme: 'light' },
];

const KEY = 'lernapp-hintergrund';

export function loadBackground(): string {
  try {
    const id = localStorage.getItem(KEY);
    return BACKGROUNDS.some((b) => b.id === id) ? id! : 'standard';
  } catch {
    return 'standard';
  }
}

/** Setzt den Hintergrund auf <html> (data-bg, data-scheme). */
export function applyBackground(id: string) {
  const bg = BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
  const root = document.documentElement;
  if (bg.id === 'standard') delete root.dataset.bg;
  else root.dataset.bg = bg.id;
  if (bg.scheme) root.dataset.scheme = bg.scheme;
  else delete root.dataset.scheme;
}

export function saveBackground(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* egal – gilt dann nur bis zum Neuladen */
  }
  applyBackground(id);
}
