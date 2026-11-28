import { visitedAt } from './visits';

/**
 * „Weg aus der Glocke“: Wer eine Neuigkeit antippt, bekommt unten eine kleine Leiste
 * „Neuigkeiten“ (zurück zur Glocke) und – falls es noch weitere ungelesene gibt – „Nächste“.
 * Gilt nur für diese Sitzung (sessionStorage) und endet, sobald man wieder in der Übersicht ist.
 */
export interface TrailStop {
  url: string;
  createdAt: string;
}
interface Trail {
  /** Ordner, in den die aktuelle Neuigkeit geführt hat – geht man woandershin, endet der Weg. */
  folder: string;
  /** Die noch nicht besuchten ungelesenen Neuigkeiten nach der aktuellen, in der Reihenfolge der Glocke. */
  rest: TrailStop[];
}

/** #ordner/<ordner>[/<datei>[/kommentare]] → <ordner> */
const folderOf = (url: string) => decodeURIComponent(url.replace(/^#/, '').split('/')[1] ?? '');

const KEY = 'lernapp-glocke-weg';
const EVENT = 'lernapp:glocke-weg';
let openBellRequested = false;

function read(): Trail | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
function write(t: Trail | null) {
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const startTrail = (url: string, rest: TrailStop[]) => write({ folder: folderOf(url), rest });
export const trailFolder = () => read()?.folder ?? null;
export const endTrail = () => read() && write(null);
export const hasTrail = () => !!read();

/** Weitere ungelesene, die man inzwischen nicht schon anders geöffnet hat. */
export function remaining(): TrailStop[] {
  return (read()?.rest ?? []).filter((s) => visitedAt(s.url) < Date.parse(s.createdAt));
}

/** Nächste Neuigkeit: gibt ihr Ziel zurück und rückt den Weg weiter. */
export function takeNext(): string | null {
  const [next, ...rest] = remaining();
  if (!next) return null;
  write({ folder: folderOf(next.url), rest });
  return next.url;
}

/** Die Glocke soll aufgehen, sobald die Übersicht da ist. */
export function requestBellOpen() {
  openBellRequested = true;
}
export function consumeBellRequest() {
  const r = openBellRequested;
  openBellRequested = false;
  return r;
}

export function onTrailChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
