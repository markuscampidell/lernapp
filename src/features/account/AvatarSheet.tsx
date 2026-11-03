import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { useLibrary } from '../../state/Library';
import { setAvatar } from '../../cloud/remote';

const BOX = 260;
const OUT = 256;

/** Ausschnitt fürs Profilbild wählen: verschieben (ziehen) und zoomen, dann hochladen. */
export function AvatarSheet({ file, onClose }: { file: File; onClose: () => void }) {
  const { me, profiles, refreshRemote } = useLibrary();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const fail = () => alive && setErr('Dieses Bild kann nicht gelesen werden.');
    const reader = new FileReader();
    reader.onload = () => {
      const el = new Image();
      el.onload = () => alive && setImg(el);
      el.onerror = fail;
      el.src = String(reader.result);
    };
    reader.onerror = fail;
    reader.readAsDataURL(file);
    return () => {
      alive = false;
    };
  }, [file]);

  // Bild füllt den Kreis immer ganz aus.
  const base = img ? BOX / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : BOX;
  const h = img ? img.naturalHeight * base * zoom : BOX;
  const clamp = (p: { x: number; y: number }, ww = w, hh = h) => ({
    x: Math.min(0, Math.max(BOX - ww, p.x)),
    y: Math.min(0, Math.max(BOX - hh, p.y)),
  });
  // Beim Laden mittig ausrichten.
  useEffect(() => {
    if (img) setPos(clamp({ x: (BOX - w) / 2, y: (BOX - h) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  const setZoomAround = (z: number) => {
    // um die Mitte zoomen
    const cx = BOX / 2 - pos.x;
    const cy = BOX / 2 - pos.y;
    const f = z / zoom;
    const nw = w * f;
    const nh = h * f;
    setZoom(z);
    setPos(clamp({ x: BOX / 2 - cx * f, y: BOX / 2 - cy * f }, nw, nh));
  };

  const save = async () => {
    if (!img || !me) return;
    setBusy(true);
    setErr(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUT, OUT);
      const k = OUT / BOX;
      ctx.drawImage(img, pos.x * k, pos.y * k, w * k, h * k);
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erstellt werden.'))), 'image/jpeg', 0.86));
      const old = profiles.find((p) => p.id === me.id)?.avatarPath;
      await setAvatar(me.id, blob, old);
      await refreshRemote();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Profilbild"
      onClose={onClose}
      footer={
        <button className="btn primary grow" onClick={save} disabled={!img || busy}>
          {busy ? 'Speichert …' : 'Als Profilbild verwenden'}
        </button>
      }
    >
      <div className="avatar-crop-wrap">
        <div
          className="avatar-crop"
          style={{ width: BOX, height: BOX }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoomAround(Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))))}
          data-no-swipe
        >
          {img && <img src={img.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
          <span className="avatar-crop-mask" aria-hidden="true" />
        </div>
        <label className="field avatar-zoom">
          <span className="field-label">Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} disabled={!img} />
        </label>
        <p className="muted small center-text">Ziehen zum Verschieben. Alle angemeldeten Personen sehen dein Profilbild – wie deinen Benutzernamen.</p>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </Sheet>
  );
}
