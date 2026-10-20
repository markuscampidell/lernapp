import { useRef } from 'react';

/**
 * Der Klick direkt nach dem Loslassen kann auf einem anderen Element landen (Layout verschiebt sich).
 * Deshalb werden Klicks kurz (150 ms) nach dem Loslassen des Fingers geschluckt – spätere Tipps nicht.
 */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onUp = () => {
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.addEventListener('click', stop, true);
    window.setTimeout(() => window.removeEventListener('click', stop, true), 150);
  };
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
}

/**
 * Langes Drücken (Handy). Gibt Event-Handler für ein Element zurück.
 * Nach einem langen Druck wird der darauffolgende Klick unterdrückt.
 */
export function useLongPress(onLongPress: (() => void) | undefined, ms = 480) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  if (!onLongPress) return {};

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return; // nur Touch/Stift
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        navigator.vibrate?.(25);
        swallowNextClick();
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // Kein Kontextmenü / keine Textauswahl beim langen Drücken.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}
