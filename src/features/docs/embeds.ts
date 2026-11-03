// In Text-Dokumente einbettbare Dinge (Diagramme, Glücksräder): Daten im Dokument, Zeichnen, Kopieren & Einfügen.
// Im Dokument steht nur <figure class="chart|wheel" data-chart|data-wheel="{JSON}"> – gezeichnet wird beim Anzeigen.
import { useEffect, useState } from 'react';
import { chartJson, chartSvg, chartText, parseChart, PRINT, type Chart } from '../charts/chart';
import { parseWheel, wheelJson, wheelPrintSvg, wheelSvg, wheelText, type Wheel } from '../wheel/wheel';

export type EmbedKind = 'chart' | 'wheel';
export type EmbedData = { kind: 'chart'; data: Chart } | { kind: 'wheel'; data: Wheel };

export const EMBED_KINDS: EmbedKind[] = ['chart', 'wheel'];
export const EMBED_LABEL: Record<EmbedKind, string> = { chart: 'Diagramm', wheel: 'Glücksrad' };

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parseEmbed(kind: EmbedKind, json: string | unknown): EmbedData {
  return kind === 'chart' ? { kind, data: parseChart(json) } : { kind, data: parseWheel(json) };
}
export const embedJson = (e: EmbedData) => (e.kind === 'chart' ? chartJson(e.data) : wheelJson(e.data));
export const embedText = (e: EmbedData) => (e.kind === 'chart' ? chartText(e.data) : wheelText(e.data));
export const embedTitle = (e: EmbedData) => e.data.title.trim() || EMBED_LABEL[e.kind];
const embedSvg = (e: EmbedData) => (e.kind === 'chart' ? chartSvg(e.data) : wheelSvg(e.data));
const printSvg = (e: EmbedData) => (e.kind === 'chart' ? chartSvg(e.data, PRINT) : wheelPrintSvg(e.data));

/** HTML zum Einbetten in ein Dokument. */
export const embedFigure = (e: EmbedData) => `<figure class="${e.kind}" data-${e.kind}="${attr(embedJson(e))}"></figure>`;
/** Daten einer eingebetteten Figur lesen. */
export function embedOf(el: Element): EmbedData | null {
  for (const kind of EMBED_KINDS) if (el.matches(`figure.${kind}`)) return parseEmbed(kind, el.getAttribute(`data-${kind}`) ?? '');
  return null;
}
export const EMBED_SELECTOR = EMBED_KINDS.map((k) => `figure.${k}`).join(', ');

const COPY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h10.5v11H9zM15 9V4.5H4.5V15H9"/></svg>';

/**
 * Eingebettete Figuren zeichnen (statisch). editable = im Editor (nicht bearbeitbarer Block),
 * copyButton = Kopieren-Knopf (Ansicht), skip = Arten, die anderweitig gezeichnet werden (z. B. drehbare Glücksräder).
 */
export function renderEmbedsIn(root: HTMLElement, opts: { editable?: boolean; copyButton?: boolean; skip?: EmbedKind[] } = {}) {
  root.querySelectorAll<HTMLElement>(EMBED_SELECTOR).forEach((fig) => {
    const e = embedOf(fig);
    if (!e || opts.skip?.includes(e.kind)) return;
    fig.innerHTML =
      embedSvg(e) +
      (opts.copyButton ? `<button type="button" class="chart-copy" aria-label="${EMBED_LABEL[e.kind]} kopieren" title="Kopieren">${COPY_ICON} Kopieren</button>` : '');
    if (opts.editable) fig.contentEditable = 'false';
  });
}

// ---------- Bild ----------
/** SVG als PNG (für die Zwischenablage / andere Apps). */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const w = Number(svg.match(/width="(\d+)"/)?.[1] ?? 520);
  const h = Number(svg.match(/height="(\d+)"/)?.[1] ?? 360);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erstellt werden.'))), 'image/png'));
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

// ---------- Zwischenablage ----------
// Systemzwischenablage: HTML (mit den Daten + Bild, für andere Apps), reiner Text und PNG.
// Zusätzlich merkt sich die App die Kopie, denn manche Handys geben beim Einfügen nur Text weiter.
const CLIP_KEY = 'lernapp-kopie';

/** Zuletzt in der App Kopiertes (höchstens 1 Tag alt), optional nur einer Art. */
export function lastCopied(kind?: EmbedKind): { embed: EmbedData; text: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null');
    if (!raw || Date.now() - raw.at > 24 * 3600_000 || !EMBED_KINDS.includes(raw.kind)) return null;
    if (kind && raw.kind !== kind) return null;
    return { embed: parseEmbed(raw.kind, raw.json), text: String(raw.text) };
  } catch {
    return null;
  }
}

export interface Prepared {
  embed: EmbedData;
  png: Blob | null;
  html: string;
  text: string;
}
/** Kopieren vorbereiten (Bild erzeugen), damit der Klick sofort in die Zwischenablage schreiben kann. */
export async function prepareEmbed(e: EmbedData): Promise<Prepared> {
  const embed = parseEmbed(e.kind, embedJson(e));
  let png: Blob | null = null;
  let img = '';
  try {
    png = await svgToPng(printSvg(embed));
    img = `<img src="${await blobToDataUrl(png)}" alt="${attr(embedText(embed))}">`;
  } catch {
    /* ohne Bild */
  }
  const html = `<figure class="${embed.kind}" data-${embed.kind}="${attr(embedJson(embed))}">${img}</figure>`;
  return { embed, png, html, text: embedText(embed) };
}

/** Kopieren (im Klick aufrufen). false = nur die App-interne Kopie hat geklappt. */
export async function copyPrepared(p: Prepared): Promise<boolean> {
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify({ kind: p.embed.kind, json: embedJson(p.embed), text: p.text, at: Date.now() }));
  } catch {
    /* privat/voll */
  }
  const html = new Blob([p.html], { type: 'text/html' });
  const text = new Blob([p.text], { type: 'text/plain' });
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const tries: Record<string, Blob>[] = [];
    if (p.png) tries.push({ 'text/html': html, 'text/plain': text, 'image/png': p.png });
    tries.push({ 'text/html': html, 'text/plain': text });
    for (const t of tries) {
      try {
        await navigator.clipboard.write([new ClipboardItem(t)]);
        return true;
      } catch {
        /* nächste Variante */
      }
    }
  }
  // Alter Weg: unsichtbares Element markieren und kopieren.
  try {
    const div = document.createElement('div');
    div.innerHTML = p.html;
    div.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(div);
    const r = document.createRange();
    r.selectNodeContents(div);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    div.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Eingefügte Daten: aus der App?
 * 'html' = HTML enthält eingebettete Daten (normal als HTML einfügen, der Sanitizer behält sie),
 * EmbedData = nur Text kam an, passt aber zum zuletzt in der App Kopierten.
 */
export function embedFromPaste(data: DataTransfer): 'html' | EmbedData | null {
  const html = data.getData('text/html');
  if (html && EMBED_KINDS.some((k) => html.includes(`data-${k}`))) return 'html';
  const text = data.getData('text/plain').trim();
  const clip = lastCopied();
  if (clip && text && text === clip.text) return clip.embed;
  return null;
}

/** Hook: Kopie vorbereiten und per Klick kopieren. */
export function useEmbedCopy(embed: EmbedData | null) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setPrepared(null);
    setDone(false);
    if (embed) prepareEmbed(embed).then((p) => alive && setPrepared(p));
    return () => {
      alive = false;
    };
  }, [embed]);
  const run = async () => {
    if (!prepared) return;
    await copyPrepared(prepared);
    // Auch wenn nur die App-interne Kopie klappt, kann man in der App einfügen.
    setDone(true);
  };
  return { prepared, done, run };
}
