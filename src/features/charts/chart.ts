// Diagramme: eigene Lern-Datei (JSON) und eingebettet in Text-Dokumente (<figure class="chart" data-chart="…">).
// Gezeichnet wird immer als SVG aus den Daten – so bleiben Diagramme klein, scharf und bearbeitbar.
import { newId } from '../../lib/id';

export const CHART_EXT = 'diagramm';
export const CHART_MIME = 'application/vnd.lernapp.diagramm+json';

export type ChartType = 'bar' | 'hbar' | 'line' | 'pie' | 'donut';
export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'bar', label: 'Säulen' },
  { id: 'hbar', label: 'Balken' },
  { id: 'line', label: 'Linie' },
  { id: 'pie', label: 'Kreis' },
  { id: 'donut', label: 'Ring' },
];

export interface ChartPoint {
  id: string;
  label: string;
  value: number;
}
export interface Chart {
  type: 'lernapp-diagramm';
  version: 1;
  chart: ChartType;
  title: string;
  /** Einheit hinter den Werten, z. B. "%" oder "€". */
  unit: string;
  /** Werte an den Säulen/Punkten bzw. Prozent im Kreis anzeigen. */
  showValues: boolean;
  points: ChartPoint[];
}

export const MAX_POINTS = 40;
const TYPES = new Set(CHART_TYPES.map((t) => t.id));

export const newPoint = (label = '', value = 0): ChartPoint => ({ id: newId(), label, value });
export const emptyChart = (): Chart => ({
  type: 'lernapp-diagramm',
  version: 1,
  chart: 'bar',
  title: '',
  unit: '',
  showValues: true,
  points: [newPoint('A', 3), newPoint('B', 5), newPoint('C', 2)],
});

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : 0;
};

/** Liest ein Diagramm tolerant ein (aus Datei-Inhalt oder data-chart). */
export function parseChart(input: string | unknown): Chart {
  let raw: Record<string, unknown> = {};
  try {
    raw = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') raw = {};
  } catch {
    /* leer */
  }
  const type = String(raw.chart) as ChartType;
  return {
    type: 'lernapp-diagramm',
    version: 1,
    chart: TYPES.has(type) ? type : 'bar',
    title: str(raw.title, 200),
    unit: str(raw.unit, 12),
    showValues: raw.showValues !== false,
    points: (Array.isArray(raw.points) ? raw.points : [])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .slice(0, MAX_POINTS)
      .map((p) => ({ id: str(p.id, 40) || newId(), label: str(p.label, 80), value: num(p.value) })),
  };
}

/** Leere Zeilen weglassen. */
export const cleanChart = (c: Chart): Chart => ({ ...c, title: c.title.trim(), unit: c.unit.trim(), points: c.points.filter((p) => p.label.trim() || p.value !== 0) });
export const chartJson = (c: Chart) => JSON.stringify(cleanChart(c));
export const chartBlob = (c: Chart) => new Blob([JSON.stringify(cleanChart(c), null, 1)], { type: CHART_MIME });

// ---------- Text-Eingabe: "Beschriftung: Wert" pro Zeile ----------
export function pointsToText(points: ChartPoint[]): string {
  return points.map((p) => `${p.label}: ${formatNumber(p.value)}`).join('\n');
}
/** Jede Zeile: Beschriftung und Zahl (die letzte Zahl der Zeile ist der Wert). */
export function textToPoints(text: string, old: ChartPoint[] = []): ChartPoint[] {
  const out: ChartPoint[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const m = line.match(/^(.*?)[\s:;=|,\t]*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/);
    const label = (m ? m[1] : line).replace(/[\s:;=|\t]+$/, '').trim();
    const value = m ? parseFloat(m[2].replace(',', '.')) : 0;
    out.push({ id: old[i]?.id ?? newId(), label, value });
  });
  return out.slice(0, MAX_POINTS);
}

// ---------- Zeichnen ----------
export const PALETTE = ['#2a78d6', '#eb6834', '#1f8a4c', '#8a4fd1', '#d6a12a', '#d64575', '#1fa0a8', '#7a8a1f', '#6b6b66', '#b84a2a'];

export function formatNumber(v: number): string {
  return v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
const fmt = (v: number, unit: string) => `${formatNumber(v)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Schöne Achsen-Schritte (1, 2, 2.5, 5, 10 …). */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export interface Colors {
  text: string;
  muted: string;
  grid: string;
  bg?: string;
}
/** Im App-Design (folgt hell/dunkel über CSS-Variablen). */
export const THEME: Colors = { text: 'var(--text)', muted: 'var(--text-2)', grid: 'var(--border)' };
/** Feste Farben für Bilder (Zwischenablage, andere Apps). */
export const PRINT: Colors = { text: '#1c1c1b', muted: '#5f5e5a', grid: '#dcdcd8', bg: '#ffffff' };

const W = 520;

/** Diagramm als SVG-Text. */
export function chartSvg(c: Chart, colors: Colors = THEME): string {
  const pts = c.points.filter((p) => p.label.trim() || p.value !== 0);
  const title = c.title.trim();
  const top = title ? 44 : 14;
  const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"`;
  let body = '';
  let H = 360;

  if (!pts.length) {
    H = 160;
    body = `<text x="${W / 2}" y="${top + 50}" text-anchor="middle" font-size="15" fill="${colors.muted}">Noch keine Werte</text>`;
  } else if (c.chart === 'pie' || c.chart === 'donut') {
    const vals = pts.map((p) => Math.max(0, p.value));
    const total = vals.reduce((a, b) => a + b, 0);
    const legendRows = pts.length;
    H = Math.max(top + 270, top + 24 + legendRows * 26);
    const cx = 132;
    const cy = top + 125;
    const R = 112;
    const inner = c.chart === 'donut' ? 60 : 0;
    let a = -Math.PI / 2;
    if (total <= 0) {
      body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${colors.grid}" stroke-width="2"/>`;
    } else
      vals.forEach((v, i) => {
        if (v <= 0) return;
        const color = PALETTE[i % PALETTE.length];
        const ang = (v / total) * Math.PI * 2;
        if (ang >= Math.PI * 2 - 1e-6) {
          body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}"/>`;
        } else {
          const b = a + ang;
          const large = ang > Math.PI ? 1 : 0;
          const x1 = cx + R * Math.cos(a);
          const y1 = cy + R * Math.sin(a);
          const x2 = cx + R * Math.cos(b);
          const y2 = cy + R * Math.sin(b);
          body += `<path d="M${r1(cx)} ${r1(cy)} L${r1(x1)} ${r1(y1)} A${R} ${R} 0 ${large} 1 ${r1(x2)} ${r1(y2)} Z" fill="${color}" stroke="${colors.bg ?? 'var(--surface)'}" stroke-width="2"/>`;
        }
        if (c.showValues && ang > 0.38) {
          const mid = a + ang / 2;
          const rr = inner ? (R + inner) / 2 : R * 0.62;
          body += `<text x="${r1(cx + rr * Math.cos(mid))}" y="${r1(cy + rr * Math.sin(mid) + 5)}" text-anchor="middle" font-size="14" font-weight="600" fill="#fff">${Math.round((v / total) * 100)}%</text>`;
        }
        a += ang;
      });
    if (inner) {
      body += `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="${colors.bg ?? 'var(--surface)'}"/>`;
      body += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="${colors.text}">${esc(formatNumber(total))}</text>`;
      body += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="14" fill="${colors.muted}">${esc(c.unit ? `${c.unit} gesamt` : 'gesamt')}</text>`;
    }
    // Legende
    const ly = top + 24 + Math.max(0, (250 - legendRows * 26) / 2);
    pts.forEach((p, i) => {
      const y = ly + i * 26;
      body += `<rect x="268" y="${y - 11}" width="14" height="14" rx="3" fill="${PALETTE[i % PALETTE.length]}"/>`;
      body += `<text x="290" y="${y + 1}" font-size="15" fill="${colors.text}">${esc(cut(p.label || '–', 15))}</text>`;
      body += `<text x="${W - 12}" y="${y + 1}" text-anchor="end" font-size="15" fill="${colors.muted}">${esc(fmt(p.value, c.unit))}</text>`;
    });
  } else if (c.chart === 'hbar') {
    const rowH = Math.max(22, Math.min(40, 300 / pts.length));
    H = top + 16 + pts.length * rowH + 30;
    const left = 120;
    const right = W - 64;
    const ticks = niceTicks(Math.min(0, ...pts.map((p) => p.value)), Math.max(0, ...pts.map((p) => p.value)));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const x = (v: number) => left + ((v - lo) / (hi - lo)) * (right - left);
    const bottom = top + 8 + pts.length * rowH;
    ticks.forEach((t) => {
      body += `<line x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${top}" y2="${bottom}" stroke="${colors.grid}" stroke-width="1"/>`;
      body += `<text x="${r1(x(t))}" y="${bottom + 18}" text-anchor="middle" font-size="14" fill="${colors.muted}">${esc(formatNumber(t))}</text>`;
    });
    pts.forEach((p, i) => {
      const y = top + 8 + i * rowH;
      const bh = rowH * 0.66;
      const x0 = x(Math.min(0, p.value));
      const x1 = x(Math.max(0, p.value));
      body += `<text x="${left - 10}" y="${r1(y + rowH / 2 + 5)}" text-anchor="end" font-size="14" fill="${colors.text}">${esc(cut(p.label, 14))}</text>`;
      body += `<rect x="${r1(x0)}" y="${r1(y + (rowH - bh) / 2)}" width="${r1(Math.max(1, x1 - x0))}" height="${r1(bh)}" rx="4" fill="${PALETTE[0]}"/>`;
      if (c.showValues)
        body += `<text x="${r1(p.value < 0 ? x0 - 6 : x1 + 6)}" y="${r1(y + rowH / 2 + 5)}" text-anchor="${p.value < 0 ? 'end' : 'start'}" font-size="14" fill="${colors.muted}">${esc(fmt(p.value, c.unit))}</text>`;
    });
  } else {
    // Säulen & Linie
    const left = 50;
    const right = W - 16;
    const bottom = H - 48;
    const ticks = niceTicks(Math.min(0, ...pts.map((p) => p.value)), Math.max(0, ...pts.map((p) => p.value)));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top - 10);
    ticks.forEach((t) => {
      body += `<line x1="${left}" x2="${right}" y1="${r1(y(t))}" y2="${r1(y(t))}" stroke="${colors.grid}" stroke-width="1"/>`;
      body += `<text x="${left - 8}" y="${r1(y(t) + 4)}" text-anchor="end" font-size="14" fill="${colors.muted}">${esc(formatNumber(t))}</text>`;
    });
    const slot = (right - left) / pts.length;
    const maxChars = Math.max(3, Math.floor(slot / 8));
    const small = pts.length > 5;
    pts.forEach((p, i) => {
      const cx = left + slot * (i + 0.5);
      body += `<text x="${r1(cx)}" y="${bottom + 20}" text-anchor="middle" font-size="${small ? 11 : 14}" fill="${colors.text}">${esc(cut(p.label, maxChars))}</text>`;
    });
    if (c.chart === 'bar') {
      pts.forEach((p, i) => {
        const bw = Math.min(64, slot * 0.66);
        const cx = left + slot * (i + 0.5);
        const y0 = y(Math.max(0, p.value));
        const y1 = y(Math.min(0, p.value));
        body += `<rect x="${r1(cx - bw / 2)}" y="${r1(y0)}" width="${r1(bw)}" height="${r1(Math.max(1, y1 - y0))}" rx="4" fill="${PALETTE[0]}"/>`;
        if (c.showValues)
          body += `<text x="${r1(cx)}" y="${r1(p.value < 0 ? y1 + 15 : y0 - 6)}" text-anchor="middle" font-size="${small ? 11 : 14}" fill="${colors.muted}">${esc(fmt(p.value, c.unit))}</text>`;
      });
    } else {
      const xy = pts.map((p, i) => [left + slot * (i + 0.5), y(p.value)] as const);
      body += `<polyline points="${xy.map(([a, b]) => `${r1(a)},${r1(b)}`).join(' ')}" fill="none" stroke="${PALETTE[0]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
      xy.forEach(([a, b], i) => {
        body += `<circle cx="${r1(a)}" cy="${r1(b)}" r="4.5" fill="${PALETTE[0]}" stroke="${colors.bg ?? 'var(--surface)'}" stroke-width="2"/>`;
        if (c.showValues) body += `<text x="${r1(a)}" y="${r1(b - 11)}" text-anchor="middle" font-size="${small ? 11 : 14}" fill="${colors.muted}" stroke="${colors.bg ?? 'var(--surface)'}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(fmt(pts[i].value, c.unit))}</text>`;
      });
    }
    if (c.unit && !c.showValues) body += `<text x="${left - 8}" y="${top - 4}" text-anchor="end" font-size="14" fill="${colors.muted}">${esc(c.unit)}</text>`;
  }

  const head = title ? `<text x="${W / 2}" y="29" text-anchor="middle" font-size="20" font-weight="700" fill="${colors.text}">${esc(cut(title, 60))}</text>` : '';
  const bg = colors.bg ? `<rect width="${W}" height="${H}" fill="${colors.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${font} role="img" aria-label="${esc(title || 'Diagramm')}">${bg}${head}${body}</svg>`;
}

/** Diagramm als PNG (für die Zwischenablage / andere Apps). */
export async function chartPng(c: Chart, scale = 2): Promise<Blob> {
  const svg = chartSvg(c, PRINT);
  const w = Number(svg.match(/width="(\d+)"/)?.[1] ?? W);
  const h = Number(svg.match(/height="(\d+)"/)?.[1] ?? 360);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erstellt werden.'))), 'image/png'));
}

// ---------- In Text-Dokumenten ----------
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML zum Einbetten in ein Dokument (Inhalt zeichnet renderChartsIn). */
export const chartFigure = (c: Chart) => `<figure class="chart" data-chart="${attr(chartJson(c))}"></figure>`;

/** Alle eingebetteten Diagramme in einem Element zeichnen. copyButton = Knopf zum Kopieren (Ansicht). */
export function renderChartsIn(root: HTMLElement, opts: { editable?: boolean; copyButton?: boolean } = {}) {
  root.querySelectorAll<HTMLElement>('figure.chart').forEach((fig) => {
    const c = parseChart(fig.dataset.chart ?? '');
    fig.innerHTML =
      chartSvg(c) +
      (opts.copyButton
        ? '<button type="button" class="chart-copy" aria-label="Diagramm kopieren" title="Diagramm kopieren"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h10.5v11H9zM15 9V4.5H4.5V15H9"/></svg> Kopieren</button>'
        : '');
    if (opts.editable) fig.contentEditable = 'false';
  });
}

// ---------- Zwischenablage ----------
// Systemzwischenablage: HTML (mit Diagramm-Daten + Bild, für andere Apps), reiner Text und PNG.
// Zusätzlich wird das Diagramm in der App gemerkt, denn manche Handys geben beim Einfügen nur Text weiter.
const CLIP_KEY = 'lernapp-diagramm-kopie';

interface Clip {
  text: string;
  chart: Chart;
  at: number;
}

export const clipText = (c: Chart) => `Diagramm: ${c.title.trim() || CHART_TYPES.find((t) => t.id === c.chart)?.label || 'Diagramm'}`;

/** Zuletzt in der App kopiertes Diagramm (höchstens 1 Tag alt). */
export function lastCopiedChart(): Clip | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null');
    if (!raw || Date.now() - raw.at > 24 * 3600_000) return null;
    return { text: String(raw.text), chart: parseChart(raw.chart), at: raw.at };
  } catch {
    return null;
  }
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

/** Was zum Kopieren vorbereitet wird (vorher erzeugen, damit der Klick sofort kopieren kann). */
export interface Prepared {
  chart: Chart;
  png: Blob | null;
  html: string;
  text: string;
}
export async function prepareCopy(c: Chart): Promise<Prepared> {
  const chart = cleanChart(c);
  let png: Blob | null = null;
  let img = '';
  try {
    png = await chartPng(chart);
    img = `<img src="${await blobToDataUrl(png)}" alt="${attr(clipText(chart))}" width="520">`;
  } catch {
    /* ohne Bild */
  }
  const html = `<figure class="chart" data-chart="${attr(chartJson(chart))}">${img}</figure>`;
  return { chart, png, html, text: clipText(chart) };
}

/** Kopieren (im Klick aufrufen). Gibt false zurück, wenn nur die App-interne Kopie geklappt hat. */
export async function copyChart(p: Prepared): Promise<boolean> {
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify({ text: p.text, chart: p.chart, at: Date.now() }));
  } catch {
    /* privat/voll */
  }
  const html = new Blob([p.html], { type: 'text/html' });
  const text = new Blob([p.text], { type: 'text/plain' });
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const tries: Record<string, Blob>[] = [];
    if (p.png) tries.push({ 'text/html': html, 'text/plain': text, 'image/png': p.png });
    tries.push({ 'text/html': html, 'text/plain': text });
    for (const t of tries) {
      try {
        await navigator.clipboard.write([new ClipboardItem(t)]);
        return true;
      } catch {
        /* nächste Variante */
      }
    }
  }
  // Alter Weg: unsichtbares Element markieren und kopieren.
  try {
    const div = document.createElement('div');
    div.innerHTML = p.html;
    div.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(div);
    const r = document.createRange();
    r.selectNodeContents(div);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    div.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Eingefügte Daten: Diagramm aus der App?
 * 'html' = HTML enthält Diagramm-Daten (normal als HTML einfügen, der Sanitizer behält sie),
 * Chart = nur Text kam an, passt aber zum zuletzt in der App kopierten Diagramm.
 */
export function chartFromPaste(data: DataTransfer): 'html' | Chart | null {
  const html = data.getData('text/html');
  if (html && html.includes('data-chart')) return 'html';
  const text = data.getData('text/plain').trim();
  const clip = lastCopiedChart();
  if (clip && text && text === clip.text) return clip.chart;
  return null;
}
