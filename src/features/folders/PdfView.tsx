import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const GAP = 12;
/** Höchstens so viele Bildpunkte pro Seite (sonst wird es am Handy zu langsam / zu viel Speicher). */
const MAX_PIXELS = 16_000_000;

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};

const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

/**
 * Zeigt ein PDF Seite für Seite (pdf.js – funktioniert auch auf Android, wo Browser PDFs nicht einbetten).
 * Eigener Zoom wie bei Text-Dokumenten: zwei Finger, doppelt tippen, Strg+Mausrad oder die Knöpfe unten rechts.
 * Nur die Seiten werden größer – die Knöpfe der App bleiben, wo sie sind. Nach dem Zoomen werden die
 * sichtbaren Seiten in der neuen Größe scharf neu gezeichnet.
 */
export function PdfView({ blob }: { blob: Blob }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error?: string } | null>(null);
  // Breite der Seiten bei „An Breite anpassen“ (CSS-Pixel) und Höhe jeder Seite bei dieser Breite.
  const [fitW, setFitW] = useState(0);
  const [heights, setHeights] = useState<number[]>([]);
  const [s, setS] = useState(1);
  const sRef = useRef(1);
  sRef.current = s;
  const pdf = useRef<PdfDoc | null>(null);
  const canvases = useRef<HTMLCanvasElement[]>([]);
  const renderedAt = useRef<number[]>([]);
  const busy = useRef(new Set<number>());
  // Punkt, der beim Zoomen unter Finger/Maus bleiben soll (Inhalts-Koordinaten + Bildschirmposition).
  const anchor = useRef<{ ux: number; uy: number; px: number; py: number } | null>(null);

  // ---------- Laden ----------
  useEffect(() => {
    let cancelled = false;
    let doc: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        doc = (await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise) as unknown as PdfDoc;
        if (cancelled) return;
        pdf.current = doc;
        // Innenbreite (ohne den Rand von 2 × 16 px)
        const width = Math.min((scroller.current?.clientWidth || 632) - 32, 1100);
        const hs: number[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const base = (await doc.getPage(n)).getViewport({ scale: 1 });
          hs.push((base.height * width) / base.width);
        }
        if (cancelled) return;
        canvases.current = hs.map((_, i) => {
          const c = document.createElement('canvas');
          c.className = 'pdf-page';
          c.setAttribute('aria-label', `Seite ${i + 1}`);
          return c;
        });
        renderedAt.current = hs.map(() => 0);
        setFitW(width);
        setHeights(hs);
        setState({ pages: doc.numPages });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ pages: 0, error: 'Dieses PDF kann hier nicht angezeigt werden. Öffne es mit einer anderen App.' });
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy().catch(() => {});
      pdf.current = null;
      canvases.current.forEach((c) => c.remove());
      canvases.current = [];
    };
  }, [blob]);

  // Leinwände einhängen und auf die Seitengröße bringen.
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el || !fitW) return;
    canvases.current.forEach((c, i) => {
      c.style.width = `${fitW}px`;
      c.style.height = `${heights[i]}px`;
      if (c.parentElement !== el) el.appendChild(c);
    });
  }, [fitW, heights]);

  // ---------- Zeichnen (nur sichtbare Seiten, in der aktuellen Zoomstufe) ----------
  const draw = useCallback(async (i: number, scale: number) => {
    const doc = pdf.current;
    const canvas = canvases.current[i];
    if (!doc || !canvas || busy.current.has(i)) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const h = parseFloat(canvas.style.height) || 1;
    const w = parseFloat(canvas.style.width) || 1;
    const cap = Math.sqrt(MAX_PIXELS / (w * h * ratio * ratio));
    const want = Math.min(scale, cap);
    if (renderedAt.current[i] && Math.abs(renderedAt.current[i] - want) / want < 0.15) return;
    busy.current.add(i);
    try {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: ((w * want) / base.width) * ratio });
      // Erst unsichtbar zeichnen, dann übernehmen – so blinkt die Seite nicht weiß auf.
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(vp.width);
      tmp.height = Math.round(vp.height);
      await page.render({ canvasContext: tmp.getContext('2d')!, viewport: vp }).promise;
      if (pdf.current !== doc) return;
      canvas.width = tmp.width;
      canvas.height = tmp.height;
      canvas.getContext('2d')!.drawImage(tmp, 0, 0);
      renderedAt.current[i] = want;
    } catch (e) {
      console.warn('PDF-Seite konnte nicht gezeichnet werden', e);
    } finally {
      busy.current.delete(i);
    }
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const refresh = useCallback(
    (delay = 200) => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(async () => {
        const sc = scroller.current;
        const sz = sizer.current;
        if (!sc || !sz || !heights.length) return;
        const scale = sRef.current;
        const top = (sc.scrollTop - sz.offsetTop) / scale - sc.clientHeight / scale;
        const bottom = (sc.scrollTop - sz.offsetTop + sc.clientHeight) / scale + sc.clientHeight / scale;
        let y = 0;
        const todo: number[] = [];
        heights.forEach((h, i) => {
          if (y + h >= top && y <= bottom) todo.push(i);
          y += h + GAP;
        });
        for (const i of todo) await draw(i, scale);
      }, delay);
    },
    [heights, draw],
  );
  useEffect(() => {
    refresh(0);
  }, [refresh]);
  useEffect(() => {
    refresh(250);
  }, [s, refresh]);

  // ---------- Zoomen ----------
  /** Zoomt so, dass der Punkt (Bildschirm) unter dem Finger bzw. der Maus bleibt. Ohne Punkt: Bildschirmmitte. */
  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const sc = scroller.current;
    const sz = sizer.current;
    if (!sc || !sz) return;
    const r = sc.getBoundingClientRect();
    const px = (clientX ?? r.left + r.width / 2) - r.left;
    const py = (clientY ?? r.top + r.height / 2) - r.top;
    const cur = sRef.current;
    anchor.current = { ux: (sc.scrollLeft + px - sz.offsetLeft) / cur, uy: (sc.scrollTop + py - sz.offsetTop) / cur, px, py };
    setS(clamp(next));
  }, []);

  // Nach dem Zoomen: Scrollposition so setzen, dass der gemerkte Punkt an seiner Stelle bleibt.
  useLayoutEffect(() => {
    const a = anchor.current;
    const sc = scroller.current;
    const sz = sizer.current;
    if (!a || !sc || !sz) return;
    sc.scrollLeft = sz.offsetLeft + a.ux * s - a.px;
    sc.scrollTop = sz.offsetTop + a.uy * s - a.py;
    anchor.current = null;
  });

  // Zwei Finger, Strg+Mausrad (auch Trackpad), Safari-Gesten, doppelt tippen.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let pinch: { d: number; s: number; ux: number; uy: number } | null = null;
    let lastTap = 0;
    let moved = false;
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const onStart = (e: TouchEvent) => {
      moved = false;
      if (e.touches.length === 2) {
        e.preventDefault();
        const r = sc.getBoundingClientRect();
        const m = mid(e.touches);
        const sz = sizer.current!;
        const cur = sRef.current;
        pinch = { d: dist(e.touches), s: cur, ux: (sc.scrollLeft + m.x - r.left - sz.offsetLeft) / cur, uy: (sc.scrollTop + m.y - r.top - sz.offsetTop) / cur };
      }
    };
    const onMove = (e: TouchEvent) => {
      moved = true;
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      const m = mid(e.touches);
      anchor.current = { ux: pinch.ux, uy: pinch.uy, px: m.x - r.left, py: m.y - r.top };
      const next = clamp((pinch.s * dist(e.touches)) / pinch.d);
      if (Math.abs(next - sRef.current) > 0.001) setS(next);
      else {
        const sz = sizer.current!;
        sc.scrollLeft = sz.offsetLeft + pinch.ux * next - (m.x - r.left);
        sc.scrollTop = sz.offsetTop + pinch.uy * next - (m.y - r.top);
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length || e.changedTouches.length !== 1 || moved) return;
      const now = Date.now();
      const t = e.changedTouches[0];
      if (now - lastTap < 300) {
        e.preventDefault();
        zoomTo(sRef.current > 1.2 ? 1 : 2.5, t.clientX, t.clientY);
        lastTap = 0;
      } else lastTap = now;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(sRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    const stop = (e: Event) => e.preventDefault();
    const onScroll = () => refresh(150);
    sc.addEventListener('touchstart', onStart, { passive: false });
    sc.addEventListener('touchmove', onMove, { passive: false });
    sc.addEventListener('touchend', onEnd, { passive: false });
    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('gesturestart', stop);
    sc.addEventListener('gesturechange', stop);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('touchstart', onStart);
      sc.removeEventListener('touchmove', onMove);
      sc.removeEventListener('touchend', onEnd);
      sc.removeEventListener('wheel', onWheel);
      sc.removeEventListener('gesturestart', stop);
      sc.removeEventListener('gesturechange', stop);
      sc.removeEventListener('scroll', onScroll);
    };
  }, [zoomTo, refresh]);

  const totalH = heights.reduce((a, h) => a + h, 0) + GAP * Math.max(0, heights.length - 1);

  return (
    <div className="pdf-view">
      <div className="pdf-scroll" ref={scroller} onDoubleClick={(e) => zoomTo(sRef.current > 1.2 ? 1 : 2.5, e.clientX, e.clientY)}>
        {state?.error ? (
          <p className="notice">{state.error}</p>
        ) : !state ? (
          <p className="muted">PDF wird geladen …</p>
        ) : (
          <p className="muted small pdf-count">
            {state.pages} Seite{state.pages === 1 ? '' : 'n'}
          </p>
        )}
        <div className="pdf-sizer" ref={sizer} style={{ width: fitW * s, height: totalH * s }}>
          <div className="pdf-stack" ref={stack} style={{ width: fitW, transform: `scale(${s})` }} />
        </div>
      </div>
      {state && !state.error && (
        <div className="zoom-ctl" data-no-swipe>
          <button type="button" className="icon-btn small" onClick={() => zoomTo(sRef.current / 1.25)} aria-label="Verkleinern" title="Verkleinern" disabled={s <= MIN_ZOOM}>
            <Icon name="minus" size={18} />
          </button>
          <button type="button" className="zoom-val" onClick={() => zoomTo(1)} title="An Breite anpassen">
            {Math.round(s * 100)} %
          </button>
          <button type="button" className="icon-btn small" onClick={() => zoomTo(sRef.current * 1.25)} aria-label="Vergrößern" title="Vergrößern" disabled={s >= MAX_ZOOM}>
            <Icon name="plus" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
