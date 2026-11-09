import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

/** Ausschnitt eines Bildes: Zoom (1 = füllt die Fläche gerade aus), Verschiebung der Bildmitte (px, relativ zur Mitte der Fläche), Drehung in 90°-Schritten, Spiegelung. */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
  rot: number;
  flipX: boolean;
  flipY: boolean;
}

export const NO_CROP: Crop = { zoom: 1, x: 0, y: 0, rot: 0, flipX: false, flipY: false };
export const CROP_BOX = 260;
const MAX_ZOOM = 5;

/** Lädt einen Blob als <img>, damit er gezeichnet werden kann. */
export function useImage(src: Blob | null | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setImg(null);
    setFailed(false);
    if (!src) return;
    let alive = true;
    const url = URL.createObjectURL(src);
    const el = new Image();
    el.onload = () => alive && setImg(el);
    el.onerror = () => alive && setFailed(true);
    el.src = url;
    return () => {
      alive = false;
      // erst später freigeben – das <img> im Zuschneide-Feld nutzt die URL noch
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [src]);
  return { img, failed };
}

/** Pixel pro Bildpixel und angezeigte Größe (nach dem Drehen). */
function measure(img: HTMLImageElement, c: Crop, box: number) {
  const odd = c.rot % 2 === 1;
  const rw = odd ? img.naturalHeight : img.naturalWidth;
  const rh = odd ? img.naturalWidth : img.naturalHeight;
  const s = (box / Math.min(rw, rh)) * c.zoom;
  return { s, dw: rw * s, dh: rh * s };
}

const limitZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));

/** Hält das Bild so, dass die Fläche immer ganz bedeckt ist. */
export function clampCrop(img: HTMLImageElement, c: Crop, box = CROP_BOX): Crop {
  const next = { ...c, zoom: limitZoom(c.zoom) };
  const { dw, dh } = measure(img, next, box);
  const mx = Math.max(0, (dw - box) / 2);
  const my = Math.max(0, (dh - box) / 2);
  return { ...next, x: Math.max(-mx, Math.min(mx, next.x)), y: Math.max(-my, Math.min(my, next.y)) };
}

/** Zoomt so, dass der Punkt (px, py) – relativ zur Mitte der Fläche – an seiner Stelle bleibt. */
function zoomAt(img: HTMLImageElement, c: Crop, z: number, px = 0, py = 0, box = CROP_BOX): Crop {
  const zz = limitZoom(z);
  const f = zz / c.zoom;
  return clampCrop(img, { ...c, zoom: zz, x: px + (c.x - px) * f, y: py + (c.y - py) * f }, box);
}

/** Um 90° drehen (dir 1 = im Uhrzeigersinn). Der Ausschnitt dreht sich mit. */
function rotate(img: HTMLImageElement, c: Crop, dir: 1 | -1): Crop {
  const rot = (c.rot + dir + 4) % 4;
  const [x, y] = dir === 1 ? [-c.y, c.x] : [c.y, -c.x];
  return clampCrop(img, { ...c, rot, x, y });
}

/** Spiegeln, so wie man es auf dem Bildschirm sieht (waagrecht = links/rechts tauschen). */
function flip(img: HTMLImageElement, c: Crop, horizontal: boolean): Crop {
  // Die Spiegelung wirkt vor der Drehung – bei 90°/270° also über die andere Achse.
  const aboutX = horizontal === (c.rot % 2 === 0);
  return clampCrop(img, {
    ...c,
    flipX: aboutX ? !c.flipX : c.flipX,
    flipY: aboutX ? c.flipY : !c.flipY,
    x: horizontal ? -c.x : c.x,
    y: horizontal ? c.y : -c.y,
  });
}

/** Zeichnet den gewählten Ausschnitt als quadratisches JPEG (out × out Pixel). */
export async function renderCrop(img: HTMLImageElement, c: Crop, out: number, box = CROP_BOX): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out, out);
  ctx.imageSmoothingQuality = 'high';
  const k = out / box;
  const { s } = measure(img, c, box);
  const iw = img.naturalWidth * s * k;
  const ih = img.naturalHeight * s * k;
  ctx.translate(out / 2 + c.x * k, out / 2 + c.y * k);
  ctx.rotate((c.rot * Math.PI) / 2);
  ctx.scale(c.flipX ? -1 : 1, c.flipY ? -1 : 1);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erstellt werden.'))), 'image/jpeg', 0.88));
}

interface CropperProps {
  img: HTMLImageElement | null;
  crop: Crop;
  onChange: (c: Crop) => void;
  /** Rund (Profilbild) oder abgerundetes Quadrat (Vorschaubild). */
  round?: boolean;
}

/** Zuschneide-Feld: ziehen zum Verschieben, Mausrad/Zwei-Finger/Regler zum Zoomen, Knöpfe zum Drehen und Spiegeln. */
export function ImageCropper({ img, crop, onChange, round }: CropperProps) {
  const box = CROP_BOX;
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ img, crop, onChange });
  latest.current = { img, crop, onChange };
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // Punkt auf dem Bildschirm → relativ zur Mitte der Fläche
  const local = (cx: number, cy: number) => {
    const r = el.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };

  // Mausrad (nicht passiv, damit das Blatt dabei nicht scrollt)
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const { img, crop, onChange } = latest.current;
      if (!img) return;
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      onChange(zoomAt(img, crop, crop.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev || !img) return;
    if (map.size === 1) {
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });
      onChange(clampCrop(img, { ...crop, x: crop.x + e.clientX - prev.x, y: crop.y + e.clientY - prev.y }));
      return;
    }
    // Zwei Finger: zoomen um die Mitte zwischen den Fingern und gleichzeitig verschieben
    const [a, b] = [...map.entries()].slice(0, 2);
    const other = a[0] === e.pointerId ? b[1] : a[1];
    if (a[0] !== e.pointerId && b[0] !== e.pointerId) return;
    const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y) || 1;
    const midBefore = local((prev.x + other.x) / 2, (prev.y + other.y) / 2);
    const midAfter = local((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const zoomed = zoomAt(img, crop, crop.zoom * (after / before), midBefore.x, midBefore.y);
    onChange(clampCrop(img, { ...zoomed, x: zoomed.x + midAfter.x - midBefore.x, y: zoomed.y + midAfter.y - midBefore.y }));
  };
  const endPointer = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!img) return;
    const step = e.shiftKey ? 30 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      onChange(clampCrop(img, { ...crop, x: crop.x + moves[e.key][0], y: crop.y + moves[e.key][1] }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      onChange(zoomAt(img, crop, crop.zoom * 1.1));
    } else if (e.key === '-') {
      e.preventDefault();
      onChange(zoomAt(img, crop, crop.zoom / 1.1));
    }
  };

  const m = img ? measure(img, crop, box) : null;
  const iw = img && m ? img.naturalWidth * m.s : 0;
  const ih = img && m ? img.naturalHeight * m.s : 0;

  const tools: [IconName, string, () => Crop][] = img
    ? [
        ['rotateLeft', '90° nach links drehen', () => rotate(img, crop, -1)],
        ['rotateRight', '90° nach rechts drehen', () => rotate(img, crop, 1)],
        ['flipH', 'Waagrecht spiegeln', () => flip(img, crop, true)],
        ['flipV', 'Senkrecht spiegeln', () => flip(img, crop, false)],
      ]
    : [];

  return (
    <div className="img-crop-wrap">
      <div
        ref={el}
        className="img-crop"
        style={{ width: box, height: box }}
        tabIndex={0}
        role="application"
        aria-label="Bildausschnitt – mit den Pfeiltasten verschieben, mit + und − zoomen"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* egal – Ziehen klappt trotzdem, solange der Zeiger im Feld bleibt */
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
        data-no-swipe
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            style={{
              width: iw,
              height: ih,
              left: (box - iw) / 2,
              top: (box - ih) / 2,
              transform: `translate(${crop.x}px, ${crop.y}px) rotate(${crop.rot * 90}deg) scale(${crop.flipX ? -1 : 1}, ${crop.flipY ? -1 : 1})`,
            }}
          />
        )}
        <span className={`img-crop-mask${round ? ' round' : ''}`} aria-hidden="true" />
      </div>
      <div className="img-crop-tools">
        {tools.map(([icon, label, run]) => (
          <button key={icon} type="button" className="icon-btn" onClick={() => onChange(run())} aria-label={label} title={label}>
            <Icon name={icon} />
          </button>
        ))}
        {img && (
          <button type="button" className="btn ghost small" onClick={() => onChange(NO_CROP)} disabled={JSON.stringify(crop) === JSON.stringify(NO_CROP)}>
            Zurücksetzen
          </button>
        )}
      </div>
      <label className="field img-crop-zoom">
        <span className="field-label">Größe</span>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => img && onChange(zoomAt(img, crop, Number(e.target.value)))} disabled={!img} />
      </label>
    </div>
  );
}

interface SheetProps {
  source: Blob;
  /** Zuletzt gewählter Ausschnitt desselben Bildes (zum Weiterbearbeiten). */
  initial?: Crop;
  title: string;
  confirmLabel: string;
  /** Kantenlänge des Ergebnisses in Pixeln. */
  out: number;
  round?: boolean;
  note?: string;
  /** Bekommt das zugeschnittene Bild; darf asynchron sein (Fehler werden angezeigt). */
  onDone: (blob: Blob, crop: Crop) => void | Promise<void>;
  onClose: () => void;
  busyLabel?: string;
}

/** Blatt zum Zuschneiden eines Bildes (Verschieben, Zoomen, Drehen, Spiegeln). */
export function ImageCropSheet({ source, initial, title, confirmLabel, out, round, note, onDone, onClose, busyLabel = 'Speichert …' }: SheetProps) {
  const { img, failed } = useImage(source);
  const [crop, setCrop] = useState<Crop>(initial ?? NO_CROP);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    setErr(null);
    try {
      await onDone(await renderCrop(img, crop, out), crop);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button className="btn primary grow" onClick={confirm} disabled={!img || busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <ImageCropper img={img} crop={crop} onChange={setCrop} round={round} />
      <p className="muted small center-text">Ziehen zum Verschieben, mit zwei Fingern oder dem Mausrad zoomen.{note ? ` ${note}` : ''}</p>
      {failed && <p className="notice critical">Dieses Bild kann nicht gelesen werden.</p>}
      {err && <p className="notice critical">{err}</p>}
    </Sheet>
  );
}
