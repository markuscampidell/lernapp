/**
 * Merkt sich (auf diesem Gerät), wann man einen Ordner, eine Datei oder deren Kommentare zuletzt geöffnet hat.
 * Die Glocke zählt eine Neuigkeit als gelesen, wenn man ihr Ziel nach ihrem Entstehen schon selbst geöffnet hat –
 * auch ohne über die Glocke zu gehen.
 * Schlüssel sind die Ziele der Neuigkeiten: #ordner/<ordner>, #ordner/<ordner>/<datei>, #ordner/<ordner>/<datei>/kommentare.
 */
const KEY = 'lernapp-besucht';
const EVENT = 'lernapp:besucht';
const MAX = 300;

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function markVisited(path: string) {
  const all = load();
  all[path] = Date.now();
  // Nur die zuletzt besuchten behalten.
  const keep = Object.entries(all)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* egal */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const visitedAt = (path: string) => load()[path] ?? 0;

export const fileVisitPath = (folderId: string, fileId: string, comments = false) =>
  `#ordner/${folderId}/${fileId}${comments ? '/kommentare' : ''}`;

/** Für die Glocke: bei jedem Besuch neu zeichnen. */
export function onVisited(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
