// Spalten & Zeilen in Text-Dokumenten (wie eine Tabelle ohne feste Linien):
//   <div class="cols">
//     <div class="row"><div class="col">…Absätze…</div><div class="col">…</div></div>
//     <div class="row">…</div>
//   </div>
// Alle Zeilen haben gleich viele Spalten (höchstens MAX_COLS). Ältere Dokumente ohne <div class="row">
// (Spalten direkt im Block) gelten als eine einzige Zeile.

export const MAX_COLS = 4;
export const COLS_SELECTOR = 'div.cols';

const BLOCKS = 'p, h2, h3, ul, ol, blockquote, pre, figure, div';
const LINES = 'p, li, h2, h3, blockquote, pre';

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
const newRow = (doc: Document, n: number) => {
  const row = doc.createElement('div');
  row.className = 'row';
  for (let i = 0; i < n; i++) row.appendChild(newCol(doc));
  return row;
};

export const rowsOf = (box: Element) => Array.from(box.querySelectorAll<HTMLElement>(':scope > div.row'));
export const cellsOf = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>(':scope > div.col'));
/** Zellen der Spalte i (in allen Zeilen). */
export const columnCells = (box: Element, i: number) => rowsOf(box).map((r) => cellsOf(r)[i]).filter(Boolean);
export const columnCount = (box: Element) => cellsOf(rowsOf(box)[0] ?? box).length;

/** Hat die Zelle/Zeile Inhalt (Text, Bild, Formel, Diagramm …)? */
export const hasContent = (el: Element) => !!el.textContent?.trim() || !!el.querySelector('img, span.math, figure');

/** Cursor an den Anfang (bzw. ans Ende) des ersten (letzten) Absatzes in el setzen. */
export function placeCaret(el: Element, atEnd = false) {
  const doc = el.ownerDocument;
  const target = (atEnd ? Array.from(el.querySelectorAll(LINES)).pop() : el.querySelector(LINES)) ?? el;
  const r = doc.createRange();
  r.selectNodeContents(target);
  r.collapse(!atEnd);
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** Text/Inline direkt in der Zelle in Absätze packen; leere Zelle bekommt eine leere Zeile. */
function fixCell(col: HTMLElement): boolean {
  const doc = col.ownerDocument;
  let changed = false;
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
  return changed;
}

/**
 * Struktur nach dem Bearbeiten reparieren (Browser verschieben beim Tippen/Einfügen gern etwas):
 * Block → Zeilen → Zellen, alle Zeilen gleich viele Spalten, keine Blöcke in Zellen, Text in Zellen immer in Absätzen,
 * und nach einem Block steht immer noch ein Absatz (sonst kann man darunter nicht weiterschreiben).
 * Gibt true zurück, wenn etwas geändert wurde. Der Cursor bleibt, wo er war.
 */
export function fixColumns(root: HTMLElement): boolean {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  const anchor = sel?.anchorNode ?? null;
  const offset = sel?.anchorOffset ?? 0;
  let changed = false;

  // Blöcke in Zellen (z. B. eingefügt) auflösen: Inhalt der inneren Zellen bleibt untereinander stehen.
  for (const inner of Array.from(root.querySelectorAll<HTMLElement>('div.col div.cols'))) {
    const frag = doc.createDocumentFragment();
    inner.querySelectorAll('div.col').forEach((c) => frag.append(...Array.from(c.childNodes)));
    inner.replaceWith(frag);
    changed = true;
  }
  for (const box of Array.from(root.querySelectorAll<HTMLElement>(COLS_SELECTOR))) {
    // Ältere Form (Zellen direkt im Block) und alles, was zwischen die Zeilen geraten ist, in Zeilen ordnen.
    let lastRow: HTMLElement | null = null;
    for (const node of Array.from(box.childNodes)) {
      if (node instanceof HTMLElement && node.matches('div.row')) {
        lastRow = node;
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
        node.remove();
        continue;
      }
      changed = true;
      if (node instanceof HTMLElement && node.matches('div.col')) {
        // Aufeinanderfolgende lose Zellen bilden eine Zeile.
        if (!lastRow || lastRow.dataset.loose !== '1') {
          lastRow = doc.createElement('div');
          lastRow.className = 'row';
          lastRow.dataset.loose = '1';
          box.insertBefore(lastRow, node);
        }
        lastRow.appendChild(node);
        continue;
      }
      // Sonstiges: in die letzte Zelle der Zeile davor (bzw. die erste Zelle überhaupt).
      const target = (lastRow && cellsOf(lastRow).pop()) ?? box.querySelector<HTMLElement>('div.col');
      if (target) target.appendChild(node);
      else node.remove();
    }
    box.querySelectorAll<HTMLElement>(':scope > div.row[data-loose]').forEach((r) => delete r.dataset.loose);

    const rows = rowsOf(box);
    for (const row of rows) {
      // Nicht-Zellen in einer Zeile in die Zelle davor.
      let lastCell: HTMLElement | null = null;
      for (const node of Array.from(row.childNodes)) {
        if (node instanceof HTMLElement && node.matches('div.col')) {
          lastCell = node;
          continue;
        }
        if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
          node.remove();
          continue;
        }
        changed = true;
        const target = lastCell ?? row.querySelector<HTMLElement>(':scope > div.col');
        if (target) target.appendChild(node);
        else node.remove();
      }
      if (!cellsOf(row).length) {
        row.remove();
        changed = true;
      }
    }
    const kept = rowsOf(box);
    if (!kept.length) {
      box.remove();
      changed = true;
      continue;
    }
    // Alle Zeilen gleich viele Spalten (die meisten, höchstens MAX_COLS).
    const n = Math.min(MAX_COLS, Math.max(...kept.map((r) => cellsOf(r).length)));
    for (const row of kept) {
      const cells = cellsOf(row);
      for (const extra of cells.slice(n)) {
        cells[n - 1].append(...Array.from(extra.childNodes));
        extra.remove();
        changed = true;
      }
      for (let i = cells.length; i < n; i++) {
        row.appendChild(newCol(doc));
        changed = true;
      }
      for (const cell of cellsOf(row)) if (fixCell(cell)) changed = true;
    }
    // Unter dem Block muss man weiterschreiben können.
    if (box.parentElement === root && !box.nextElementSibling) {
      root.appendChild(emptyBlock(doc));
      changed = true;
    }
  }
  // Zeilen/Zellen außerhalb eines Blocks: Inhalt ausgepackt stehen lassen.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('div.row, div.col'))) {
    if (el.closest(COLS_SELECTOR)) continue;
    el.replaceWith(...Array.from(el.childNodes));
    changed = true;
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
 * Neuen Block (1 Zeile, 2 Spalten) an der Cursor-Position einfügen: statt eines leeren Absatzes, sonst darunter.
 * Steht der Cursor schon in einem Block, kommt der neue Block unter diesen.
 */
export function insertColumns(root: HTMLElement) {
  const doc = root.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'cols';
  box.appendChild(newRow(doc, 2));
  const block = topBlockAtCursor(root);
  const blockEmpty = !!block && block.matches('p, h2, h3') && !hasContent(block);
  if (block && blockEmpty) block.replaceWith(box);
  else if (block) block.after(box);
  else root.appendChild(box);
  fixColumns(root);
  placeCaret(box.querySelector('div.col')!);
}

/** Spalte links/rechts von Spalte i einfügen – in allen Zeilen (höchstens MAX_COLS). */
export function addColumn(box: HTMLElement, i: number, side: 'left' | 'right'): boolean {
  if (columnCount(box) >= MAX_COLS) return false;
  const doc = box.ownerDocument;
  let first: HTMLElement | null = null;
  for (const row of rowsOf(box)) {
    const ref = cellsOf(row)[i];
    if (!ref) continue;
    const fresh = newCol(doc);
    if (side === 'left') ref.before(fresh);
    else ref.after(fresh);
    first ??= fresh;
  }
  if (first) placeCaret(first);
  return !!first;
}

/** Spalte i in allen Zeilen entfernen; war es die letzte Spalte, verschwindet der ganze Block. */
export function removeColumn(box: HTMLElement, i: number) {
  columnCells(box, i).forEach((c) => c.remove());
  if (!columnCount(box)) removeBox(box);
}

/** Neue Zeile über/unter row (mit gleich vielen Spalten). */
export function addRow(row: HTMLElement, side: 'above' | 'below') {
  const fresh = newRow(row.ownerDocument, cellsOf(row).length || 1);
  if (side === 'above') row.before(fresh);
  else row.after(fresh);
  placeCaret(fresh);
}

/** Zeile entfernen; war es die letzte, verschwindet der ganze Block. */
export function removeRow(row: HTMLElement) {
  const box = row.parentElement;
  row.remove();
  if (box && !rowsOf(box).length) removeBox(box);
}

function removeBox(box: HTMLElement) {
  const root = box.parentElement;
  const next = box.nextElementSibling;
  box.remove();
  if (next) placeCaret(next);
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
 * Soll ⌫/Entf hier verhindert werden? Sonst würde der Browser Zellen zusammenlegen oder den Absatz unter/über dem
 * Block in eine Zelle ziehen. Spalten/Zeilen löscht man mit den Knöpfen am Rand.
 */
export function blockColumnMerge(root: HTMLElement, key: 'Backspace' | 'Delete'): boolean {
  const sel = root.ownerDocument.getSelection();
  if (!sel?.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return false;
  const start = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  // Zeile (Absatz, Listenpunkt …), in der der Cursor steht.
  const line = start?.closest(LINES);
  const back = key === 'Backspace';
  /** Steht der Cursor am Anfang der ersten bzw. am Ende der letzten Zeile von el? (Leere Zeilen davor zählen mit.) */
  const atOuterEdge = (el: Element) => {
    const lines = el.querySelectorAll(LINES);
    const edgeLine = back ? lines[0] : lines[lines.length - 1];
    return !!line && line === edgeLine && caretAtEdge(line, back ? 'start' : 'end');
  };
  const col = start?.closest('div.col');
  if (col && root.contains(col)) return atOuterEdge(col);
  const block = topBlockAtCursor(root);
  if (!block) return false;
  if (back) {
    const box = block.previousElementSibling;
    if (!box?.matches(COLS_SELECTOR) || !atOuterEdge(block)) return false;
    // Leerer Absatz direkt unter dem Block (nicht der letzte): entfernen, Cursor ans Ende der letzten Zelle.
    if (block.nextElementSibling && !hasContent(block)) {
      block.remove();
      const cells = box.querySelectorAll('div.col');
      if (cells.length) placeCaret(cells[cells.length - 1], true);
    }
    return true;
  }
  return !!block.nextElementSibling?.matches(COLS_SELECTOR) && atOuterEdge(block);
}

// ---------- Auswahl über mehrere Zellen ----------
// Browser behandeln eine Auswahl über Zellgrenzen wie normalen Text: Löschen/Tippen/Listen ziehen dann Inhalt aus
// anderen Zellen heran oder entfernen ganze Zellen. Deshalb wird so eine Auswahl in Stücke je Zelle zerlegt.

const cellOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("div.col") ?? null;

/** Erste bzw. letzte Textstelle in el (Textknoten, sonst vor einem <br>, sonst el selbst). */
function edgePoint(el: Element, atEnd: boolean): [Node, number] {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').length) || (n instanceof Element && n.matches('br, img, span.math'))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  let hit: Node | null = null;
  if (atEnd) while (walker.nextNode()) hit = walker.currentNode;
  else hit = walker.nextNode();
  if (!hit) return [el, atEnd ? el.childNodes.length : 0];
  if (hit.nodeType === Node.TEXT_NODE) return [hit, atEnd ? (hit.textContent ?? '').length : 0];
  // Element (br/img/Formel): Stelle davor bzw. dahinter im Elternelement.
  const parent = hit.parentNode!;
  const i = Array.prototype.indexOf.call(parent.childNodes, hit);
  return [parent, atEnd && !(hit as Element).matches('br') ? i + 1 : i];
}

/** Direktes Kind von root, in dem node liegt. */
function topLevel(root: HTMLElement, node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof HTMLElement ? el : null;
}

/** Liegt node komplett innerhalb von r? */
function rangeCovers(r: Range, node: Node): boolean {
  const n = node.ownerDocument!.createRange();
  n.selectNode(node);
  return r.compareBoundaryPoints(Range.START_TO_START, n) <= 0 && r.compareBoundaryPoints(Range.END_TO_END, n) >= 0;
}

/**
 * Die aktuelle Auswahl als Stücke je Zelle bzw. je Absatz außerhalb der Blöcke – oder null, wenn sie keine
 * Zellgrenze berührt (dann darf der Browser selbst arbeiten).
 */
export function selectionPieces(root: HTMLElement, clamp = true): Range[] | null {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  const sc = cellOf(r.startContainer);
  const ec = cellOf(r.endContainer);
  const boxes = Array.from(root.querySelectorAll<HTMLElement>(COLS_SELECTOR));
  if (sc === ec && (sc || !boxes.some((b) => r.intersectsNode(b)))) return null;
  const pieces: Range[] = [];
  for (const child of Array.from(root.children)) {
    if (!r.intersectsNode(child)) continue;
    const parts = child.matches(COLS_SELECTOR) ? Array.from(child.querySelectorAll('div.col')) : [child];
    for (const t of parts) {
      if (!r.intersectsNode(t)) continue;
      const pr = doc.createRange();
      pr.selectNodeContents(t);
      // Grenzen IN den Text legen (nicht an den Rand der Zelle) – sonst rechnet der Browser die Nachbarzelle mit.
      if (t.contains(r.startContainer)) pr.setStart(r.startContainer, r.startOffset);
      else if (clamp) pr.setStart(...edgePoint(t, false));
      if (t.contains(r.endContainer)) pr.setEnd(r.endContainer, r.endOffset);
      else if (clamp) pr.setEnd(...edgePoint(t, true));
      if (!pr.collapsed) pieces.push(pr);
    }
  }
  return pieces;
}

/**
 * Markierten Text löschen, ohne Zellen zu verschieben oder zu entfernen: in jeder Zelle nur das Markierte.
 * Ganz markierte Blöcke (mit allen Zellen) und ganz markierte Absätze außerhalb verschwinden.
 * Gibt false zurück, wenn die Auswahl keine Zellgrenze berührt (dann normal löschen lassen).
 */
export function deleteAcrossCells(root: HTMLElement): boolean {
  const pieces = selectionPieces(root, false);
  if (!pieces) return false;
  const doc = root.ownerDocument;
  const r = doc.getSelection()!.getRangeAt(0).cloneRange();
  const startCell = cellOf(r.startContainer);
  // Anfang/Ende merken (die Range selbst verschiebt sich beim Löschen).
  const s0 = r.startContainer;
  const s0Off = r.startOffset;
  const e0 = r.endContainer;
  // Ganz markierte Blöcke/Absätze (nicht der, in dem die Auswahl beginnt oder endet).
  const whole = Array.from(root.children).filter((c) => rangeCovers(r, c) && !c.contains(r.startContainer) && !c.contains(r.endContainer));
  // Ganz markierte Zellen leeren, sonst nur das Markierte löschen.
  const full = new Set(
    Array.from(root.querySelectorAll<HTMLElement>('div.col')).filter((c) => r.intersectsNode(c) && rangeCovers(r, c) && !c.contains(r.startContainer) && !c.contains(r.endContainer)),
  );
  pieces.forEach((p) => {
    const c = cellOf(p.startContainer);
    if (!c || !full.has(c)) p.deleteContents();
  });
  full.forEach((c) => c.replaceChildren(emptyBlock(doc)));
  whole.forEach((c) => c.remove());
  // Beginnt und endet die Auswahl außerhalb von Blöcken (in zwei verschiedenen Absätzen), wie gewohnt zusammenfügen.
  const sTop = s0.isConnected ? topLevel(root, s0) : null;
  const eTop = e0.isConnected ? topLevel(root, e0) : null;
  if (sTop && eTop && sTop !== eTop && !sTop.matches(COLS_SELECTOR) && !eTop.matches(COLS_SELECTOR) && sTop.matches('p, h2, h3') && eTop.matches('p, h2, h3')) {
    if (eTop.textContent || eTop.querySelector('img, span.math')) {
      sTop.querySelectorAll(':scope > br:last-child').forEach((br) => br.remove());
      sTop.append(...Array.from(eTop.childNodes));
    }
    eTop.remove();
  }
  // Leerzeichen am Rand der Schnittstellen sichtbar halten (sonst „verschluckt“ sie der Browser beim Weitertippen).
  if (s0 instanceof Text && s0.isConnected && s0Off === s0.data.length && s0.data.endsWith(' ')) s0.data = s0.data.slice(0, -1) + '\u00a0';
  if (e0 !== s0 && e0 instanceof Text && e0.isConnected && e0.data.startsWith(' ')) e0.data = '\u00a0' + e0.data.slice(1);
  // Leer gewordene Zeilen sichtbar lassen.
  root.querySelectorAll('p, h2, h3, li').forEach((el) => {
    if (!el.textContent && !el.querySelector('br, img, span.math, figure, ul, ol')) el.replaceChildren(doc.createElement('br'));
  });
  if (!root.firstChild) root.appendChild(emptyBlock(doc));
  fixColumns(root);
  // Cursor an den Anfang der Auswahl (bzw. in die erste Zelle, falls dort alles weg ist).
  const sel = doc.getSelection()!;
  const first = pieces.find((p) => p.startContainer.isConnected && root.contains(p.startContainer));
  const max = s0.nodeType === Node.TEXT_NODE ? (s0.textContent ?? '').length : s0.childNodes.length;
  try {
    // Wo die Auswahl begann (der Textknoten dort bleibt beim Löschen erhalten).
    if (s0 !== root && s0.isConnected && root.contains(s0)) sel.collapse(s0, Math.min(s0Off, max));
    else if (first) sel.collapse(first.startContainer, first.startOffset);
    else if (startCell?.isConnected) placeCaret(startCell);
    else placeCaret(root);
  } catch {
    placeCaret(root);
  }
  // Steht der Cursor direkt in der Zelle (nicht in einer Zeile), in die erste Zeile setzen.
  const a = sel.anchorNode;
  if (a instanceof HTMLElement && a.matches('div.col, div.row, div.cols')) placeCaret(cellOf(a) ?? a);
  return true;
}

/**
 * Befehl (z. B. Liste, Überschrift, Ausrichtung) bei einer Auswahl über mehrere Zellen für jede Zelle einzeln
 * ausführen – sonst würde der Browser die Zellen zu einem Absatz/einer Liste zusammenziehen.
 */
export function perCell(root: HTMLElement, run: () => void) {
  const pieces = selectionPieces(root);
  if (!pieces) return run();
  const sel = root.ownerDocument.getSelection()!;
  for (const p of pieces) {
    if (!p.startContainer.isConnected) continue;
    // Die Zelle (bzw. der Absatz) wird kurz zum einzigen bearbeitbaren Bereich – so kann der Browser den Befehl
    // nicht auf Nachbarzellen ausdehnen (z. B. Listen mit der Liste in der Zelle davor zusammenlegen).
    const host = cellOf(p.startContainer) ?? topLevel(root, p.startContainer);
    if (host) {
      root.contentEditable = 'false';
      host.contentEditable = 'true';
      host.focus({ preventScroll: true });
    }
    sel.removeAllRanges();
    sel.addRange(p);
    try {
      run();
    } finally {
      if (host) {
        host.removeAttribute('contenteditable');
        root.contentEditable = 'true';
      }
    }
  }
  root.focus({ preventScroll: true });
  // Auswahl wieder über alles legen, soweit möglich.
  const live = pieces.filter((p) => p.startContainer.isConnected && p.endContainer.isConnected);
  if (live.length) {
    const all = root.ownerDocument.createRange();
    all.setStart(live[0].startContainer, live[0].startOffset);
    all.setEnd(live[live.length - 1].endContainer, live[live.length - 1].endOffset);
    sel.removeAllRanges();
    sel.addRange(all);
  }
}
