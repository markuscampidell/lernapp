import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CONTENT_H, CONTENT_W, GAP, MARGIN_X, MARGIN_Y, MAX_ZOOM, MIN_ZOOM, PAGE_H, PAGE_W, PITCH, typesText } from './geometry';
import { paginate } from './paginate';
import { centerline, eraseAlong, lassoPick, outline, recognize, transformStrokes, unionBox, type Box, type InkPage, type Stroke } from './ink';
import { Icon } from '../../../components/Icon';
import { newId } from '../../../lib/id';

export type PenTool = 'pen' | 'hl' | 'eraser' | 'lasso';
export interface PenSettings {
  tool: PenTool;
  color: string;
  size: number;
  hlColor: string;
  hlSize: number;
  eraseWhole: boolean;
  /** Radius des Radierers in Seiten-Pixeln. */
  eraserSize: number;
  /** Was die Taste an der Seite des Stifts tut, solange sie gedrückt ist. */
  sideButton: 'lasso' | 'eraser' | 'off';
}

/** Zeichnen erlaubt – und womit. */
export interface InkInput {
  pen: boolean;
  mouse: boolean;
  touch: boolean;
  settings: PenSettings;
  onChange: (pageIndex: number, strokes: Stroke[]) => void;
}

/** Seiten bearbeiten (Knöpfe zwischen den Seiten). */
export interface PageEditing {
  insert: (at: number) => void;
  remove: (i: number) => void;
  move: (from: number, to: number) => void;
  paper: (i: number) => void;
}

interface Props {
  pages: InkPage[];
  flowRef: RefObject<HTMLElement>;
  children: ReactNode;
  /** Anzahl Seiten, die der Text braucht (nach jeder Änderung). */
  onLayout?: (textPages: number) => void;
  editing?: PageEditing;
  ink?: InkInput;
  /** Unskalierte Inhalte über den Seiten (Lage relativ zu sizerRef). */
  overlay?: ReactNode;
  sizerRef?: RefObject<HTMLDivElement>;
}

const PAD_EDIT = 48; // Platz für die Knöpfe über der ersten / unter der letzten Seite
const PEN_KEY = 'lernapp:stift-erkannt';
const HINT_KEY = 'lernapp:hinweis-zwei-finger';
let penKnown = (() => {
  try {
    return localStorage.getItem(PEN_KEY) === '1';
  } catch {
    return false;
  }
})();
/** Wurde auf diesem Gerät schon mit einem Stift geschrieben? (Dann scrollt der Finger beim Zeichnen.) */
export const penSeen = () => penKnown;
const penListeners = new Set<() => void>();
const markPen = () => {
  if (penKnown) return;
  penKnown = true;
  penListeners.forEach((l) => l());
  try {
    localStorage.setItem(PEN_KEY, '1');
  } catch {
    /* egal */
  }
};

/** Hintergrund eines Blatts (Farbe, Linien, Karos). */
export function paperStyle(p: Pick<InkPage, 'bg' | 'paper'>): React.CSSProperties {
  const hex = p.paper.replace('#', '');
  const lum = (0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16) + 0.114 * parseInt(hex.slice(4, 6), 16)) / 255;
  const line = lum < 0.45 ? 'rgba(255,255,255,0.22)' : 'rgba(70,110,160,0.28)';
  if (p.bg === 'lined')
    return { backgroundColor: p.paper, backgroundImage: `linear-gradient(to bottom, transparent 31px, ${line} 31px, ${line} 32px)`, backgroundSize: '100% 32px', backgroundPosition: `0 ${MARGIN_Y - 1}px` };
  if (p.bg === 'grid')
    return {
      backgroundColor: p.paper,
      backgroundImage: `linear-gradient(to bottom, transparent 19px, ${line} 19px, ${line} 20px), linear-gradient(to right, transparent 19px, ${line} 19px, ${line} 20px)`,
      backgroundSize: '20px 20px',
      backgroundPosition: '-3px -3px',
    };
  return { backgroundColor: p.paper };
}

const StrokePath = memo(function StrokePath({ s }: { s: Stroke }) {
  if (s.tool === 'hl')
    return <path d={centerline(s)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" className="ink-hl" />;
  if (s.shape) return <path d={centerline(s)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" />;
  return <path d={outline(s)} fill={s.color} />;
});

const PageInk = memo(function PageInk({ strokes, hidden }: { strokes: Stroke[]; hidden?: Set<string> }) {
  // Textmarker unter dem Stift
  const hl = strokes.filter((s) => s.tool === 'hl' && !hidden?.has(s.id));
  const pen = strokes.filter((s) => s.tool !== 'hl' && !hidden?.has(s.id));
  return (
    <>
      {hl.length > 0 && (
        <g className="ink-hl-layer">
          {hl.map((s) => (
            <StrokePath key={s.id} s={s} />
          ))}
        </g>
      )}
      {pen.map((s) => (
        <StrokePath key={s.id} s={s} />
      ))}
    </>
  );
});

interface Selection {
  page: number;
  ids: Set<string>;
  box: Box;
  dx: number;
  dy: number;
  k: number;
}

/** Text-Dokument als A4-Seiten: Text fließt über die Seiten, Handschrift liegt darüber, Zoomen und frei scrollen. */
export function PagedDoc({ pages: given, flowRef, children, onLayout, editing, ink, overlay, sizerRef: outerSizer }: Props) {
  const [textPages, setTextPages] = useState(1);
  // Gibt es hier einen Stift? Dann darf der Browser nie selbst scrollen (sonst schiebt der Stift die Seiten
  // statt zu schreiben) – Finger-Scrollen übernimmt die App.
  const [penHere, setPenHere] = useState(penSeen);
  useEffect(() => {
    const on = () => setPenHere(true);
    penListeners.add(on);
    // Stifte, die über dem Bildschirm schweben (Surface, Wacom, S Pen), melden sich schon vor der Berührung
    const hoverPen = (e: PointerEvent) => e.pointerType === 'pen' && markPen();
    window.addEventListener('pointerover', hoverPen, true);
    window.addEventListener('pointermove', hoverPen, true);
    return () => {
      penListeners.delete(on);
      window.removeEventListener('pointerover', hoverPen, true);
      window.removeEventListener('pointermove', hoverPen, true);
    };
  }, []);
  const n = Math.max(1, given.length, textPages);
  const pages: InkPage[] = Array.from({ length: n }, (_, i) => given[i] ?? { id: `leer-${i}`, bg: given[given.length - 1]?.bg ?? 'blank', paper: given[given.length - 1]?.paper ?? '#ffffff', strokes: [] });
  const ownSizer = useRef<HTMLDivElement>(null);
  const sizer = outerSizer ?? ownSizer;
  const stack = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ s: number; fit: boolean }>({ s: 0, fit: true });
  const [fitScale, setFitScale] = useState(1);
  const s = zoom.fit || !zoom.s ? fitScale : zoom.s;
  const pad = editing ? PAD_EDIT : 0;
  const scroller = useRef<HTMLElement | null>(null);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const scaleRef = useRef(s);
  scaleRef.current = s;

  // ---------- Seitenumbruch ----------
  const style = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    const el = document.createElement('style');
    document.head.appendChild(el);
    style.current = el;
    return () => el.remove();
  }, []);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    flow.dataset.flow = newId().slice(0, 8);
    let frame = 0;
    let last = -1;
    const run = () => {
      frame = 0;
      if (!style.current) return;
      const pagesNeeded = paginate(flow, style.current);
      if (pagesNeeded !== last) {
        last = pagesNeeded;
        setTextPages(pagesNeeded);
        onLayoutRef.current?.(pagesNeeded);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    run();
    const ro = new ResizeObserver(schedule);
    ro.observe(flow);
    const mo = new MutationObserver(schedule);
    mo.observe(flow, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'width', 'src', 'data-indent', 'data-display'] });
    flow.addEventListener('load', schedule, true); // Bilder
    return () => {
      ro.disconnect();
      mo.disconnect();
      flow.removeEventListener('load', schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [flowRef]);

  // ---------- Browser-Zoom verhindern (nur solange ein Dokument offen ist) ----------
  // Zoomen soll nur die Seiten vergrößern, nie die ganze App (Werkzeugleiste bleibt sichtbar).
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const before = meta?.getAttribute('content') ?? null;
    if (meta && before) meta.setAttribute('content', `${before.replace(/,\s*(maximum-scale|user-scalable)=[^,]*/g, '')}, maximum-scale=1, user-scalable=no`);
    const sc = (root.current?.closest('.viewer') as HTMLElement | null) ?? null;
    const prevTouch = sc?.style.touchAction ?? '';
    if (sc) sc.style.touchAction = 'pan-x pan-y';
    // Safari (iPhone/iPad) beachtet das nicht immer – dort die Zoom-Geste selbst abfangen.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      if (meta && before !== null) meta.setAttribute('content', before);
      if (sc) sc.style.touchAction = prevTouch;
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);

  // ---------- Zoom ----------
  useLayoutEffect(() => {
    const sc = (root.current?.closest('.viewer-body') as HTMLElement | null) ?? document.scrollingElement as HTMLElement;
    scroller.current = sc;
    const fit = () => {
      const cs = getComputedStyle(sc);
      const avail = sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFitScale(Math.max(MIN_ZOOM, Math.min(1, avail / PAGE_W)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  /** Nach dem Zoomen: dieser Punkt der Seiten (in Seiten-Pixeln) soll unter dieser Bildschirmstelle liegen. */
  const anchor = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const applyAnchor = useCallback(() => {
    const a = anchor.current;
    const st = stack.current;
    const sc = scroller.current;
    if (!a || !st || !sc) return;
    const r = st.getBoundingClientRect();
    const k = r.width / PAGE_W;
    sc.scrollLeft += r.left + a.x * k - a.cx;
    sc.scrollTop += r.top + a.y * k - a.cy;
  }, []);
  useLayoutEffect(() => {
    applyAnchor();
    anchor.current = null;
  }, [s, applyAnchor]);
  const docPoint = (cx: number, cy: number) => {
    const r = stack.current!.getBoundingClientRect();
    const k = r.width / PAGE_W;
    return { x: (cx - r.left) / k, y: (cy - r.top) / k };
  };
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const sc = scroller.current;
    if (!stack.current || !sc) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (cx === undefined || cy === undefined) {
      const r = sc.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    const p = docPoint(cx, cy);
    anchor.current = { ...p, cx, cy };
    setZoom({ s: z, fit: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Strg+Mausrad / Trackpad-Zoom, Safari-Gesten, zwei Finger
  useEffect(() => {
    // Ganzer Dokumentbereich (auch die Ränder neben den Seiten): sonst zoomt dort der Browser selbst –
    // dann wird die ganze App größer und die Werkzeugleiste rutscht aus dem Bild.
    const el = scroller.current ?? sizer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(scaleRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    let gStart = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gStart = scaleRef.current;
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomTo(gStart * g.scale, g.clientX, g.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGesture);
    };
  }, [zoomTo, sizer]);

  // ---------- Zeichnen ----------
  const live = useRef<{ page: number; pts: number[]; pointer: number; tool: PenTool; shape?: boolean; lastX: number; lastY: number; timer?: number } | null>(null);
  const livePath = useRef<SVGPathElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  // Einmaliger Hinweis beim ersten Zeichnen mit dem Finger
  const [hint, setHint] = useState<number | false>(false);
  const showFingerHint = () => {
    try {
      if (localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      return;
    }
    // oben im Dokumentbereich (unten liegen Zoom und die Seitenanzeige)
    setHint((scroller.current?.getBoundingClientRect().top ?? 0) + 12);
  };
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(t);
  }, [hint]);
  const liveSvg = useRef<SVGSVGElement>(null);
  const [erasing, setErasing] = useState<{ page: number; strokes: Stroke[] } | null>(null);
  const erasingRef = useRef(erasing);
  erasingRef.current = erasing;
  const [sel, setSel] = useState<Selection | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const selDrag = useRef<{ mode: 'move' | 'scale'; x: number; y: number; pointer: number } | null>(null);

  useEffect(() => {
    if (ink?.settings.tool !== 'lasso') setSel(null);
  }, [ink?.settings.tool]);
  useEffect(() => {
    if (!ink) setSel(null);
  }, [ink]);

  const toPage = (cx: number, cy: number) => {
    const p = docPoint(cx, cy);
    const page = Math.floor(p.y / PITCH);
    return { page, x: p.x, y: p.y - page * PITCH };
  };

  const drawLive = () => {
    const l = live.current;
    const path = livePath.current;
    const svg = liveSvg.current;
    if (!path || !svg) return;
    // Radierer zeichnet nichts (sonst bliebe am Startpunkt ein Punkt stehen)
    if (!l || l.tool === 'eraser') {
      svg.style.display = 'none';
      path.removeAttribute('d');
      return;
    }
    const set = inkRef.current?.settings;
    svg.style.display = '';
    svg.style.top = `${l.page * PITCH}px`;
    if (l.tool === 'lasso') {
      let d = '';
      for (let i = 0; i < l.pts.length; i += 3) d += `${i ? 'L' : 'M'}${l.pts[i].toFixed(1)} ${l.pts[i + 1].toFixed(1)}`;
      path.setAttribute('d', d + 'Z');
      path.setAttribute('class', 'ink-lasso');
      path.setAttribute('fill', 'rgba(42,120,214,0.06)');
      path.removeAttribute('stroke-width');
      return;
    }
    const stroke: Stroke = { id: 'live', tool: l.tool === 'hl' ? 'hl' : 'pen', color: l.tool === 'hl' ? set?.hlColor ?? '#ffd400' : set?.color ?? '#000', size: l.tool === 'hl' ? set?.hlSize ?? 16 : set?.size ?? 3, pts: l.pts, shape: l.shape };
    if (stroke.tool === 'hl' || stroke.shape) {
      path.setAttribute('d', centerline(stroke));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', String(stroke.size));
      path.setAttribute('class', stroke.tool === 'hl' ? 'ink-hl' : '');
    } else {
      path.setAttribute('d', outline(stroke));
      path.setAttribute('fill', stroke.color);
      path.setAttribute('stroke', 'none');
      path.setAttribute('class', '');
    }
  };

  const finishSelectionMove = () => {
    const cur = selRef.current;
    const i = inkRef.current;
    if (!cur || !i) return;
    if (cur.dx === 0 && cur.dy === 0 && cur.k === 1) return;
    const strokes = pagesRef.current[cur.page]?.strokes ?? [];
    const moved = new Map(transformStrokes(strokes.filter((x) => cur.ids.has(x.id)), cur.dx, cur.dy, cur.k, cur.box.x0, cur.box.y0).map((x) => [x.id, x]));
    i.onChange(
      cur.page,
      strokes.map((x) => moved.get(x.id) ?? x),
    );
    const box = { x0: cur.box.x0 + cur.dx, y0: cur.box.y0 + cur.dy, x1: cur.box.x0 + (cur.box.x1 - cur.box.x0) * cur.k + cur.dx, y1: cur.box.y0 + (cur.box.y1 - cur.box.y0) * cur.k + cur.dy };
    setSel({ ...cur, box, dx: 0, dy: 0, k: 1 });
  };

  useEffect(() => {
    const st = stack.current;
    if (!st) return;
    const pressure = (e: PointerEvent) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5);
    const draws = (e: PointerEvent) => {
      const i = inkRef.current;
      if (!i) return false;
      if (e.pointerType === 'pen') return i.pen;
      if (e.pointerType === 'mouse') return i.mouse && e.button === 0;
      return i.touch && touches.current < 2;
    };
    const eraseRadius = () => Math.max(2, inkRef.current?.settings.eraserSize ?? 12);

    /**
     * Tasten am Stift (Pointer Events): Radierer-Ende = buttons & 32 (button 5), Seitentaste = buttons & 2 (button 2).
     * So melden es Surface Pen, Wacom & Co. unter Windows sowie der S Pen unter Android.
     */
    const penOverride = (e: PointerEvent): PenTool | null => {
      if (e.pointerType !== 'pen') return null;
      if (e.buttons & 32 || e.button === 5) return 'eraser';
      if (e.buttons & 2 || e.button === 2) {
        const side = inkRef.current?.settings.sideButton ?? 'lasso';
        return side === 'off' ? null : side;
      }
      return null;
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'pen') markPen();
      if (!draws(e) || live.current) return;
      const target = e.target as HTMLElement;
      if (target.closest('.ink-sel-ui, button, .cols-overlay, .img-frame')) return;
      const { page, x, y } = toPage(e.clientX, e.clientY);
      if (page < 0 || page >= pagesRef.current.length || y < 0 || y > PAGE_H || x < 0 || x > PAGE_W) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        st.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      const override = penOverride(e);
      const tool = override ?? inkRef.current!.settings.tool;
      // Auswahl vorhanden: hineintippen verschiebt sie (auch mit Stift/Seitentaste), daneben hebt sie auf
      const cur = selRef.current;
      if (cur && tool !== 'eraser') {
        if (cur.page === page && x >= cur.box.x0 - 6 && x <= cur.box.x1 + 6 && y >= cur.box.y0 - 6 && y <= cur.box.y1 + 6) {
          selDrag.current = { mode: 'move', x, y, pointer: e.pointerId };
          return;
        }
        setSel(null);
      }
      if (tool === 'eraser') {
        const base = pagesRef.current[page].strokes;
        const next = eraseAlong(base, x, y, x, y, eraseRadius(), !!inkRef.current?.settings.eraseWhole);
        setErasing({ page, strokes: next ?? base });
      }
      live.current = { page, pts: [x, y, pressure(e)], pointer: e.pointerId, tool, lastX: x, lastY: y };
      if (e.pointerType === 'touch') showFingerHint();
      if (tool === 'pen' || tool === 'hl') armShape();
      drawLive();
    };

    const armShape = () => {
      const l = live.current;
      if (!l) return;
      window.clearTimeout(l.timer);
      l.timer = window.setTimeout(() => {
        const cur = live.current;
        if (!cur || cur.shape || (cur.tool !== 'pen' && cur.tool !== 'hl')) return;
        const shape = recognize(cur.pts);
        if (shape) {
          cur.pts = shape;
          cur.shape = true;
          drawLive();
        }
      }, 600);
    };

    const move = (e: PointerEvent) => {
      const d = selDrag.current;
      if (d && d.pointer === e.pointerId) {
        e.preventDefault();
        const cur = selRef.current;
        if (!cur) return;
        const { x, y } = toPage(e.clientX, e.clientY);
        const py = y + (toPage(e.clientX, e.clientY).page - cur.page) * PITCH;
        if (d.mode === 'move') setSel({ ...cur, dx: x - d.x, dy: py - d.y });
        return;
      }
      const l = live.current;
      if (!l || l.pointer !== e.pointerId) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) {
        const p = docPoint(ev.clientX, ev.clientY);
        const x = p.x;
        const y = p.y - l.page * PITCH;
        if (l.tool === 'eraser') {
          const er = erasingRef.current;
          const base = er && er.page === l.page ? er.strokes : pagesRef.current[l.page].strokes;
          const next = eraseAlong(base, l.lastX, l.lastY, x, y, eraseRadius(), !!inkRef.current?.settings.eraseWhole);
          if (next) {
            erasingRef.current = { page: l.page, strokes: next };
            setErasing(erasingRef.current);
          }
          l.lastX = x;
          l.lastY = y;
          continue;
        }
        if (l.shape) continue; // Form erkannt: bleibt so
        const lx = l.pts[l.pts.length - 3];
        const ly = l.pts[l.pts.length - 2];
        const dist = Math.hypot(x - lx, y - ly);
        if (dist < 0.6) continue;
        l.pts.push(x, y, pressure(ev));
        if (Math.hypot(x - l.lastX, y - l.lastY) > 4) {
          l.lastX = x;
          l.lastY = y;
          armShape();
        }
      }
      drawLive();
    };

    const up = (e: PointerEvent) => {
      const d = selDrag.current;
      if (d && d.pointer === e.pointerId) {
        selDrag.current = null;
        finishSelectionMove();
        return;
      }
      const l = live.current;
      if (!l || l.pointer !== e.pointerId) return;
      window.clearTimeout(l.timer);
      live.current = null;
      drawLive();
      const i = inkRef.current;
      if (!i) return;
      const page = pagesRef.current[l.page];
      if (!page) return;
      if (l.tool === 'eraser') {
        const er = erasingRef.current;
        setErasing(null);
        if (er && er.page === l.page && er.strokes !== page.strokes) i.onChange(l.page, er.strokes);
        return;
      }
      if (l.tool === 'lasso') {
        const ids = lassoPick(page.strokes, l.pts.filter((_, k) => k % 3 !== 2));
        const box = unionBox(page.strokes.filter((x) => ids.includes(x.id)));
        setSel(box ? { page: l.page, ids: new Set(ids), box, dx: 0, dy: 0, k: 1 } : null);
        return;
      }
      if (e.type === 'pointercancel' && l.pts.length < 9) return;
      const set = i.settings;
      const stroke: Stroke = {
        id: newId(),
        tool: l.tool === 'hl' ? 'hl' : 'pen',
        color: l.tool === 'hl' ? set.hlColor : set.color,
        size: l.tool === 'hl' ? set.hlSize : set.size,
        pts: l.pts.map((v) => Math.round(v * 100) / 100),
        ...(l.shape ? { shape: true } : {}),
      };
      i.onChange(l.page, [...page.strokes, stroke]);
    };

    // Wirkungskreis (Radierer bzw. Stiftspitze) unter dem Zeiger anzeigen
    const hover = (e: PointerEvent) => {
      const c = cursor.current;
      const i = inkRef.current;
      if (!c) return;
      const t = (e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5) ? 'eraser' : null) ?? i?.settings.tool;
      const can = !!i && (e.pointerType === 'pen' ? i.pen : e.pointerType === 'mouse' ? i.mouse : i.touch);
      if (!i || !can || (t !== 'eraser' && t !== 'pen' && t !== 'hl') || (e.pointerType === 'touch' && !live.current)) {
        c.style.display = 'none';
        return;
      }
      const { x, y, page } = toPage(e.clientX, e.clientY);
      const r = t === 'eraser' ? eraseRadius() : (t === 'hl' ? i.settings.hlSize : i.settings.size) / 2;
      c.style.display = '';
      c.style.left = `${x - r}px`;
      c.style.top = `${page * PITCH + y - r}px`;
      c.style.width = c.style.height = `${2 * r}px`;
      c.className = `ink-cursor${t === 'eraser' ? ' eraser' : ''}`;
    };
    const leave = () => {
      if (cursor.current) cursor.current.style.display = 'none';
    };
    // Seitentaste = Rechtsklick: kein Kontextmenü über den Seiten beim Zeichnen
    const noMenu = (e: Event) => {
      if (inkRef.current) e.preventDefault();
    };
    st.addEventListener('contextmenu', noMenu);
    st.addEventListener('pointermove', hover);
    st.addEventListener('pointerleave', leave);
    st.addEventListener('pointerdown', down, true);
    st.addEventListener('pointermove', move);
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    return () => {
      st.removeEventListener('contextmenu', noMenu);
      st.removeEventListener('pointermove', hover);
      st.removeEventListener('pointerleave', leave);
      st.removeEventListener('pointerdown', down, true);
      st.removeEventListener('pointermove', move);
      st.removeEventListener('pointerup', up);
      st.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Finger: zwei Finger zoomen/scrollen; beim Zeichnen ein Finger scrollen; lange halten = Seite verschieben ----------
  const touches = useRef(0);
  const [drag, setDrag] = useState<{ from: number; y: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const slotOf = (clientY: number) => {
    const p = docPoint(0, clientY);
    return Math.max(0, Math.min(pagesRef.current.length, Math.round(p.y / PITCH)));
  };
  const dropDrag = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const slot = slotOf(d.y);
    const to = slot > d.from ? slot - 1 : slot;
    if (to !== d.from) editingRef.current?.move(d.from, to);
  };
  const autoScroll = (clientY: number) => {
    const sc = scroller.current;
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (clientY < r.top + 70) sc.scrollTop -= 14;
    else if (clientY > r.bottom - 70) sc.scrollTop += 14;
  };

  useEffect(() => {
    // Ganzer Dokumentbereich (auch die Ränder neben den Seiten): sonst zoomt dort der Browser selbst –
    // dann wird die ganze App größer und die Werkzeugleiste rutscht aus dem Bild.
    const el = scroller.current ?? sizer.current;
    if (!el) return;
    let pinch: { d: number; s: number; x: number; y: number } | null = null;
    let one: { x: number; y: number; id: number; timer: number; moved: boolean } | null = null;
    // Schwung beim Scrollen mit einem Finger (wie beim normalen Scrollen: gleitet nach dem Loslassen aus)
    let vel = { x: 0, y: 0, t: 0 };
    let glide = 0;
    const stopGlide = () => {
      if (glide) cancelAnimationFrame(glide);
      glide = 0;
    };
    const startGlide = () => {
      stopGlide();
      if (performance.now() - vel.t > 80) return; // vor dem Loslassen angehalten
      let { x: vx, y: vy } = vel; // px pro ms
      let last = performance.now();
      const step = (now: number) => {
        const sc = scroller.current;
        const dt = Math.min(40, now - last);
        last = now;
        if (!sc) return;
        sc.scrollLeft -= vx * dt;
        sc.scrollTop -= vy * dt;
        const k = Math.pow(0.995, dt);
        vx *= k;
        vy *= k;
        glide = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
      };
      glide = requestAnimationFrame(step);
    };
    const fingerScrolls = () => {
      const i = inkRef.current;
      // Finger scrollt selbst (touch-action: none), wenn er nicht zeichnet: im Zeichnen-Modus, oder überall, sobald es einen Stift gibt
      return !!i && !i.touch && (i.mouse || penKnown);
    };
    const start = (e: TouchEvent) => {
      touches.current = e.touches.length;
      stopGlide();
      // Stift (iPad/Android): nicht scrollen, sondern zeichnen
      if (Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')) {
        if (inkRef.current?.pen) e.preventDefault();
        return;
      }
      if (e.touches.length === 2) {
        // laufenden Strich (mit dem ersten Finger) verwerfen
        if (live.current && live.current.tool !== 'eraser') {
          live.current = null;
          drawLive();
        }
        if (one) window.clearTimeout(one.timer);
        one = null;
        const [a, b] = [e.touches[0], e.touches[1]];
        const x = (a.clientX + b.clientX) / 2;
        const y = (a.clientY + b.clientY) / 2;
        const p = docPoint(x, y);
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s: scaleRef.current, x: p.x, y: p.y };
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length === 1 && (fingerScrolls() || !inkRef.current) && editingRef.current) {
        const t = e.touches[0];
        const id = t.identifier;
        one = {
          x: t.clientX,
          y: t.clientY,
          id,
          moved: false,
          timer: window.setTimeout(() => {
            if (!one || one.moved || one.id !== id) return;
            const { page, y: py } = toPage(one.x, one.y);
            if (page < 0 || page >= pagesRef.current.length || py > PAGE_H) return;
            navigator.vibrate?.(15);
            setDrag({ from: page, y: one.y });
          }, 500),
        };
      } else if (e.touches.length === 1 && fingerScrolls()) {
        const t = e.touches[0];
        one = { x: t.clientX, y: t.clientY, id: t.identifier, moved: false, timer: 0 };
      }
    };
    const moveT = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pinch.s * d) / pinch.d));
        anchor.current = { x: pinch.x, y: pinch.y, cx, cy };
        if (Math.abs(next - scaleRef.current) > 0.001) setZoom({ s: next, fit: false });
        else applyAnchor();
        return;
      }
      if (dragRef.current && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        const y = e.touches[0].clientY;
        setDrag({ ...dragRef.current, y });
        autoScroll(y);
        return;
      }
      if (one && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - one.x, t.clientY - one.y) > 8) one.moved = true;
        if (fingerScrolls() && one.moved) {
          if (e.cancelable) e.preventDefault();
          const sc = scroller.current;
          if (sc) {
            sc.scrollLeft -= t.clientX - one.x;
            sc.scrollTop -= t.clientY - one.y;
          }
          const now = performance.now();
          const dt = Math.max(1, now - vel.t);
          const a = vel.t && dt < 100 ? 0.7 : 0; // geglättete Geschwindigkeit
          vel = { x: a * vel.x + (1 - a) * ((t.clientX - one.x) / dt), y: a * vel.y + (1 - a) * ((t.clientY - one.y) / dt), t: now };
          one.x = t.clientX;
          one.y = t.clientY;
        }
      }
    };
    const end = (e: TouchEvent) => {
      touches.current = e.touches.length;
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) {
        if (one) window.clearTimeout(one.timer);
        if (one?.moved && fingerScrolls() && !dragRef.current) startGlide();
        vel = { x: 0, y: 0, t: 0 };
        one = null;
        if (dragRef.current) dropDrag();
      }
    };
    el.addEventListener('touchstart', start, { passive: false });
    // Tippen/Klicken irgendwo hält das Gleiten an
    const stopOnDown = () => stopGlide();
    el.addEventListener('pointerdown', stopOnDown, true);
    el.addEventListener('touchmove', moveT, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      stopGlide();
      el.removeEventListener('pointerdown', stopOnDown, true);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', moveT);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizer, applyAnchor]);

  // Seite am Griff ziehen (Maus/Finger/Stift)
  const gripDown = (from: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    let started = false;
    const mv = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 5) return;
      started = true;
      setDrag({ from, y: ev.clientY });
      autoScroll(ev.clientY);
    };
    const upH = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', upH);
      el.removeEventListener('pointercancel', upH);
      if (started) dropDrag();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', upH);
    el.addEventListener('pointercancel', upH);
  };

  // ---------- Lasso-Auswahl ----------
  const selStrokes = sel ? (pages[sel.page]?.strokes ?? []).filter((x) => sel.ids.has(x.id)) : [];
  const deleteSel = () => {
    if (!sel || !ink) return;
    ink.onChange(
      sel.page,
      pages[sel.page].strokes.filter((x) => !sel.ids.has(x.id)),
    );
    setSel(null);
  };
  // Entf / ⌫ löscht die Lasso-Auswahl (nicht in Eingabefeldern)
  const deleteSelRef = useRef(deleteSel);
  deleteSelRef.current = deleteSel;
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      if (typesText(t)) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel]);
  const duplicateSel = () => {
    if (!sel || !ink) return;
    const copies = transformStrokes(selStrokes, 24, 24).map((x) => ({ ...x, id: newId() }));
    ink.onChange(sel.page, [...pages[sel.page].strokes, ...copies]);
    setSel({ page: sel.page, ids: new Set(copies.map((c) => c.id)), box: { x0: sel.box.x0 + 24, y0: sel.box.y0 + 24, x1: sel.box.x1 + 24, y1: sel.box.y1 + 24 }, dx: 0, dy: 0, k: 1 });
  };
  const recolorSel = () => {
    if (!sel || !ink) return;
    ink.onChange(
      sel.page,
      pages[sel.page].strokes.map((x) => (sel.ids.has(x.id) ? { ...x, color: x.tool === 'hl' ? ink.settings.hlColor : ink.settings.color } : x)),
    );
  };
  const scaleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = selRef.current;
    if (!cur) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const w = Math.max(10, cur.box.x1 - cur.box.x0);
    const h = Math.max(10, cur.box.y1 - cur.box.y0);
    const mv = (ev: PointerEvent) => {
      const c = selRef.current;
      if (!c) return;
      const { x, y, page } = toPage(ev.clientX, ev.clientY);
      const py = y + (page - c.page) * PITCH;
      const k = Math.max(0.15, Math.min(8, Math.max((x - c.box.x0) / w, (py - c.box.y0) / h)));
      setSel({ ...c, k });
    };
    const upS = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', upS);
      el.removeEventListener('pointercancel', upS);
      finishSelectionMove();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', upS);
    el.addEventListener('pointercancel', upS);
  };

  // ---------- Darstellung ----------
  const totalH = n * PITCH - GAP;
  const drawingWithFinger = !!ink && ink.touch;
  const fingerOwnScroll = !!ink && !ink.touch && (ink.mouse || (ink.pen && penHere));
  const touchAction = drawingWithFinger || fingerOwnScroll ? 'none' : 'pan-x pan-y';
  const dragSlot = drag ? slotOf(drag.y) : -1;
  const gapPx = GAP * s;

  return (
    <div className={`paged${ink ? ' inking' : ''}${ink?.settings.tool === 'eraser' ? ' erasing' : ''}`} ref={root} data-no-swipe>
      <div className="paged-sizer" ref={sizer} style={{ width: PAGE_W * s, height: pad * 2 + totalH * s, touchAction }}>
        <div className="paged-stack" ref={stack} style={{ width: PAGE_W, height: totalH, top: pad, transform: `scale(${s})` }}>
          {pages.map((p, i) => (
            <div key={p.id} className={`paper${drag?.from === i ? ' dragging' : ''}`} style={{ top: i * PITCH, ...paperStyle(p) }} />
          ))}
          <div className="paged-flow paper-scope" style={{ left: MARGIN_X, top: MARGIN_Y, width: CONTENT_W, minHeight: CONTENT_H }}>
            {children}
          </div>
          {pages.map((p, i) => (
            <svg key={p.id} className="ink" style={{ top: i * PITCH }} width={PAGE_W} height={PAGE_H} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}>
              <PageInk strokes={erasing?.page === i ? erasing.strokes : p.strokes} hidden={sel?.page === i && (sel.dx || sel.dy || sel.k !== 1) ? sel.ids : undefined} />
              {sel?.page === i && (
                <>
                  {(sel.dx || sel.dy || sel.k !== 1) && (
                    <g transform={`translate(${sel.dx + sel.box.x0} ${sel.dy + sel.box.y0}) scale(${sel.k}) translate(${-sel.box.x0} ${-sel.box.y0})`}>
                      <PageInk strokes={selStrokes} />
                    </g>
                  )}
                  <rect
                    className="ink-sel-box"
                    x={sel.box.x0 + sel.dx - 4}
                    y={sel.box.y0 + sel.dy - 4}
                    width={(sel.box.x1 - sel.box.x0) * sel.k + 8}
                    height={(sel.box.y1 - sel.box.y0) * sel.k + 8}
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
          ))}
          <svg ref={liveSvg} className="ink ink-live" style={{ display: 'none' }} width={PAGE_W} height={PAGE_H} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}>
            <path ref={livePath} vectorEffect="non-scaling-stroke" />
          </svg>
          {ink && <div ref={cursor} className="ink-cursor" style={{ display: 'none' }} />}
          {drag && <div className="page-drop-line" style={{ top: dragSlot * PITCH - GAP / 2 - 2 }} />}
        </div>
        {sel && ink && (
          <div
            className="ink-sel-ui"
            style={{
              left: Math.max(4, (sel.box.x0 + sel.dx) * s),
              top: pad + (sel.page * PITCH + sel.box.y0 + sel.dy) * s - 46,
            }}
          >
            <button type="button" className="icon-btn small" onClick={recolorSel} title="Aktuelle Farbe übernehmen" aria-label="Aktuelle Farbe übernehmen">
              <span className="swatch-dot" style={{ background: ink.settings.color }} />
            </button>
            <button type="button" className="icon-btn small" onClick={duplicateSel} title="Duplizieren" aria-label="Duplizieren">
              <Icon name="copy" size={17} />
            </button>
            <button type="button" className="icon-btn small danger" onClick={deleteSel} title="Löschen" aria-label="Löschen">
              <Icon name="trash" size={17} />
            </button>
          </div>
        )}
        {sel && ink && (
          <span
            className="ink-sel-ui ink-scale"
            title="Größe ändern"
            onPointerDown={scaleDown}
            style={{ left: (sel.box.x0 + sel.dx + (sel.box.x1 - sel.box.x0) * sel.k) * s - 2, top: pad + (sel.page * PITCH + sel.box.y0 + sel.dy + (sel.box.y1 - sel.box.y0) * sel.k) * s - 2 }}
          />
        )}
        {editing && (
          <>
            <div className="page-bar first" style={{ top: pad / 2 - 16 }}>
              <button type="button" className="btn ghost small" onClick={() => editing.insert(0)}>
                <Icon name="plus" size={16} /> Neue Seite
              </button>
            </div>
            {pages.map((p, i) => (
              <div key={p.id} className="page-bar" style={{ top: pad + (i * PITCH + PAGE_H) * s + Math.max(0, (gapPx - 32) / 2) + (i === n - 1 ? 8 : 0) }}>
                <button type="button" className="page-grip" onPointerDown={gripDown(i)} title="Ziehen zum Verschieben" aria-label={`Seite ${i + 1} verschieben`}>
                  <Icon name="grip" size={16} /> {i + 1}
                </button>
                <button type="button" className="icon-btn small" onClick={() => editing.insert(i + 1)} title="Neue Seite danach" aria-label="Neue Seite danach">
                  <Icon name="plus" size={17} />
                </button>
                <button type="button" className="icon-btn small" onClick={() => editing.paper(i)} title="Hintergrund" aria-label="Hintergrund">
                  <Icon name="palette" size={17} />
                </button>
                <button type="button" className="icon-btn small danger" onClick={() => editing.remove(i)} title="Seite löschen" aria-label={`Seite ${i + 1} löschen`}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </>
        )}
        {overlay}
      </div>
      {hint && (
        <div className="finger-hint" role="status" data-no-swipe style={{ top: hint }}>
          <Icon name="info" size={18} />
          <span>Mit einem Finger zeichnest du. Zum Scrollen und Zoomen zwei Finger benutzen.</span>
          <button type="button" className="icon-btn small" onClick={() => setHint(false)} aria-label="Hinweis schließen">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {n > 1 && <PageScrubber count={n} scroller={scroller} stack={stack} />}
      <div className="zoom-ctl" data-no-swipe>
        <button type="button" className="icon-btn small" onClick={() => zoomTo(s / 1.25)} aria-label="Verkleinern" title="Verkleinern">
          <Icon name="minus" size={17} />
        </button>
        <button type="button" className="zoom-val" onClick={() => setZoom({ s: 0, fit: true })} title="An Breite anpassen">
          {Math.round(s * 100)} %
        </button>
        <button type="button" className="icon-btn small" onClick={() => zoomTo(s * 1.25)} aria-label="Vergrößern" title="Vergrößern">
          <Icon name="plus" size={17} />
        </button>
      </div>
    </div>
  );
}

/** Seitenanzeige am rechten Rand ("3 / 8"): ziehen, um schnell zu einer Seite zu springen. */
function PageScrubber({ count, scroller, stack }: { count: number; scroller: RefObject<HTMLElement | null>; stack: RefObject<HTMLDivElement> }) {
  const [state, setState] = useState({ page: 1, frac: 0, top: 0, height: 0, right: 4, visible: false });
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef(0);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let frame = 0;
    const measure = (show: boolean) => {
      frame = 0;
      const st = stack.current;
      if (!st) return;
      const r = sc.getBoundingClientRect();
      const sr = st.getBoundingClientRect();
      const k = sr.width / PAGE_W || 1;
      const mid = (r.top + r.height / 2 - sr.top) / k;
      const page = Math.max(1, Math.min(count, Math.floor(mid / PITCH) + 1));
      const max = sc.scrollHeight - sc.clientHeight;
      const frac = max > 0 ? sc.scrollTop / max : 0;
      // rechts neben der Scrollleiste des Browsers (falls es eine gibt)
      const right = Math.max(4, window.innerWidth - (r.left + sc.clientWidth) + 4);
      setState((cur) => ({ page, frac, top: r.top + 12, height: Math.max(80, r.height - 96), right, visible: show || cur.visible }));
      if (show) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setState((cur) => ({ ...cur, visible: false })), 1600);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => measure(true));
    };
    measure(false);
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer.current);
    };
  }, [scroller, stack, count]);

  const THUMB = 34;
  const jump = (clientY: number) => {
    const sc = scroller.current;
    if (!sc) return;
    const frac = Math.max(0, Math.min(1, (clientY - state.top - THUMB / 2) / Math.max(1, state.height - THUMB)));
    sc.scrollTop = frac * (sc.scrollHeight - sc.clientHeight);
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    setDragging(true);
    jump(e.clientY);
    const move = (ev: PointerEvent) => jump(ev.clientY);
    const up = () => {
      setDragging(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  if (!state.height) return null;
  const y = state.frac * (state.height - THUMB);
  return (
    <div
      className={`page-scrubber${state.visible || dragging ? ' show' : ''}${dragging ? ' dragging' : ''}`}
      style={{ top: state.top, height: state.height, right: state.right }}
      data-no-swipe
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={state.page}
      aria-label="Seite wählen"
    >
      <span className="page-scrubber-thumb" style={{ transform: `translateY(${y}px)` }} onPointerDown={onDown}>
        {state.page} / {count}
      </span>
    </div>
  );
}
