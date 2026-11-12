// Text fließt über die Seiten: Blöcke, die über das Seitenende ragen würden, rutschen (per Abstand oben)
// an den Anfang der nächsten Seite. Der Abstand steht nur in einem eigenen Stylesheet – am Inhalt selbst
// ändert sich nichts (er wird also auch nicht mitgespeichert).
// Seitenumbrüche: <hr class="pb"> – der nächste Block beginnt auf einer neuen Seite.
import { CONTENT_H, PITCH } from './geometry';

export const isBreak = (n: Node | null | undefined): n is HTMLHRElement => n instanceof HTMLHRElement && n.classList.contains('pb');

/** Blöcke, deren Kinder einzeln auf die nächste Seite rutschen dürfen (lange Listen, Tabellen …). */
function splittable(el: Element): boolean {
  const t = el.tagName;
  if (t === 'UL' || t === 'OL' || t === 'BLOCKQUOTE') return el.children.length > 1;
  if (t === 'DIV' && el.classList.contains('cols')) return el.children.length > 1;
  if (t === 'LI') return Array.from(el.children).some((c) => /^(UL|OL|P|H2|H3|BLOCKQUOTE|PRE|FIGURE|DIV)$/.test(c.tagName));
  return false;
}

function selectorOf(el: Element, flow: HTMLElement): string {
  let path = '';
  let cur: Element = el;
  while (cur !== flow) {
    const parent = cur.parentElement!;
    path = ` > :nth-child(${Array.prototype.indexOf.call(parent.children, cur) + 1})` + path;
    cur = parent;
  }
  return `[data-flow="${flow.dataset.flow}"]${path}`;
}

/** Maße relativ zum Textfluss – in Seiten-Pixeln (unabhängig vom Zoom). */
function measurer(flow: HTMLElement) {
  const s = flow.offsetWidth ? flow.getBoundingClientRect().width / flow.offsetWidth : 1;
  // Die Lage des Textflusses jedes Mal neu messen: Schiebt die Seitenaufteilung Blöcke nach unten, scrollt
  // der Browser oft mit (Scroll-Anker), und eine einmal gemerkte Lage wäre dann um genau dieses Stück falsch –
  // Bilder landeten zwischen den Seiten oder unter der letzten Seite.
  const origin = () => flow.getBoundingClientRect().top;
  return {
    top: (el: Element) => (el.getBoundingClientRect().top - origin()) / s,
    height: (el: Element) => el.getBoundingClientRect().height / s,
    bottom: (el: Element) => (el.getBoundingClientRect().bottom - origin()) / s,
  };
}

/**
 * Verteilt den Text auf Seiten. Gibt die Anzahl der Seiten zurück, die der Text braucht.
 * style: ein eigenes <style>-Element (wird jedes Mal neu befüllt).
 */
export function paginate(flow: HTMLElement, style: HTMLStyleElement): number {
  const sheet = style.sheet;
  if (!sheet) return 1;
  while (sheet.cssRules.length) sheet.deleteRule(0);
  if (!flow.isConnected || !flow.offsetWidth) return 1;
  const m = measurer(flow);
  let forced = -1; // nächster Block muss mindestens auf dieser Seite beginnen

  const pushTo = (el: HTMLElement, page: number) => {
    const want = page * PITCH;
    const sel = selectorOf(el, flow);
    const base = parseFloat(getComputedStyle(el).marginTop) || 0;
    let margin = base + (want - m.top(el));
    let index = -1;
    for (let round = 0; round < 4; round++) {
      if (index >= 0) sheet.deleteRule(index);
      index = sheet.insertRule(`${sel}{margin-top:${margin.toFixed(2)}px !important}`, sheet.cssRules.length);
      const diff = want - m.top(el);
      if (Math.abs(diff) < 0.5) break;
      margin += diff; // Abstände, die mit dem vorigen Block zusammenfallen
    }
  };

  const place = (el: HTMLElement) => {
    if (isBreak(el)) {
      let p = Math.max(0, Math.floor(m.top(el) / PITCH));
      if (forced > p) {
        pushTo(el, forced);
        p = forced;
      }
      forced = p + 1;
      return;
    }
    if (getComputedStyle(el).display === 'none') return;
    let top = m.top(el);
    let p = Math.max(0, Math.floor(top / PITCH));
    // Nach einem Seitenumbruch, oder Anfang liegt in der Lücke zwischen zwei Seiten
    if (forced > p || top - p * PITCH > CONTENT_H - 1) {
      pushTo(el, Math.max(forced, p + (forced > p ? 0 : 1)));
      top = m.top(el);
      p = Math.round(top / PITCH);
    }
    forced = -1;
    const h = m.height(el);
    const rel = top - p * PITCH;
    if (rel + h <= CONTENT_H + 0.5) return;
    // Ragt über das Seitenende: ganzer Block auf die nächste Seite – oder, wenn er länger als eine Seite ist, Stück für Stück.
    if (h <= CONTENT_H && rel > 0.5) pushTo(el, p + 1);
    else if (splittable(el)) Array.from(el.children).forEach((c) => place(c as HTMLElement));
  };

  Array.from(flow.children).forEach((c) => place(c as HTMLElement));
  let bottom = 0;
  for (const c of Array.from(flow.children)) if (!isBreak(c)) bottom = Math.max(bottom, m.bottom(c));
  const byText = bottom > 0 ? Math.floor((bottom - 1) / PITCH) + 1 : 1;
  return Math.max(1, byText, forced >= 0 ? forced + 1 : 0);
}

// ---------- Seiten umordnen (Text wandert mit) ----------

/** Erstes Element, das auf oder nach y beginnt (steigt in teilbare Blöcke hinab). */
function firstFrom(parent: Element, y: number, m: ReturnType<typeof measurer>): HTMLElement | null {
  for (const c of Array.from(parent.children) as HTMLElement[]) {
    if (getComputedStyle(c).display === 'none') continue;
    const top = m.top(c);
    if (top >= y - 0.5) return c;
    if (m.bottom(c) > y + 0.5 && splittable(c)) {
      const inner = firstFrom(c, y, m);
      if (inner) return inner;
    }
  }
  return null;
}

/** Teilt Listen/Tabellen usw., bis el direkt im Textfluss steht. */
function liftToTop(el: HTMLElement, flow: HTMLElement): HTMLElement {
  let cur = el;
  while (cur.parentElement && cur.parentElement !== flow) {
    const parent = cur.parentElement;
    let before = cur.previousSibling;
    while (before && before.nodeType === Node.TEXT_NODE && !before.textContent?.trim()) before = before.previousSibling;
    if (!before) {
      cur = parent;
      continue;
    }
    const clone = parent.cloneNode(false) as HTMLElement;
    clone.removeAttribute('data-id');
    let n: Node | null = cur;
    while (n) {
      const next: Node | null = n.nextSibling;
      clone.appendChild(n);
      n = next;
    }
    parent.after(clone);
    cur = clone;
  }
  return cur;
}

/**
 * Teilt den Text in Seiten-Stücke (Knoten je Seite). Danach beginnt jede Seite mit einem eigenen Knoten im Fluss.
 * hard[i]: Seite i endet mit einem Seitenumbruch.
 */
function segments(flow: HTMLElement, textPages: number) {
  const m = measurer(flow);
  const starts: (HTMLElement | null)[] = [];
  for (let k = 1; k < textPages; k++) starts.push(firstFrom(flow, k * PITCH, m));
  const tops = starts.map((s) => (s ? liftToTop(s, flow) : null));
  const segs: Node[][] = [];
  let cur: Node[] = [];
  let k = 0;
  for (const n of Array.from(flow.childNodes)) {
    while (k < tops.length && tops[k] === n) {
      segs.push(cur);
      cur = [];
      k++;
    }
    cur.push(n);
  }
  segs.push(cur);
  while (segs.length < textPages) segs.push([]);
  const hard = segs.map((s) => {
    const last = [...s].reverse().find((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
    return isBreak(last);
  });
  return { segs, hard };
}

/**
 * Seiten neu anordnen. order: alte Seitennummern in der neuen Reihenfolge, -1 = neue leere Seite.
 * Fehlende Nummern werden gelöscht (samt Text). Der Text auf jeder Seite wandert mit.
 */
export function reorderPages(flow: HTMLElement, textPages: number, order: number[]) {
  const { segs, hard } = segments(flow, textPages);
  const content = (i: number): Node[] => {
    if (i < 0 || i >= segs.length) return [];
    const s = [...segs[i]];
    while (s.length) {
      const last = s[s.length - 1];
      if (isBreak(last) || (last.nodeType === Node.TEXT_NODE && !last.textContent?.trim())) s.pop();
      else break;
    }
    return s;
  };
  const parts = order.map(content);
  let lastFull = -1;
  parts.forEach((p, j) => p.length && (lastFull = j));
  const out: Node[] = [];
  for (let j = 0; j <= lastFull; j++) {
    out.push(...parts[j]);
    if (j === lastFull) break;
    const natural = order[j] >= 0 && order[j + 1] === order[j] + 1 && !hard[order[j]] && parts[j].length > 0;
    if (!natural) {
      const hr = document.createElement('hr');
      hr.className = 'pb';
      out.push(hr);
    }
  }
  flow.replaceChildren(...out);
  if (!flow.firstChild) flow.innerHTML = '<p><br></p>';
}
