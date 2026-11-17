import { EMBED_SELECTOR } from './embeds';

/**
 * Klick/Tippen auf eine leere Stelle der Seite (unter dem Text, am Rand, zwischen den Seiten):
 * Cursor in die nächstgelegene Zeile setzen – wie in Word/Google Docs.
 */

// Was als ganzes Stück zählt (nicht hineinschauen)
const ATOMIC = `img, span.math, ${EMBED_SELECTOR}`;

type Hit = { node: Node; rect: DOMRect };

/** Nächste Zeile zum Punkt (x, y) in Bildschirmkoordinaten. Senkrechter Abstand zählt mehr als waagrechter. */
function nearestLine(root: HTMLElement, x: number, y: number): Hit | null {
  let best: Hit | null = null;
  let bestScore = Infinity;
  const consider = (node: Node, r: DOMRect) => {
    if (!r.width && !r.height) return;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 10 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = { node, rect: r };
    }
  };
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      // Inneres von Formeln/Bildern/Einbettungen: nicht hineinschauen (ganzer Teilbaum weg)
      if (n.parentElement && n.parentElement !== root && n.parentElement.closest(ATOMIC)) return NodeFilter.FILTER_REJECT;
      if (n.nodeType === Node.TEXT_NODE) return n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      const el = n as Element;
      if (el.matches(ATOMIC)) return NodeFilter.FILTER_ACCEPT;
      if (el.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) consider(n, r);
      continue;
    }
    const el = n as HTMLElement;
    if (el.tagName === 'BR') {
      // Leere Zeile (<p><br></p>): die Zeile selbst ist das Ziel
      const block = el.parentElement;
      if (block && block !== root && !block.textContent?.trim()) {
        const b = block.getBoundingClientRect();
        const own = el.getBoundingClientRect();
        // Nur der Zeilenanfang zählt (sonst gewönne eine leere Zeile über die ganze Breite immer)
        consider(el, new DOMRect(b.left, own.height ? own.top : b.top, 1, own.height || b.height));
      }
      continue;
    }
    consider(el, el.getBoundingClientRect());
  }
  return best;
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/** Cursor in die Zeile setzen, die (x, y) am nächsten ist, und den Editor fokussieren. */
export function placeCaretNear(root: HTMLElement, x: number, y: number) {
  const sel = window.getSelection();
  if (!sel) return;
  root.focus({ preventScroll: true });
  const range = document.createRange();
  const hit = nearestLine(root, x, y);
  if (!hit) {
    // Leeres Dokument: an den Anfang
    const first = root.querySelector('p, h1, h2, h3, li, blockquote, div') ?? root;
    range.setStart(first, 0);
  } else {
    const r = hit.rect;
    const px = Math.min(Math.max(x, r.left + 1), r.right - 1);
    const py = (r.top + r.bottom) / 2;
    const pos = caretFromPoint(px, py);
    if (pos && root.contains(pos.node) && !(pos.node instanceof Element && pos.node.closest(ATOMIC))) {
      range.setStart(pos.node, pos.offset);
    } else if (hit.node.nodeType === Node.TEXT_NODE) {
      const after = y > r.bottom || x > r.right;
      range.setStart(hit.node, after ? (hit.node.textContent?.length ?? 0) : 0);
    } else if ((hit.node as Element).tagName === 'BR') {
      range.setStartBefore(hit.node);
    } else {
      if (x > r.left + r.width / 2) range.setStartAfter(hit.node);
      else range.setStartBefore(hit.node);
    }
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Leere Stelle der Seite, auf der ein Klick den Cursor setzen soll (nicht Text, Knöpfe, Bilder usw.). */
export function isBlankPageTarget(editor: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target === editor) return true;
  if (editor.contains(target)) return false; // im Text: macht der Browser selbst
  if (target.closest('button, input, textarea, select, a, label, [contenteditable]')) return false;
  return target.matches('.paper, .paged-flow, .paged-stack, .paged-sizer, .paged') || !!target.closest('svg.ink');
}
