// „Weniger Bewegung“ (nur auf diesem Gerät). Ohne eigene Wahl: wie am Gerät eingestellt (prefers-reduced-motion).
import { useSyncExternalStore } from 'react';

const KEY = 'lernapp-wenig-bewegung';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const listeners = new Set<() => void>();

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

/** Gerade weniger Bewegung? (eigene Wahl, sonst Geräte-Einstellung) */
export function reducedMotion(): boolean {
  return stored() ?? !!media?.matches;
}

/** Setzt data-reduce-motion auf <html>; CSS schaltet damit Übergänge und Animationen ab. */
export function applyMotion() {
  const root = document.documentElement;
  if (reducedMotion()) root.dataset.reduceMotion = '';
  else delete root.dataset.reduceMotion;
  listeners.forEach((l) => l());
}

export function setReducedMotion(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* egal – gilt dann nur bis zum Neuladen */
  }
  applyMotion();
}

/** Einmal beim Start: anwenden und Änderungen der Geräte-Einstellung verfolgen. */
export function initMotion() {
  applyMotion();
  media?.addEventListener('change', applyMotion);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reducedMotion,
  );
}
