// Feste Seiten im Format A4 (in CSS-Pixeln bei 96 dpi). Auf allen Geräten gleich groß –
// am Handy wird nur verkleinert angezeigt (und man kann zoomen).
export const PAGE_W = 794;
export const PAGE_H = 1123;
export const MARGIN_X = 72;
export const MARGIN_Y = 72;
/** Abstand zwischen den Seiten (in Seiten-Pixeln). */
export const GAP = 72;
export const CONTENT_W = PAGE_W - 2 * MARGIN_X;
export const CONTENT_H = PAGE_H - 2 * MARGIN_Y;
/** Von Seitenanfang zu Seitenanfang. */
export const PITCH = PAGE_H + GAP;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;

/**
 * Tippt man gerade in ein Textfeld (Titel, Formel …)? Dann gehören Strg+Z/Entf dem Feld.
 * Regler, Farbwähler, Schalter und Auswahllisten zählen nicht – nach dem Einstellen von Farbe/Stärke soll Strg+Z den Strich rückgängig machen.
 */
export function typesText(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  return !['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'file'].includes((t as HTMLInputElement).type);
}
