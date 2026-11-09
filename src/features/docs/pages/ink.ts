// Handschrift auf den Seiten. Jede Seite hat eigene Striche (in Seiten-Pixeln, 0…PAGE_W × 0…PAGE_H) –
// sie liegen immer über dem Text und haben mit ihm nichts zu tun.
// Gespeichert wird alles im Dokument selbst: <div class="ink-pages" data-ink="{…}"></div> am Ende.
import { newId } from '../../../lib/id';
import { PAGE_H, PAGE_W } from './geometry';

export type Tool = 'pen' | 'hl';
export type PaperKind = 'blank' | 'lined' | 'grid';

export interface Stroke {
  id: string;
  tool: Tool;
  color: string;
  /** Strichbreite in Seiten-Pixeln. */
  size: number;
  /** x, y, Druck (0…1) – hintereinander. */
  pts: number[];
  /** Gerade Linie / Form: ohne Druck, gleich breit gezeichnet. */
  shape?: boolean;
}

export interface InkPage {
  id: string;
  bg: PaperKind;
  /** Papierfarbe (#rrggbb). */
  paper: string;
  strokes: Stroke[];
  /** Automatisch angelegt, weil der Text eine weitere Seite brauchte (fällt wieder weg, wenn leer). */
  auto?: boolean;
}

export const DEFAULT_PAPER = '#ffffff';
export const newPage = (from?: InkPage, auto = false): InkPage => ({ id: newId(), bg: from?.bg ?? 'blank', paper: from?.paper ?? DEFAULT_PAPER, strokes: [], ...(auto ? { auto: true } : {}) });

// ---------- Speichern / Laden ----------
const MAX_PAGES = 400;
const MAX_STROKES = 20000;
const COLOR = /^#[0-9a-f]{6}$/i;

function encodePts(pts: number[]): string {
  const out: string[] = [];
  let px = 0;
  let py = 0;
  let pp = 0;
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const x = Math.round(pts[i] * 2);
    const y = Math.round(pts[i + 1] * 2);
    const p = Math.round(pts[i + 2] * 20);
    out.push((x - px).toString(36), (y - py).toString(36), (p - pp).toString(36));
    px = x;
    py = y;
    pp = p;
  }
  return out.join(' ');
}
function decodePts(d: string): number[] {
  const nums = d.trim().split(/\s+/).map((v) => parseInt(v, 36));
  const pts: number[] = [];
  let x = 0;
  let y = 0;
  let p = 0;
  for (let i = 0; i + 2 < nums.length; i += 3) {
    if (![nums[i], nums[i + 1], nums[i + 2]].every(Number.isFinite)) return [];
    x += nums[i];
    y += nums[i + 1];
    p += nums[i + 2];
    pts.push(x / 2, y / 2, Math.min(1, Math.max(0, p / 20)));
  }
  return pts;
}

interface RawPage {
  id?: unknown;
  bg?: unknown;
  paper?: unknown;
  auto?: unknown;
  s?: { t?: unknown; c?: unknown; w?: unknown; d?: unknown; f?: unknown }[];
}

export function parseInk(json: string | null | undefined): InkPage[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as { pages?: RawPage[] };
    if (!Array.isArray(data.pages)) return [];
    let strokes = 0;
    return data.pages.slice(0, MAX_PAGES).map((r) => ({
      id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : newId(),
      bg: r.bg === 'lined' || r.bg === 'grid' ? r.bg : 'blank',
      paper: typeof r.paper === 'string' && COLOR.test(r.paper) ? r.paper : DEFAULT_PAPER,
      ...(r.auto === 1 ? { auto: true } : {}),
      strokes: (Array.isArray(r.s) ? r.s : [])
        .filter(() => strokes++ < MAX_STROKES)
        .map((s) => ({
          id: newId(),
          tool: (s.t === 'h' ? 'hl' : 'pen') as Tool,
          color: typeof s.c === 'string' && COLOR.test(s.c) ? s.c : '#1c1c1b',
          size: typeof s.w === 'number' && s.w > 0 && s.w < 100 ? s.w : 3,
          pts: typeof s.d === 'string' ? decodePts(s.d) : [],
          ...(s.f === 1 ? { shape: true } : {}),
        }))
        .filter((s) => s.pts.length >= 3),
    }));
  } catch {
    return [];
  }
}

export function serializeInk(pages: InkPage[]): string {
  return JSON.stringify({
    v: 1,
    pages: pages.map((p) => ({
      id: p.id,
      bg: p.bg,
      paper: p.paper,
      ...(p.auto ? { auto: 1 } : {}),
      s: p.strokes.map((s) => ({ t: s.tool === 'hl' ? 'h' : 'p', c: s.color, w: Math.round(s.size * 10) / 10, d: encodePts(s.pts), ...(s.shape ? { f: 1 } : {}) })),
    })),
  });
}

/** Handschrift aus dem gespeicherten Dokument lösen: { html ohne Handschrift, Seiten }. */
export function splitDoc(text: string): { html: string; pages: InkPage[] } {
  if (!text.includes('ink-pages')) return { html: text, pages: [] };
  const doc = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
  let pages: InkPage[] = [];
  doc.body.querySelectorAll('div.ink-pages').forEach((el) => {
    if (!pages.length) pages = parseInk(el.getAttribute('data-ink'));
    el.remove();
  });
  return { html: doc.body.innerHTML, pages };
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Dokument mit Handschrift zusammensetzen. Ganz ohne Seiten-Einstellungen bleibt es reines HTML. */
export function joinDoc(html: string, pages: InkPage[]): string {
  const plain = pages.every((p) => !p.strokes.length && p.bg === 'blank' && p.paper === DEFAULT_PAPER && p.auto);
  if (!pages.length || plain) return html;
  return `${html}<div class="ink-pages" data-ink="${attr(serializeInk(pages))}"></div>`;
}

// ---------- Zeichnen ----------
const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** Geglättete Punkte (x, y, Druck). */
function smooth(pts: number[], amount = 0.45): number[] {
  if (pts.length <= 6) return pts;
  const out = [pts[0], pts[1], pts[2]];
  for (let i = 3; i < pts.length; i += 3) {
    const lx = out[out.length - 3];
    const ly = out[out.length - 2];
    const lp = out[out.length - 1];
    out.push(lx + (pts[i] - lx) * (1 - amount), ly + (pts[i + 1] - ly) * (1 - amount), lp + (pts[i + 2] - lp) * 0.5);
  }
  // Ende genau dort, wo der Stift aufhörte
  out.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

const radius = (s: Stroke, p: number) => (s.shape || s.tool === 'hl' ? s.size / 2 : (s.size / 2) * (0.35 + 1.3 * p));

/** Umriss eines Stift-Strichs (Breite folgt dem Druck) als SVG-Pfad zum Füllen. */
export function outline(s: Stroke): string {
  const pts = smooth(s.pts);
  const n = pts.length / 3;
  if (n === 1 || (n === 2 && pts[0] === pts[3] && pts[1] === pts[4])) {
    const r = radius(s, pts[2]);
    return `M${f(pts[0] - r)} ${f(pts[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  const rs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1) * 3;
    const b = Math.min(n - 1, i + 1) * 3;
    let dx = pts[b] - pts[a];
    let dy = pts[b + 1] - pts[a + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = radius(s, pts[i * 3 + 2]);
    rs.push(r);
    L.push([pts[i * 3] - dy * r, pts[i * 3 + 1] + dx * r]);
    R.push([pts[i * 3] + dy * r, pts[i * 3 + 1] - dx * r]);
  }
  const side = (q: [number, number][]) => {
    let d = '';
    for (let i = 1; i < q.length - 1; i++) {
      const mx = (q[i][0] + q[i + 1][0]) / 2;
      const my = (q[i][1] + q[i + 1][1]) / 2;
      d += `Q${f(q[i][0])} ${f(q[i][1])} ${f(mx)} ${f(my)}`;
    }
    const last = q[q.length - 1];
    return d + `L${f(last[0])} ${f(last[1])}`;
  };
  const rEnd = rs[n - 1];
  const rStart = rs[0];
  const back = [...R].reverse();
  return (
    `M${f(L[0][0])} ${f(L[0][1])}` +
    side(L) +
    `A${f(rEnd)} ${f(rEnd)} 0 0 0 ${f(R[n - 1][0])} ${f(R[n - 1][1])}` +
    side(back) +
    `A${f(rStart)} ${f(rStart)} 0 0 0 ${f(L[0][0])} ${f(L[0][1])}Z`
  );
}

/** Mittellinie (für Textmarker und Formen – gleich breit). */
export function centerline(s: Stroke): string {
  const pts = s.shape ? s.pts : smooth(s.pts);
  if (pts.length === 3) return `M${f(pts[0])} ${f(pts[1])}l0.01 0`;
  let d = `M${f(pts[0])} ${f(pts[1])}`;
  if (s.shape) {
    for (let i = 3; i < pts.length; i += 3) d += `L${f(pts[i])} ${f(pts[i + 1])}`;
    return d;
  }
  for (let i = 3; i < pts.length - 3; i += 3) {
    const mx = (pts[i] + pts[i + 3]) / 2;
    const my = (pts[i + 1] + pts[i + 4]) / 2;
    d += `Q${f(pts[i])} ${f(pts[i + 1])} ${f(mx)} ${f(my)}`;
  }
  return d + `L${f(pts[pts.length - 3])} ${f(pts[pts.length - 2])}`;
}

// ---------- Hilfen: Rahmen, Radieren, Lasso, Formen ----------
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const boxes = new WeakMap<Stroke, Box>();
export function boxOf(s: Stroke): Box {
  let b = boxes.get(s);
  if (b) return b;
  b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < s.pts.length; i += 3) {
    b.x0 = Math.min(b.x0, s.pts[i]);
    b.x1 = Math.max(b.x1, s.pts[i]);
    b.y0 = Math.min(b.y0, s.pts[i + 1]);
    b.y1 = Math.max(b.y1, s.pts[i + 1]);
  }
  const pad = s.size / 2;
  b = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  boxes.set(s, b);
  return b;
}
export function unionBox(list: Stroke[]): Box | null {
  if (!list.length) return null;
  return list.map(boxOf).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
}

/** Abstand Punkt–Strecke. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function hits(s: Stroke, x: number, y: number, r: number): boolean {
  const b = boxOf(s);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const reach = r + s.size / 2;
  const p = s.pts;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let i = 3; i < p.length; i += 3) if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach) return true;
  return false;
}

/** Punkte so ergänzen, dass sie höchstens step auseinanderliegen. */
function densify(p: number[], step: number): number[] {
  const out = [p[0], p[1], p[2]];
  for (let i = 3; i < p.length; i += 3) {
    const d = Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
    const k = Math.ceil(d / step);
    for (let j = 1; j < k; j++) {
      const t = j / k;
      out.push(p[i - 3] + (p[i] - p[i - 3]) * t, p[i - 2] + (p[i + 1] - p[i - 2]) * t, p[i - 1] + (p[i + 2] - p[i - 1]) * t);
    }
    out.push(p[i], p[i + 1], p[i + 2]);
  }
  return out;
}

/**
 * Radieren an (x, y) mit Radius r. whole: ganze Striche entfernen, sonst nur die berührten Stellen.
 * Gibt null zurück, wenn nichts getroffen wurde.
 */
export function eraseAt(strokes: Stroke[], x: number, y: number, r: number, whole: boolean): Stroke[] | null {
  let changed = false;
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (!hits(s, x, y, r)) {
      out.push(s);
      continue;
    }
    changed = true;
    if (whole) continue;
    const reach = r + s.size / 2;
    const p = densify(s.pts, Math.max(1, Math.min(3, s.size / 2)));
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 6) out.push({ ...s, id: newId(), pts: run });
      run = [];
    };
    for (let i = 0; i < p.length; i += 3) {
      if (Math.hypot(p[i] - x, p[i + 1] - y) <= reach) flush();
      else run.push(p[i], p[i + 1], p[i + 2]);
    }
    flush();
  }
  return changed ? out : null;
}

/** Strecke von (ax,ay) nach (bx,by) radiert alles auf dem Weg (schnelle Bewegungen). */
export function eraseAlong(strokes: Stroke[], ax: number, ay: number, bx: number, by: number, r: number, whole: boolean): Stroke[] | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r * 0.7)));
  let cur = strokes;
  let changed = false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const next = eraseAt(cur, ax + (bx - ax) * t, ay + (by - ay) * t, r, whole);
    if (next) {
      cur = next;
      changed = true;
    }
  }
  return changed ? cur : null;
}

function inPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Striche, die (größtenteils) in der Lasso-Fläche liegen. poly: x, y, x, y … */
export function lassoPick(strokes: Stroke[], poly: number[]): string[] {
  if (poly.length < 6) return [];
  return strokes
    .filter((s) => {
      let inside = 0;
      const n = s.pts.length / 3;
      for (let i = 0; i < s.pts.length; i += 3) if (inPolygon(s.pts[i], s.pts[i + 1], poly)) inside++;
      return inside / n >= 0.5;
    })
    .map((s) => s.id);
}

/** Striche verschieben und (um ox, oy) skalieren. */
export function transformStrokes(list: Stroke[], dx: number, dy: number, k = 1, ox = 0, oy = 0): Stroke[] {
  return list.map((s) => {
    const pts = s.pts.slice();
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] = ox + (pts[i] - ox) * k + dx;
      pts[i + 1] = oy + (pts[i + 1] - oy) * k + dy;
    }
    return { ...s, pts, size: Math.max(0.5, s.size * (k === 1 ? 1 : Math.sqrt(k))) };
  });
}

/** Striche innerhalb der Seite halten (nur zur Sicherheit beim Verschieben). */
export const clampToPage = (x: number, y: number) => [Math.min(PAGE_W, Math.max(0, x)), Math.min(PAGE_H, Math.max(0, y))];

/**
 * Formerkennung (Stift kurz halten): gerade Linie, Rechteck, Ellipse/Kreis.
 * Gibt die neuen Punkte zurück oder null, wenn nichts passt.
 */
export function recognize(pts: number[]): number[] | null {
  const n = pts.length / 3;
  if (n < 4) return null;
  let len = 0;
  let pSum = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (i) len += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2]);
    pSum += pts[i + 2];
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  const p = Math.min(1, Math.max(0.2, pSum / n));
  const sx = pts[0];
  const sy = pts[1];
  const ex = pts[pts.length - 3];
  const ey = pts[pts.length - 2];
  const d = Math.hypot(ex - sx, ey - sy);
  // Gerade Linie
  if (d > 16) {
    let dev = 0;
    for (let i = 0; i < pts.length; i += 3) dev = Math.max(dev, segDist(pts[i], pts[i + 1], sx, sy, ex, ey));
    if (dev < Math.max(5, d * 0.07)) return [sx, sy, p, ex, ey, p];
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 14 || h < 14 || d > 0.3 * Math.max(w, h) || len < 1.5 * (w + h)) return null;
  // Rechteck vs. Ellipse
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let errE = 0;
  let errR = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const nx = (pts[i] - cx) / (w / 2);
    const ny = (pts[i + 1] - cy) / (h / 2);
    errE += Math.abs(Math.hypot(nx, ny) - 1);
    errR += Math.min(Math.abs(pts[i] - x0), Math.abs(pts[i] - x1), Math.abs(pts[i + 1] - y0), Math.abs(pts[i + 1] - y1)) / Math.min(w, h);
  }
  errE /= n;
  errR /= n;
  if (errR < 0.07 && errR < errE) return [x0, y0, p, x1, y0, p, x1, y1, p, x0, y1, p, x0, y0, p];
  if (errE < 0.16) {
    let rx = w / 2;
    let ry = h / 2;
    if (Math.max(rx, ry) / Math.min(rx, ry) < 1.15) rx = ry = (rx + ry) / 2; // fast ein Kreis -> Kreis
    const out: number[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, p);
    }
    return out;
  }
  return null;
}
