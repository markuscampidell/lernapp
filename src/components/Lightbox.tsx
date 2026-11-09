import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { useBackToClose } from '../lib/router';
import { loadBlob } from '../storage/blobs';

export interface LightboxItem {
  /** Sofort anzeigbares Bild (z. B. Vorschau). */
  src: string;
  /** Optional: Blob-ID des großen Originals – wird nachgeladen und ersetzt die Vorschau. */
  fullId?: string;
  alt?: string;
  /** Rund anzeigen (Profilbilder). */
  round?: boolean;
}

// Ein Bild gleichzeitig, von überall aus zu öffnen (ohne Props durchzureichen).
let current: LightboxItem | null = null;
const listeners = new Set<() => void>();
const set = (item: LightboxItem | null) => {
  current = item;
  listeners.forEach((l) => l());
};

/** Bild groß anzeigen. */
export const openLightbox = (item: LightboxItem) => set(item);

/** Einmal in der App eingebunden; zeigt das gerade geöffnete Bild. */
export function LightboxHost() {
  const item = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return item ? <Lightbox key={item.src} item={item} onClose={() => set(null)} /> : null;
}

const MAX = 6;

function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  useBackToClose(onClose);
  const [src, setSrc] = useState(item.src);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const latest = useRef(view);
  latest.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, lastTap: 0, lastX: 0, lastY: 0 });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Großes Original nachladen
  useEffect(() => {
    if (!item.fullId) return;
    let alive = true;
    let url: string | undefined;
    loadBlob(item.fullId)
      .then((b) => {
        if (!alive || !b) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.fullId]);

  // Punkt relativ zur Mitte der Fläche
  const local = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };
  const clamp = (v: { s: number; x: number; y: number }) => {
    const s = Math.min(MAX, Math.max(1, v.s));
    const st = stage.current?.getBoundingClientRect();
    const el = img.current;
    if (!st || !el || s === 1) return { s, x: 0, y: 0 };
    const mx = Math.max(0, (el.offsetWidth * s - st.width) / 2);
    const my = Math.max(0, (el.offsetHeight * s - st.height) / 2);
    return { s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };
  const zoomAt = (v: { s: number; x: number; y: number }, s: number, px: number, py: number) => {
    const ss = Math.min(MAX, Math.max(1, s));
    const f = ss / v.s;
    return clamp({ s: ss, x: px + (v.x - px) * f, y: py + (v.y - py) * f });
  };

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      const v = latest.current;
      setView(zoomAt(v, v.s * Math.exp(-e.deltaY * 0.002), p.x, p.y));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleZoom = (cx: number, cy: number) => {
    const p = local(cx, cy);
    setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(v, 2.5, p.x, p.y)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      stage.current?.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current.moved = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    gesture.current.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    if (map.size === 1) {
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setView((v) => clamp({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
      return;
    }
    const others = [...map.entries()].filter(([id]) => id !== e.pointerId);
    const other = others[0]?.[1];
    if (!other) return;
    const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y) || 1;
    const mb = local((prev.x + other.x) / 2, (prev.y + other.y) / 2);
    const ma = local((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setView((v) => {
      const z = zoomAt(v, v.s * (after / before), mb.x, mb.y);
      return clamp({ ...z, x: z.x + ma.x - mb.x, y: z.y + ma.y - mb.y });
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const map = pointers.current;
    if (!map.has(e.pointerId)) return;
    map.delete(e.pointerId);
    if (map.size > 0) {
      gesture.current.moved = 999; // nach zwei Fingern kein Tippen auswerten
      return;
    }
    const g = gesture.current;
    if (g.moved > 8) return;
    // Tippen: doppelt = zoomen, einmal neben das Bild = schließen
    const now = Date.now();
    if (now - g.lastTap < 320 && Math.hypot(e.clientX - g.lastX, e.clientY - g.lastY) < 30) {
      g.lastTap = 0;
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    g.lastTap = now;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    const onImage = (() => {
      const r = img.current?.getBoundingClientRect();
      return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    })();
    if (!onImage && latest.current.s === 1) setTimeout(() => gesture.current.lastTap === now && onClose(), 330);
  };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.alt || 'Bild'} data-no-swipe>
      <button className="icon-btn lightbox-close" onClick={onClose} aria-label="Schließen" title="Schließen">
        <Icon name="close" />
      </button>
      <div
        ref={stage}
        className="lightbox-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      >
        <img
          ref={img}
          src={src}
          alt={item.alt ?? ''}
          draggable={false}
          className={item.round ? 'round' : undefined}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, cursor: view.s > 1 ? 'grab' : 'zoom-in' }}
          onLoad={() => setView((v) => clamp(v))}
        />
      </div>
    </div>
  );
}
