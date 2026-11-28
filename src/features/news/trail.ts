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
  /** Stand „zuletzt gelesen“ beim ersten Öffnen der Glocke – damit beim Wiederöffnen dieselben als neu markiert sind. */
  since: number;
}

/** #ordner/<ordner>[/<datei>[/kommentare]] → <ordner> */
const folderOf = (url: string) => decodeURIComponent(url.replace(/^#/, '').split('/')[1] ?? '');

const KEY = 'lernapp-glocke-weg';
const EVENT = 'lernapp:glocke-weg';
const OPEN = 'lernapp:glocke-oeffnen';
/** Ziel der zuletzt angetippten Neuigkeit – der Ordner hebt das Erwähnte dann kurz orange hervor. */
let arrival: string | null = null;

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

export function startTrail(url: string, rest: TrailStop[], since: number) {
  arrival = url;
  write({ folder: folderOf(url), rest, since });
}
export const trailSince = () => read()?.since;
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
  const t = read();
  if (!next || !t) return null;
  arrival = next.url;
  write({ ...t, folder: folderOf(next.url), rest });
  return next.url;
}

/** Die Neuigkeiten gleich hier öffnen (ohne zur Übersicht zu wechseln). */
export const openBellHere = () => window.dispatchEvent(new Event(OPEN));
export function onOpenBell(fn: () => void) {
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

export function onTrailChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/**
 * Kam man gerade über die Glocke in diesen Ordner? Gibt dann die erwähnte Datei zurück (fileId, bei Neuigkeiten zu
 * einer Datei) bzw. {} (bei Neuigkeiten zum Ordner selbst) – nur einmal.
 */
export function consumeArrival(folderId: string): { fileId?: string } | null {
  if (!arrival || folderOf(arrival) !== folderId) return null;
  const file = arrival.replace(/^#/, '').split('/')[2];
  arrival = null;
  return file ? { fileId: decodeURIComponent(file) } : {};
}
