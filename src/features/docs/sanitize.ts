// Text-Dokumente sind HTML. Weil sie auch von anderen Personen stammen können (geteilte Ordner),
// wird vor dem Anzeigen/Einfügen alles entfernt, was nicht ausdrücklich erlaubt ist.

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
const safeLink = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

function clean(node: Node, out: Node, doc: Document) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      // Unsichtbare Hilfszeichen hinter Formeln nicht mitspeichern.
      out.appendChild(doc.createTextNode((child.textContent ?? '').replace(/\u200b/g, '')));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br' || tag === 'hr') {
      out.appendChild(doc.createElement(tag));
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
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const target = safeLink(href) ? doc.createElement('a') : doc.createDocumentFragment();
      if (target instanceof HTMLAnchorElement) {
        target.setAttribute('href', href.trim());
        target.setAttribute('target', '_blank');
        target.setAttribute('rel', 'noopener noreferrer');
      }
      clean(el, target, doc);
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
    }
    clean(el, target, doc);
    out.appendChild(target);
  });
}

/** Erlaubtes HTML übrig lassen (Absätze, Überschriften, Listen, Fett/Kursiv/…, Links, eingebettete Bilder). */
export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
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
