import { useSyncExternalStore } from 'react';

/** Welche Knöpfe rechts an Ordnern und Dateien in der Liste stehen (pro Gerät, Einstellungen → Auf diesem Gerät). */
export interface CardButtons {
  people: boolean;
  move: boolean;
  info: boolean;
}

const KEY = 'lernapp-kartenknoepfe';
const EVENT = 'lernapp-kartenknoepfe';

/** Standard: Verschieben nur mit Maus (PC) – am Handy reicht langes Drücken, und dort ist wenig Platz. */
const defaults = (): CardButtons => ({
  people: true,
  move: typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches,
  info: true,
});

let cache: CardButtons | null = null;
function read(): CardButtons {
  if (cache) return cache;
  let saved: Partial<CardButtons> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* nichts gespeichert */
  }
  cache = { ...defaults(), ...saved };
  return cache;
}

export function setCardButton(key: keyof CardButtons, on: boolean) {
  cache = { ...read(), [key]: on };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Speichern nicht möglich – gilt dann nur bis zum Neuladen */
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export const useCardButtons = () => useSyncExternalStore(subscribe, read);
