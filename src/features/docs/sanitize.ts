// Text-Dokumente sind HTML. Weil sie auch von anderen Personen stammen können (geteilte Ordner),
// wird vor dem Anzeigen/Einfügen alles entfernt, was nicht ausdrücklich erlaubt ist.
import { EMBED_KINDS, embedJson, parseEmbed } from './embeds';
import { MAX_COLS } from './columns';
import { MAX_GLOSS } from './gloss';

export const DOC_EXT = 'dokument';
export const DOC_MIME = 'application/vnd.lernapp.dokument+html';

const BLOCK: Record<string, string> = { p: 'p', div: 'p', h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3', blockquote: 'blockquote', pre: 'pre', ul: 'ul', ol: 'ol', li: 'li' };
const INLINE: Record<string, string> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', strike: 's', del: 's', code: 'code', sub: 'sub', sup: 'sup', mark: 'mark', span: '' };

const ALIGNABLE = new Set(['p', 'h2', 'h3', 'li', 'blockquote']);
const alignOf = (el: HTMLElement) => {
  const a = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
  return a === 'center' || a === 'right' ? a : '';
};

const safeImage = (src: string) => /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src);
const safeId = (id: string | null) => (id && /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null);

const safeLink = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

function clean(node: Node, out: Node, doc: Document, inCol = false) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      // Unsichtbare Hilfszeichen hinter Formeln nicht mitspeichern.
      out.appendChild(doc.createTextNode((child.textContent ?? '').replace(/\u200b/g, '')));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    // Spalten & Zeilen: <div class="cols"> mit <div class="row">s, darin je 1–4 <div class="col">.
    // Ältere Dokumente: Zellen direkt im Block = eine Zeile. Blöcke in Zellen werden aufgelöst (Inhalt untereinander).
    if (tag === 'div' && el.classList.contains('cols')) {
      const isCell = (c: Element) => c.tagName === 'DIV' && c.classList.contains('col');
      const rows: Element[][] = [];
      let loose: Element[] | null = null;
      for (const c of Array.from(el.children)) {
        if (c.tagName === 'DIV' && c.classList.contains('row')) {
          loose = null;
          const cells = Array.from(c.children).filter(isCell);
          if (cells.length) rows.push(cells);
        } else if (isCell(c)) {
          if (!loose) rows.push((loose = []));
          loose.push(c);
        }
      }
      if (inCol || !rows.length) {
        (rows.length ? rows.flat() : [el]).forEach((c) => clean(c, out, doc, inCol));
        return;
      }
      const n = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
      const box = doc.createElement('div');
      box.className = 'cols';
      for (const cells of rows) {
        const row = doc.createElement('div');
        row.className = 'row';
        for (let i = 0; i < n; i++) {
          const col = doc.createElement('div');
          col.className = 'col';
          // Mehr Zellen als erlaubt: der Rest landet in der letzten Spalte.
          (i === n - 1 ? cells.slice(i) : cells.slice(i, i + 1)).forEach((c) => clean(c, col, doc, true));
          if (!col.childNodes.length) col.appendChild(doc.createElement('p')).appendChild(doc.createElement('br'));
          row.appendChild(col);
        }
        box.appendChild(row);
      }
      out.appendChild(box);
      return;
    }
    if (tag === 'div' && (el.classList.contains('col') || el.classList.contains('row'))) {
      clean(el, out, doc, inCol);
      return;
    }
    // Handschrift wird getrennt gespeichert (siehe pages/ink.ts) – nie im Text selbst.
    if (tag === 'div' && el.classList.contains('ink-pages')) return;
    if (tag === 'br' || tag === 'hr') {
      const n = doc.createElement(tag);
      // Seitenumbruch: der nächste Block beginnt auf einer neuen Seite.
      if (tag === 'hr' && el.classList.contains('pb') && !inCol) n.className = 'pb';
      out.appendChild(n);
      return;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      if (safeImage(src)) {
        const img = doc.createElement('img');
        img.setAttribute('src', src);
        const alt = el.getAttribute('alt');
        if (alt) img.setAttribute('alt', alt.slice(0, 200));
        // Breite in Pixeln (Höhe ergibt sich immer aus dem Seitenverhältnis).
        const w = parseInt(el.getAttribute('width') ?? el.style.width ?? '', 10);
        if (w >= 24 && w <= 4000) img.setAttribute('width', String(w));
        out.appendChild(img);
      }
      return;
    }
    // Erklärung zu einem Wort/Satz: der markierte Text bleibt, die Erklärung steht in data-gloss.
    // Leere oder verschachtelte Erklärungen werden aufgelöst (nur der Text bleibt).
    if (tag === 'span' && el.classList.contains('gloss')) {
      const g = (el.getAttribute('data-gloss') ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_GLOSS);
      if (!g || el.parentElement?.closest('span.gloss')) {
        clean(el, out, doc, inCol);
        return;
      }
      const span = doc.createElement('span');
      span.className = 'gloss';
      span.setAttribute('data-gloss', g);
      clean(el, span, doc, inCol);
      if ((span.textContent ?? '').trim() || span.querySelector('span.math, img')) out.appendChild(span);
      return;
    }
    // Formel: nur der LaTeX-Quelltext wird gespeichert, die Darstellung erzeugt KaTeX beim Anzeigen.
    if (tag === 'span' && el.classList.contains('math')) {
      const tex = (el.getAttribute('data-tex') ?? '').slice(0, 4000);
      if (tex.trim()) {
        const span = doc.createElement('span');
        span.className = 'math';
        span.setAttribute('data-tex', tex);
        if (el.getAttribute('data-display') === '1') span.setAttribute('data-display', '1');
        out.appendChild(span);
      }
      return;
    }
    // Eingebettetes Diagramm/Glücksrad: nur die Daten werden gespeichert, gezeichnet wird beim Anzeigen.
    const kind = EMBED_KINDS.find((k) => el.hasAttribute(`data-${k}`));
    if (kind && (tag === 'figure' || tag === 'div' || tag === 'span' || tag === 'p')) {
      const fig = doc.createElement('figure');
      fig.className = kind;
      fig.setAttribute(`data-${kind}`, embedJson(parseEmbed(kind, el.getAttribute(`data-${kind}`) ?? '')));
      out.appendChild(fig);
      return;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const target = safeLink(href) ? doc.createElement('a') : doc.createDocumentFragment();
      if (target instanceof HTMLAnchorElement) {
        target.setAttribute('href', href.trim());
        target.setAttribute('target', '_blank');
        target.setAttribute('rel', 'noopener noreferrer');
      }
      clean(el, target, doc, inCol);
      out.appendChild(target);
      return;
    }
    // Skripte, Styles, Formulare usw. samt Inhalt verwerfen.
    if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'template', 'head', 'meta', 'link', 'title'].includes(tag)) return;
    const mapped = BLOCK[tag] ?? INLINE[tag];
    const target = mapped ? doc.createElement(mapped) : doc.createDocumentFragment();
    // Ausrichtung (zentriert/rechts) bei Absätzen, Überschriften und Listenpunkten behalten.
    if (target instanceof HTMLElement && ALIGNABLE.has(mapped)) {
      const a = alignOf(el);
      if (a) target.setAttribute('style', `text-align: ${a}`);
      // Einrückung (Tab) von Absätzen/Überschriften: Stufe 1–8.
      const ind = parseInt(el.getAttribute('data-indent') ?? '', 10);
      if (mapped !== 'li' && ind >= 1 && ind <= 8) target.setAttribute('data-indent', String(ind));
    }
    // Checklisten: Klasse, Modus (gemeinsam) und die IDs der Punkte (für die Häkchen) behalten.
    if (target instanceof HTMLElement && mapped === 'ul' && el.classList.contains('checklist')) {
      target.className = 'checklist';
      if (el.getAttribute('data-shared') === '1') target.setAttribute('data-shared', '1');
    }
    if (target instanceof HTMLElement && mapped === 'li') {
      const id = safeId(el.getAttribute('data-id'));
      if (id) target.setAttribute('data-id', id);
    }
    clean(el, target, doc, inCol);
    out.appendChild(target);
  });
}

const BLOCK_SEL = 'ul, ol, p, h2, h3, blockquote, pre, figure, div';
/**
 * Browser legen Listen beim Bearbeiten gern in einen Absatz (<p><ul>…</ul></p>) – das ist ungültig und verschiebt Einzüge.
 * Absätze mit Blöcken darin werden aufgelöst: die Blöcke kommen davor, Text dazwischen in eigene Absätze.
 * Gibt true zurück, wenn etwas geändert wurde.
 */
export function normalizeBlocks(root: ParentNode): boolean {
  let changed = false;
  // Listenpunkte ohne Liste (sonst steht der Punkt ganz links am Rand) in eine Liste packen.
  for (const li of Array.from(root.querySelectorAll('li'))) {
    const parent = li.parentElement;
    if (!parent || parent.matches('ul, ol')) continue;
    changed = true;
    const prev = li.previousElementSibling;
    if (prev?.matches('ul') && prev.getAttribute('data-orphans') === '1') prev.appendChild(li);
    else {
      const ul = li.ownerDocument.createElement('ul');
      ul.setAttribute('data-orphans', '1');
      parent.insertBefore(ul, li);
      ul.appendChild(li);
    }
  }
  root.querySelectorAll('ul[data-orphans]').forEach((ul) => ul.removeAttribute('data-orphans'));
  for (let round = 0; round < 6; round++) {
    const bad = Array.from(root.querySelectorAll('p')).filter((p) => Array.from(p.children).some((c) => c.matches(BLOCK_SEL)));
    if (!bad.length) break;
    changed = true;
    for (const p of bad) {
      const parent = p.parentNode;
      if (!parent) continue;
      const doc = p.ownerDocument;
      let run: HTMLElement | null = null;
      for (const node of Array.from(p.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(BLOCK_SEL)) {
          run = null;
          parent.insertBefore(node, p);
          continue;
        }
        if (!run) {
          run = doc.createElement('p');
          if (p.style.textAlign) run.style.textAlign = p.style.textAlign;
          if (p.dataset.indent) run.dataset.indent = p.dataset.indent;
          parent.insertBefore(run, p);
        }
        run.appendChild(node);
      }
      p.remove();
    }
  }
  // Leere Absätze, die dabei entstanden sind (nur Leerraum), entfernen.
  if (changed) root.querySelectorAll('p').forEach((p) => !p.textContent?.trim() && !p.querySelector('img, br, span.math') && p.remove());
  if (isolateImages(root)) changed = true;
  return changed;
}

/**
 * Jedes Bild steht in einem eigenen Absatz. Stehen mehrere Bilder (oder Bild und Text) in einem Absatz,
 * wird er aufgeteilt – sonst rutscht der ganze Absatz als ein großer Block auf die nächste Seite
 * (große Lücken) und Bilder lassen sich nicht einzeln dazwischen verschieben.
 * Nur Absätze direkt im Dokument bzw. in einer Spalten-Zelle; Bilder in Listen o. Ä. bleiben, wo sie sind.
 */
function isolateImages(root: ParentNode): boolean {
  let changed = false;
  const isImg = (n: Node): n is HTMLImageElement => n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'IMG';
  const isGap = (n: Node) =>
    (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').replace(/\u200b/g, '').trim()) || (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR');
  for (const p of Array.from(root.querySelectorAll('p'))) {
    const host = p.parentElement;
    if (!host || !(host === root || (host.tagName === 'DIV' && host.classList.contains('col')) || host.tagName === 'BODY')) continue;
    const kids = Array.from(p.childNodes);
    const imgs = kids.filter(isImg);
    if (!imgs.length) continue;
    // Nur ein Bild (höchstens mit Leerraum/Zeilenumbruch daneben) – passt schon.
    if (imgs.length === 1 && kids.every((k) => isImg(k) || isGap(k))) continue;
    changed = true;
    const doc = p.ownerDocument;
    const make = () => {
      const n = doc.createElement('p');
      if (p.style.textAlign) n.style.textAlign = p.style.textAlign;
      if (p.dataset.indent) n.dataset.indent = p.dataset.indent;
      return n;
    };
    const parts: HTMLElement[] = [];
    let run: HTMLElement | null = null;
    for (const k of kids) {
      if (isImg(k)) {
        run = null;
        const box = make();
        box.appendChild(k);
        parts.push(box);
        continue;
      }
      if (!run) {
        run = make();
        parts.push(run);
      }
      run.appendChild(k);
    }
    // Text-Stücke, die nur aus Leerraum/Zeilenumbrüchen bestehen, fallen weg.
    const keep = parts.filter((x) => x.querySelector('img') || !Array.from(x.childNodes).every(isGap));
    p.replaceWith(...keep);
    // Zeilenumbrüche am Rand eines Text-Stücks (stammten von zwischen den Bildern) entfernen
    for (const x of keep) {
      if (x.querySelector('img')) continue;
      while (x.firstChild && isGap(x.firstChild)) x.firstChild.remove();
      while (x.lastChild && isGap(x.lastChild)) x.lastChild.remove();
    }
  }
  return changed;
}

/** Erlaubtes HTML übrig lassen (Absätze, Überschriften, Listen, Fett/Kursiv/…, Links, eingebettete Bilder). */
export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  normalizeBlocks(parsed.body);
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');
  clean(parsed.body, root, doc);
  return root.innerHTML;
}

/** Reiner Text eines Dokuments (z. B. für die Suche oder die Größe). */
export function htmlToText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** Bild für ein Dokument verkleinern (max. 1600 px, JPEG) und als data:-URL liefern. */
export async function imageToDataUrl(file: Blob, max = 1600): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; // transparente Bilder nicht schwarz werden lassen
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
