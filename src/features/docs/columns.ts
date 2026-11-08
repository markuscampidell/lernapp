// Spalten in Text-Dokumenten: <div class="cols"><div class="col">…Absätze…</div>…</div>
// Jede Spalte ist ein eigener Textfluss (nicht zeilenweise ausgerichtet). Höchstens MAX_COLS Spalten pro Block.

export const MAX_COLS = 4;
export const COLS_SELECTOR = 'div.cols';

const BLOCKS = 'p, h2, h3, ul, ol, blockquote, pre, figure, div';
const emptyBlock = (doc: Document) => {
  const p = doc.createElement('p');
  p.appendChild(doc.createElement('br'));
  return p;
};
export const newCol = (doc: Document) => {
  const col = doc.createElement('div');
  col.className = 'col';
  col.appendChild(emptyBlock(doc));
  return col;
};

/** Hat die Spalte Inhalt (Text, Bild, Formel, Diagramm …)? */
export const colHasContent = (col: Element) => !!col.textContent?.trim() || !!col.querySelector('img, span.math, figure');

/** Cursor an den Anfang des ersten Absatzes in el setzen. */
export function placeCaret(el: Element, atEnd = false) {
  const doc = el.ownerDocument;
  const target = (atEnd ? Array.from(el.querySelectorAll('p, h2, h3, li, blockquote, pre')).pop() : el.querySelector('p, h2, h3, li, blockquote, pre')) ?? el;
  const r = doc.createRange();
  r.selectNodeContents(target);
  r.collapse(!atEnd);
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * Struktur nach dem Bearbeiten reparieren (Browser verschieben beim Tippen/Einfügen gern etwas):
 * nur .col direkt in .cols, keine Spalten in Spalten, keine leeren Spalten/Blöcke, Text in Spalten immer in Absätzen,
 * und nach einem Spalten-Block steht immer noch ein Absatz (sonst kann man darunter nicht weiterschreiben).
 * Gibt true zurück, wenn etwas geändert wurde. Der Cursor bleibt, wo er war.
 */
export function fixColumns(root: HTMLElement): boolean {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  const anchor = sel?.anchorNode ?? null;
  const offset = sel?.anchorOffset ?? 0;
  let changed = false;

  // Spalten in Spalten (z. B. eingefügt) auflösen: Inhalt der inneren Spalten bleibt untereinander stehen.
  for (const inner of Array.from(root.querySelectorAll<HTMLElement>('div.col div.cols'))) {
    const frag = doc.createDocumentFragment();
    inner.querySelectorAll(':scope > div.col').forEach((c) => frag.append(...Array.from(c.childNodes)));
    inner.replaceWith(frag);
    changed = true;
  }
  // Spalte ohne Spalten-Block: Inhalt ausgepackt stehen lassen.
  for (const col of Array.from(root.querySelectorAll<HTMLElement>('div.col'))) {
    if (col.parentElement?.matches(COLS_SELECTOR)) continue;
    col.replaceWith(...Array.from(col.childNodes));
    changed = true;
  }
  for (const box of Array.from(root.querySelectorAll<HTMLElement>(COLS_SELECTOR))) {
    // Alles, was zwischen die Spalten geraten ist, in die Spalte davor (bzw. die erste) verschieben.
    let last: HTMLElement | null = null;
    for (const node of Array.from(box.childNodes)) {
      if (node instanceof HTMLElement && node.matches('div.col')) {
        last = node;
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
        node.remove();
        continue;
      }
      changed = true;
      const target = last ?? (box.querySelector(':scope > div.col') as HTMLElement | null);
      if (target) target.appendChild(node);
      else node.remove();
    }
    const cols = Array.from(box.querySelectorAll<HTMLElement>(':scope > div.col'));
    if (!cols.length) {
      box.remove();
      changed = true;
      continue;
    }
    // Zu viele Spalten (z. B. eingefügt): Rest an die letzte erlaubte anhängen.
    for (const extra of cols.slice(MAX_COLS)) {
      cols[MAX_COLS - 1].append(...Array.from(extra.childNodes));
      extra.remove();
      changed = true;
    }
    for (const col of cols.slice(0, MAX_COLS)) {
      // Text/Inline direkt in der Spalte in Absätze packen (sonst wirken Ausrichtung/Überschrift auf die ganze Spalte).
      let run: HTMLElement | null = null;
      for (const node of Array.from(col.childNodes)) {
        const isBlock = node instanceof HTMLElement && node.matches(BLOCKS);
        if (isBlock || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim() && !run)) {
          run = null;
          continue;
        }
        if (!run) {
          run = doc.createElement('p');
          col.insertBefore(run, node);
        }
        run.appendChild(node);
        changed = true;
      }
      if (!col.querySelector(BLOCKS)) {
        col.replaceChildren(emptyBlock(doc));
        changed = true;
      }
    }
    // Unter dem Block muss man weiterschreiben können.
    if (box.parentElement === root && !box.nextElementSibling) {
      root.appendChild(emptyBlock(doc));
      changed = true;
    }
  }
  if (changed && sel && anchor && root.contains(anchor)) {
    try {
      sel.collapse(anchor, Math.min(offset, anchor.nodeType === Node.TEXT_NODE ? (anchor.textContent ?? '').length : anchor.childNodes.length));
    } catch {
      /* Cursor nicht wiederherstellbar */
    }
  }
  return changed;
}

/** Oberster Block (direktes Kind von root), in dem der Cursor steht. */
function topBlockAtCursor(root: HTMLElement): HTMLElement | null {
  const n = root.ownerDocument.getSelection()?.anchorNode ?? null;
  if (!n || !root.contains(n) || n === root) return null;
  let el: Node | null = n;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof HTMLElement ? el : null;
}

/**
 * Neuen Block mit 2 Spalten an der Cursor-Position einfügen: statt eines leeren Absatzes, sonst darunter.
 * Steht der Cursor schon in Spalten, kommt der neue Block unter diesen. Gibt die erste Spalte zurück.
 */
export function insertColumns(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'cols';
  box.append(newCol(doc), newCol(doc));
  const block = topBlockAtCursor(root);
  const blockEmpty = !!block && block.matches('p, h2, h3') && !block.textContent?.trim() && !block.querySelector('img, span.math, figure');
  if (block && blockEmpty) block.replaceWith(box);
  else if (block) block.after(box);
  else root.appendChild(box);
  // Nur die leere Startzeile eines leeren Dokuments wird ersetzt – sonst bleibt alles stehen.
  fixColumns(root);
  const first = box.querySelector<HTMLElement>(':scope > div.col')!;
  placeCaret(first);
  return first;
}

/** Spalte links oder rechts von col hinzufügen (höchstens MAX_COLS). Gibt die neue Spalte zurück. */
export function addColumn(col: HTMLElement, side: 'left' | 'right'): HTMLElement | null {
  const box = col.parentElement;
  if (!box?.matches(COLS_SELECTOR) || box.querySelectorAll(':scope > div.col').length >= MAX_COLS) return null;
  const fresh = newCol(col.ownerDocument);
  if (side === 'left') col.before(fresh);
  else col.after(fresh);
  placeCaret(fresh);
  return fresh;
}

/** Spalte entfernen; war es die letzte, verschwindet der ganze Block. */
export function removeColumn(col: HTMLElement) {
  const box = col.parentElement;
  const root = box?.parentElement;
  col.remove();
  if (box && !box.querySelector(':scope > div.col')) {
    const next = box.nextElementSibling;
    box.remove();
    if (next) placeCaret(next);
  }
  if (root && !root.firstChild) root.appendChild(emptyBlock(root.ownerDocument));
}

/** Liegt der (zugeklappte) Cursor ganz am Anfang bzw. Ende von el? */
function caretAtEdge(el: Element, edge: 'start' | 'end'): boolean {
  const sel = el.ownerDocument.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode)) return false;
  const r = el.ownerDocument.createRange();
  if (edge === 'start') {
    r.setStart(el, 0);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
  } else {
    r.setStart(sel.anchorNode, sel.anchorOffset);
    r.setEnd(el, el.childNodes.length);
  }
  const frag = r.cloneContents();
  return !frag.textContent && !frag.querySelector('img, span.math, figure');
}

/**
 * Soll ⌫/Entf hier verhindert werden? Sonst würde der Browser Spalten zusammenlegen oder den Absatz unter/über dem
 * Block in eine Spalte ziehen. Spalten löscht man mit dem Knopf über der Spalte.
 */
export function blockColumnMerge(root: HTMLElement, key: 'Backspace' | 'Delete'): boolean {
  const sel = root.ownerDocument.getSelection();
  if (!sel?.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return false;
  const start = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  const col = start?.closest('div.col');
  if (col && root.contains(col)) return caretAtEdge(col, key === 'Backspace' ? 'start' : 'end');
  const block = topBlockAtCursor(root);
  if (!block) return false;
  if (key === 'Backspace') {
    if (!block.previousElementSibling?.matches(COLS_SELECTOR) || !caretAtEdge(block, 'start')) return false;
    // Leerer Absatz direkt unter dem Block (nicht der letzte): einfach entfernen.
    const next = block.nextElementSibling;
    if (next && !colHasContent(block)) {
      block.remove();
      placeCaret(next);
    }
    return true;
  }
  return !!block.nextElementSibling?.matches(COLS_SELECTOR) && caretAtEdge(block, 'end');
}
