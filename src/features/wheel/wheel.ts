// Glücksrad: eigene Lern-Datei (JSON) und eingebettet in Text-Dokumente (<figure class="wheel" data-wheel="…">).
import { newId } from '../../lib/id';
import { PALETTE } from '../charts/chart';

export const WHEEL_EXT = 'gluecksrad';
export const WHEEL_MIME = 'application/vnd.lernapp.gluecksrad+json';
export const MAX_ENTRIES = 40;
export const MAX_WEIGHT = 10;

export interface WheelEntry {
  id: string;
  label: string;
  /** Größe des Feldes (1 = normal, 2 = doppelt so groß …) – kommt entsprechend öfter. */
  weight: number;
}
export interface Wheel {
  type: 'lernapp-gluecksrad';
  version: 1;
  title: string;
  entries: WheelEntry[];
  /** Gezogene Einträge für die nächsten Drehungen herausnehmen (bis „Zurücksetzen“). */
  removePicked: boolean;
}

export const newEntry = (label = '', weight = 1): WheelEntry => ({ id: newId(), label, weight });
export const emptyWheel = (): Wheel => ({
  type: 'lernapp-gluecksrad',
  version: 1,
  title: '',
  entries: [newEntry('Ja'), newEntry('Nein'), newEntry('Vielleicht')],
  removePicked: false,
});

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const weightOf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_WEIGHT, n)) : 1;
};

/** Tolerant einlesen (Datei-Inhalt oder data-wheel). */
export function parseWheel(input: string | unknown): Wheel {
  let raw: Record<string, unknown> = {};
  try {
    raw = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') raw = {};
  } catch {
    /* leer */
  }
  return {
    type: 'lernapp-gluecksrad',
    version: 1,
    title: str(raw.title, 200),
    removePicked: raw.removePicked === true,
    entries: (Array.isArray(raw.entries) ? raw.entries : [])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .slice(0, MAX_ENTRIES)
      .map((e) => ({ id: str(e.id, 40) || newId(), label: str(e.label, 80), weight: weightOf(e.weight) })),
  };
}

export const cleanWheel = (w: Wheel): Wheel => ({ ...w, title: w.title.trim(), entries: w.entries.filter((e) => e.label.trim()).map((e) => ({ ...e, label: e.label.trim() })) });
export const wheelJson = (w: Wheel) => JSON.stringify(cleanWheel(w));
export const wheelBlob = (w: Wheel) => new Blob([JSON.stringify(cleanWheel(w), null, 1)], { type: WHEEL_MIME });
export const wheelText = (w: Wheel) => `Glücksrad: ${w.title.trim() || w.entries.map((e) => e.label).filter(Boolean).slice(0, 3).join(', ') || 'Glücksrad'}`;

// ---------- Text-Eingabe: ein Eintrag pro Zeile, optional „×2“ für doppelte Größe ----------
export const entriesToText = (entries: WheelEntry[]) => entries.map((e) => (e.weight > 1 ? `${e.label} ×${e.weight}` : e.label)).join('\n');
export function textToEntries(text: string, old: WheelEntry[] = []): WheelEntry[] {
  const out: WheelEntry[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const m = line.match(/^(.*?)\s*[×x*]\s*(\d{1,2})\s*$/i);
    const label = (m && m[1].trim() ? m[1] : line).trim();
    out.push({ id: old[i]?.id ?? newId(), label, weight: m && m[1].trim() ? weightOf(m[2]) : 1 });
  });
  return out.slice(0, MAX_ENTRIES);
}

// ---------- Zeichnen ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const r1 = (n: number) => Math.round(n * 10) / 10;

export const SIZE = 400;
const C = SIZE / 2;
const R = 180;

/** Winkelbereiche (Grad, im Uhrzeigersinn ab oben) der Felder. */
export function slices(entries: WheelEntry[]): { entry: WheelEntry; from: number; to: number; color: string }[] {
  const total = entries.reduce((n, e) => n + e.weight, 0) || 1;
  let a = 0;
  return entries.map((entry, i) => {
    const from = a;
    a += (entry.weight / total) * 360;
    // Bei ungerader Anzahl würden erstes und letztes Feld gleich gefärbt – dann eine andere Farbe nehmen.
    const n = entries.length;
    const idx = n > 1 && i === n - 1 && i % PALETTE.length === 0 ? 1 : i % PALETTE.length;
    return { entry, from, to: a, color: PALETTE[idx] };
  });
}

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};

/** Nur die Scheibe (Felder + Beschriftung) – wird beim Drehen als Ganzes rotiert. */
export function discSvg(entries: WheelEntry[], edge = 'var(--surface)'): string {
  if (!entries.length) return `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--border)" stroke-width="3" stroke-dasharray="8 8"/>`;
  if (entries.length === 1) {
    return `<circle cx="${C}" cy="${C}" r="${R}" fill="${PALETTE[0]}"/><text x="${C}" y="${C - R / 2}" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="700" fill="#fff">${esc(cut(entries[0].label, 18))}</text>`;
  }
  const parts = slices(entries);
  const font = parts.length > 24 ? 11 : parts.length > 14 ? 13 : parts.length > 8 ? 15 : 18;
  const maxChars = parts.length > 14 ? 14 : 16;
  let out = '';
  for (const p of parts) {
    const [x1, y1] = pt(p.from, R);
    const [x2, y2] = pt(p.to, R);
    const large = p.to - p.from > 180 ? 1 : 0;
    out += `<path d="M${C} ${C} L${r1(x1)} ${r1(y1)} A${R} ${R} 0 ${large} 1 ${r1(x2)} ${r1(y2)} Z" fill="${p.color}" stroke="${edge}" stroke-width="2"/>`;
  }
  for (const p of parts) {
    const span = p.to - p.from;
    if (span < 5) continue;
    const mid = (p.from + p.to) / 2;
    const size = Math.min(font, Math.max(9, span * 0.9));
    // Linke Hälfte gedreht schreiben, damit nichts auf dem Kopf steht.
    const left = mid > 180;
    out += left
      ? `<g transform="rotate(${r1(mid + 90)} ${C} ${C})"><text x="${C - R + 16}" y="${C}" text-anchor="start" dominant-baseline="central" font-size="${r1(size)}" font-weight="600" fill="#fff">${esc(cut(p.entry.label, maxChars))}</text></g>`
      : `<g transform="rotate(${r1(mid - 90)} ${C} ${C})"><text x="${C + R - 16}" y="${C}" text-anchor="end" dominant-baseline="central" font-size="${r1(size)}" font-weight="600" fill="#fff">${esc(cut(p.entry.label, maxChars))}</text></g>`;
  }
  return out;
}

/** Zeiger oben und Nabe in der Mitte (drehen sich nicht mit). */
export function frameSvg(edge = 'var(--surface)', text = 'var(--text)'): string {
  return (
    `<circle cx="${C}" cy="${C}" r="${R + 6}" fill="none" stroke="${text}" stroke-opacity="0.18" stroke-width="6"/>` +
    `<circle cx="${C}" cy="${C}" r="22" fill="${edge}" stroke="${text}" stroke-opacity="0.25" stroke-width="3"/>` +
    `<path d="M${C - 16} 2 L${C + 16} 2 L${C} 34 Z" fill="${text}" stroke="${edge}" stroke-width="3" stroke-linejoin="round"/>`
  );
}

const svgOpen = (bg = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" role="img" aria-label="Glücksrad">${bg}`;

/** Ganzes Rad als statisches SVG (Editor-Vorschau im Dokument). */
export function wheelSvg(w: Wheel): string {
  return `${svgOpen()}${discSvg(cleanWheel(w).entries)}${frameSvg()}</svg>`;
}
/** Mit festen Farben (Bild für die Zwischenablage). */
export function wheelPrintSvg(w: Wheel): string {
  return `${svgOpen(`<rect width="${SIZE}" height="${SIZE}" fill="#fff"/>`)}${discSvg(cleanWheel(w).entries, '#ffffff')}${frameSvg('#ffffff', '#1c1c1b')}</svg>`;
}

/** Zufälliges Feld (nach Größe gewichtet) und der Zielwinkel darin (nicht ganz am Rand). */
export function pick(entries: WheelEntry[]): { entry: WheelEntry; angle: number } | null {
  if (!entries.length) return null;
  const parts = slices(entries);
  const total = entries.reduce((n, e) => n + e.weight, 0);
  let r = Math.random() * total;
  let chosen = parts[parts.length - 1];
  for (const p of parts) {
    r -= p.entry.weight;
    if (r < 0) {
      chosen = p;
      break;
    }
  }
  const span = chosen.to - chosen.from;
  return { entry: chosen.entry, angle: chosen.from + span * (0.15 + Math.random() * 0.7) };
}
