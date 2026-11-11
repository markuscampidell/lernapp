import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon, type IconName } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import { isTouchDevice } from '../../lib/files';
import { DOC_EXT, DOC_MIME, imageToDataUrl, normalizeBlocks, sanitizeHtml } from './sanitize';
import { loadKatex, renderMathIn, renderMathSpan } from '../../lib/math';
import { useKatex } from '../../components/MathText';
import { newId } from '../../lib/id';
import { useLibrary } from '../../state/Library';
import { applyChecks, checkboxHit, useChecks } from './checks';
import { ChartEditor } from '../charts/ChartEditor';
import { WheelEditor } from '../wheel/WheelEditor';
import { EmbedInsertSheet } from './EmbedInsertSheet';
import { EMBED_SELECTOR, embedFigure, embedFromPaste, embedJson, embedOf, embedTitle, renderEmbedsIn, useEmbedCopy, type EmbedData, type EmbedKind } from './embeds';
import { afterBack } from '../../lib/router';
import { addColumn, addRow, blockColumnMerge, columnCells, deleteAcrossCells, fixColumns, hasContent, insertColumns, MAX_COLS, perCell, removeColumn, removeRow } from './columns';
import { PagedDoc, penSeen, type InkInput, type PageEditing } from './pages/PagedDoc';
import { PenBar, usePenSettings } from './pages/PenBar';
import { PaperSheet } from './pages/PaperSheet';
import { joinDoc, newPage, splitDoc, type InkPage, type Stroke } from './pages/ink';
import { reorderPages } from './pages/paginate';
import { CONTENT_H, PAGE_W, typesText } from './pages/geometry';

/** Lage eines Spalten-Blocks, seiner Spalten und Zeilen (für die Knöpfe oben und links). */
interface ColBox {
  box: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Spalten: Lage innerhalb des Blocks (aus der ersten Zeile). */
  cols: { left: number; width: number }[];
  rows: { el: HTMLElement; top: number; height: number }[];
}
const sameBoxes = (a: ColBox[], b: ColBox[]) => JSON.stringify(a.map(({ box: _b, rows, ...r }) => ({ ...r, rows: rows.map(({ el: _e, ...x }) => x) }))) ===
  JSON.stringify(b.map(({ box: _b, rows, ...r }) => ({ ...r, rows: rows.map(({ el: _e, ...x }) => x) }))) &&
  a.every((x, i) => x.box === b[i].box && x.rows.every((r, j) => r.el === b[i].rows[j].el));

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blank = (c: string | undefined) => c === undefined || /\s/.test(c);

type Align = 'left' | 'center' | 'right';
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_IMAGE = 40;
/** Höchste Bildhöhe (Seiten-Pixel): ein Bild passt immer auf eine Seite. Gleicher Wert wie in global.css (.paged-flow img). */
const MAX_IMAGE_H = CONTENT_H - 24;

/** Zu hohe Bilder (z. B. Handy-Screenshots) so schmal machen, dass sie auf eine Seite passen. true = geändert. */
function fitImage(img: HTMLImageElement): boolean {
  if (!img.naturalWidth || !img.naturalHeight || img.closest(EMBED_SELECTOR)) return false;
  const ratio = img.naturalHeight / img.naturalWidth;
  const attr = parseFloat(img.getAttribute('width') ?? '');
  const room = img.parentElement?.clientWidth || Infinity;
  const w = Math.min(attr > 0 ? attr : img.naturalWidth, room);
  if (w * ratio <= MAX_IMAGE_H + 0.5) return false;
  img.setAttribute('width', String(Math.max(MIN_IMAGE, Math.floor(MAX_IMAGE_H / ratio))));
  img.style.removeProperty('height');
  return true;
}

/** Steht in diesem Absatz nur das Bild (kein Text, keine Formel)? */
const onlyImage = (block: Element) => !block.textContent?.trim() && block.querySelectorAll('img').length === 1 && !block.querySelector('span.math, figure');
/** Leer (nichts Sichtbares mehr drin)? */
const isEmptyBlock = (block: Element) => !block.textContent?.trim() && !block.querySelector('img, span.math, figure, hr');
/** Behälter, in denen Blöcke untereinander stehen: das Dokument selbst und Spalten-Zellen. */
const isBlockHost = (el: Element, root: Element) => el === root || (el.tagName === 'DIV' && el.classList.contains('col'));

/** Text-Dokument mit Formatierung und Bildern bearbeiten (wie ein einfaches Google Doc). */
/** Seiten an die Textlänge anpassen: fehlende anlegen, automatisch angelegte leere wieder entfernen. */
function fitPages(cur: InkPage[], textPages: number): InkPage[] {
  let next = cur;
  if (next.length < textPages) {
    next = [...next];
    while (next.length < textPages) next.push(newPage(next[next.length - 1], true));
  }
  let end = next.length;
  while (end > Math.max(1, textPages) && next[end - 1].auto && !next[end - 1].strokes.length) end--;
  return end === next.length ? next : next.slice(0, end);
}

/**
 * Text-Dokument bearbeiten: A4-Seiten mit Text (wie ein einfaches Google Doc) und Handschrift darüber.
 * mode "draw": nur zeichnen (Text bleibt, wie er ist).
 */
export function DocEditor({
  file,
  folderId,
  initial = '',
  initialName,
  initialDescription,
  onClose,
  mode = 'edit',
}: {
  file?: FileItem;
  folderId?: string;
  initial?: string;
  initialName?: string;
  initialDescription?: string;
  onClose: () => void;
  mode?: 'edit' | 'draw';
}) {
  const drawOnly = mode === 'draw';
  const doc = useMemo(() => splitDoc(initial), []); // eslint-disable-line react-hooks/exhaustive-deps
  // ---------- Seiten & Handschrift ----------
  const [pages, setPages] = useState<InkPage[]>(() => (doc.pages.length ? doc.pages : [newPage(undefined, true)]));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const textPages = useRef(1);
  const history = useRef<{ undo: { id: string; before: Stroke[]; after: Stroke[] }[]; redo: { id: string; before: Stroke[]; after: Stroke[] }[] }>({ undo: [], redo: [] });
  const [, setHistoryTick] = useState(0);
  const [pen, setPen] = usePenSettings();
  const [penMode, setPenMode] = useState(drawOnly);
  const [fingerDraws, setFingerDraws] = useState(() => !penSeen());
  const [paperFor, setPaperFor] = useState<number | null>(null);
  const [name, setName] = useState(file?.name ?? initialName ?? '');
  const [description, setDescription] = useState(file?.description ?? initialDescription ?? '');
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<Record<string, boolean>>({});
  // Angeklicktes Bild (zum Größe ändern / Ausrichten / Löschen).
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: DOC_EXT, mime: DOC_MIME });
  // Angeklickte Formel (wird in der Formel-Leiste bearbeitet).
  const [formula, setFormula] = useState<HTMLElement | null>(null);
  const [tex, setTex] = useState('');
  const [display, setDisplay] = useState(false);
  // Checkliste, in der der Cursor steht (für den Schalter "gemeinsam abhaken").
  const [checklist, setChecklist] = useState<HTMLUListElement | null>(null);
  const [listShared, setListShared] = useState(false);
  const checks = useChecks(file);
  const { folders, shareOf, peopleOf } = useLibrary();
  // Nur in Ordnern, die wirklich mit anderen geteilt sind, gibt es die Wahl "jeder für sich" / "gemeinsam".
  const inShared = (() => {
    const item = file ?? folders.find((f) => f.id === folderId);
    const share = item?.shareId ? shareOf(item) : undefined;
    return !!share && peopleOf(share.id).length > 1;
  })();
  // Diagramme: ausgewähltes Diagramm, Einfüge-Auswahl, Diagramm-Editor (neu oder bestehendes).
  // Eingebettetes (Diagramm/Glücksrad): ausgewähltes, Einfüge-Auswahl, Editor (neu oder bestehendes).
  const [embedEl, setEmbedEl] = useState<HTMLElement | null>(null);
  const embedData = useMemo(() => (embedEl ? embedOf(embedEl) : null), [embedEl]);
  const embedCopy = useEmbedCopy(embedData);
  const [insertKind, setInsertKind] = useState<EmbedKind | null>(null);
  const [embedEdit, setEmbedEdit] = useState<{ el: HTMLElement | null; kind: EmbedKind; embed?: EmbedData } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const katexOk = useKatex(!!formula);
  useEffect(() => {
    if (katexOk && formula) renderMathSpan(formula, true);
  }, [katexOk, formula]);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.innerHTML = sanitizeHtml(doc.html) || '<p><br></p>';
    normalizeBlocks(el);
    fixColumns(el);
    renderMathIn(el, true);
    renderEmbedsIn(el, { editable: true });
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (file && !drawOnly) el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Aktueller Zoom (Bildschirm-Pixel pro Seiten-Pixel). */
  const zoomNow = () => {
    const st = wrap.current?.querySelector('.paged-stack');
    return st ? st.getBoundingClientRect().width / PAGE_W || 1 : 1;
  };

  // ---------- Bild-Rahmen ----------
  const measure = useCallback(() => {
    if (!image || !wrap.current || !image.isConnected) {
      setBox(null);
      if (image && !image.isConnected) setImage(null);
      return;
    }
    const w = wrap.current.getBoundingClientRect();
    const r = image.getBoundingClientRect();
    setBox({ left: r.left - w.left, top: r.top - w.top, width: r.width, height: r.height });
  }, [image]);

  useLayoutEffect(() => {
    measure();
    if (!image) return;
    const scroller = wrap.current?.closest('.viewer-body');
    window.addEventListener('resize', measure);
    scroller?.addEventListener('scroll', measure);
    const ro = new ResizeObserver(() => measure());
    if (wrap.current) ro.observe(wrap.current);
    return () => {
      window.removeEventListener('resize', measure);
      scroller?.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [image, measure]);

  // ---------- Spalten ----------
  const [colBoxes, setColBoxes] = useState<ColBox[]>([]);
  // Knöpfe nur für die Tabelle, in der der Cursor steht (sie liegen über dem Text).
  const [activeCols, setActiveCols] = useState<HTMLElement | null>(null);
  const measureCols = useCallback(() => {
    const root = editor.current;
    const w = wrap.current;
    if (!root || !w) return;
    const wr = w.getBoundingClientRect();
    const next: ColBox[] = Array.from(root.querySelectorAll<HTMLElement>(':scope > div.cols')).map((box) => {
      const br = box.getBoundingClientRect();
      const rows = Array.from(box.querySelectorAll<HTMLElement>(':scope > div.row'));
      const first = rows[0] ? Array.from(rows[0].querySelectorAll<HTMLElement>(':scope > div.col')) : [];
      return {
        box,
        left: Math.round(br.left - wr.left),
        top: Math.round(br.top - wr.top),
        width: Math.round(br.width),
        height: Math.round(br.height),
        cols: first.map((col) => {
          const cr = col.getBoundingClientRect();
          return { left: Math.round(cr.left - br.left), width: Math.round(cr.width) };
        }),
        rows: rows.map((row) => {
          const rr = row.getBoundingClientRect();
          return { el: row, top: Math.round(rr.top - br.top), height: Math.round(rr.height) };
        }),
      };
    });
    setColBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
  }, []);
  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    measureCols();
    const ro = new ResizeObserver(() => measureCols());
    ro.observe(root);
    if (wrap.current) ro.observe(wrap.current); // Zoom
    // Seitlich gescrollte Spalten (schmaler Bildschirm) -> Knöpfe mitschieben.
    root.addEventListener('scroll', measureCols, true);
    window.addEventListener('resize', measureCols);
    return () => {
      ro.disconnect();
      root.removeEventListener('scroll', measureCols, true);
      window.removeEventListener('resize', measureCols);
    };
  }, [measureCols]);
  const afterColChange = () => {
    setDirty(true);
    measureCols();
    requestAnimationFrame(measureCols);
  };
  /** Befehl bei einer Auswahl über mehrere Zellen je Zelle einzeln ausführen. */
  const inCells = (fn: () => void) => () => (editor.current ? perCell(editor.current, fn) : fn());
  // Tippen, Löschen, Enter, Ausschneiden … bei einer Auswahl über Zellgrenzen: nur den markierten Text je Zelle
  // löschen (der Browser würde sonst Zellen zusammenziehen oder ganze Zellen entfernen).
  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType;
      if (!(t.startsWith('delete') || t === 'insertText' || t === 'insertParagraph' || t === 'insertLineBreak' || t === 'insertReplacementText')) return;
      if (!deleteAcrossCells(root)) return;
      e.preventDefault();
      if ((t === 'insertText' || t === 'insertReplacementText') && e.data) document.execCommand('insertText', false, e.data);
      else if (t === 'insertParagraph' || t === 'insertLineBreak') document.execCommand('insertParagraph');
      setDirty(true);
      measureCols();
      requestAnimationFrame(measureCols);
    };
    root.addEventListener('beforeinput', onBeforeInput);
    return () => root.removeEventListener('beforeinput', onBeforeInput);
  }, [measureCols]);
  const addColumnsBlock = () => {
    const root = editor.current;
    if (!root) return;
    if (formula) finishFormula();
    setImage(null);
    selectEmbed(null);
    root.focus();
    insertColumns(root);
    afterColChange();
  };
  const addCol = (box: HTMLElement, i: number, side: 'left' | 'right') => {
    editor.current?.focus();
    if (addColumn(box, i, side)) afterColChange();
  };
  const deleteCol = (box: HTMLElement, i: number) => {
    if (columnCells(box, i).some(hasContent) && !confirm('In dieser Spalte steht etwas. Spalte mit Inhalt löschen (in allen Zeilen)?')) return;
    editor.current?.focus();
    removeColumn(box, i);
    afterColChange();
  };
  const addRowAt = (row: HTMLElement, side: 'above' | 'below') => {
    editor.current?.focus();
    addRow(row, side);
    afterColChange();
  };
  const deleteRow = (row: HTMLElement) => {
    if (hasContent(row) && !confirm('In dieser Zeile steht etwas. Zeile mit Inhalt löschen?')) return;
    editor.current?.focus();
    removeRow(row);
    afterColChange();
  };

  /** Größe per Ecke/Kante ziehen – das Seitenverhältnis bleibt immer gleich. */
  const startResize = (handle: Handle) => (e: React.PointerEvent) => {
    if (!image || !editor.current) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const k = zoomNow();
    const startW = image.getBoundingClientRect().width / k;
    const ratio = image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : image.offsetHeight / Math.max(1, image.offsetWidth);
    const maxW = Math.min(editor.current.clientWidth - 40, MAX_IMAGE_H / ratio);
    const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    // Bei mittiger Ausrichtung wächst das Bild nach beiden Seiten – dann zählt die Bewegung doppelt.
    const centered = getComputedStyle(image.parentElement ?? image).textAlign === 'center' ? 2 : 1;
    const move = (ev: PointerEvent) => {
      const byX = (sx * (ev.clientX - startX) * centered) / k;
      const byY = (sy * (ev.clientY - startY)) / ratio / k;
      const delta = sx && sy ? (Math.abs(byX) > Math.abs(byY) ? byX : byY) : sx ? byX : byY;
      const w = Math.round(Math.min(maxW, Math.max(MIN_IMAGE, startW + delta)));
      image.setAttribute('width', String(w));
      image.style.removeProperty('height');
      measure();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDirty(true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // ---------- Bilder verschieben (Ziehen mit der Maus, Pfeile am Bild) ----------
  // Ein Bild steht immer in einem eigenen Absatz zwischen den anderen Blöcken – nie mitten im Text
  // (der Browser würde es sonst irgendwo zwischen zwei Buchstaben fallen lassen).
  type Spot = { host: Element; ref: Element | null; line: { left: number; top: number; width: number } };
  const dragImg = useRef<HTMLImageElement | null>(null);
  const [dropLine, setDropLine] = useState<Spot['line'] | null>(null);

  /** Wohin ein Bild beim Loslassen an dieser Bildschirmstelle kommt (vor welchen Block). */
  const dropSpot = (x: number, y: number): Spot | null => {
    const root = editor.current;
    const w = wrap.current;
    if (!root || !w) return null;
    let host: Element = root;
    const hit = document.elementFromPoint(x, y);
    const cell = hit && hit !== root && root.contains(hit) ? hit.closest('div.col') : null;
    if (cell && root.contains(cell)) host = cell;
    const kids = Array.from(host.children).filter((c) => getComputedStyle(c).display !== 'none');
    let ref: Element | null = null;
    for (const c of kids) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        ref = c;
        break;
      }
    }
    const wr = w.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const prev = ref ? ref.previousElementSibling : kids[kids.length - 1] ?? null;
    // Linie unter dem vorigen Block (liegt der nächste schon auf der nächsten Seite, bleibt sie am Ende dieser Seite)
    const top = prev ? prev.getBoundingClientRect().bottom : ref ? ref.getBoundingClientRect().top : hr.top;
    return { host, ref, line: { left: hr.left - wr.left, top: top - wr.top, width: hr.width } };
  };

  /** Absatz, aus dem ein Bild herausgenommen wurde: ist er jetzt leer, kommt er weg. */
  const tidyAfterMove = (from: Element | null) => {
    const root = editor.current;
    const block = from?.closest('p, h2, h3, li, blockquote');
    if (!root || !block || !root.contains(block) || !isEmptyBlock(block)) return;
    const host = block.parentElement;
    if (host && host.children.length === 1 && isBlockHost(host, root)) block.innerHTML = '<br>';
    else block.remove();
  };

  /** Bild als eigenen Absatz an diese Stelle setzen. */
  const moveImageTo = (img: HTMLImageElement, spot: Spot) => {
    const root = editor.current;
    if (!root || !root.contains(img)) return;
    const par = img.parentElement;
    const whole = !!par && par.tagName === 'P' && !!par.parentElement && isBlockHost(par.parentElement, root) && onlyImage(par);
    if (whole && (spot.ref === par || spot.ref === par.nextElementSibling)) return; // bleibt, wo es ist
    if (whole) spot.host.insertBefore(par, spot.ref);
    else {
      const p = document.createElement('p');
      p.appendChild(img);
      spot.host.insertBefore(p, spot.ref);
      tidyAfterMove(par);
    }
    normalize();
    setDirty(true);
    setImage(img);
    requestAnimationFrame(measure);
  };

  /** Ausgewähltes Bild einen Block nach oben/unten schieben (geht auch am Handy). */
  const stepImage = (dir: -1 | 1) => {
    const root = editor.current;
    const img = image;
    if (!root || !img || !root.contains(img)) return;
    const par = img.parentElement!;
    if (par.tagName === 'P' && par.parentElement && isBlockHost(par.parentElement, root) && onlyImage(par)) {
      const sib = dir < 0 ? par.previousElementSibling : par.nextElementSibling;
      if (!sib) return;
      if (dir < 0) sib.before(par);
      else sib.after(par);
    } else {
      // Bild steht im Text: als eigenen Absatz davor bzw. danach herauslösen
      let top: Element = par;
      while (top.parentElement && !isBlockHost(top.parentElement, root)) top = top.parentElement;
      if (top === root) return;
      const p = document.createElement('p');
      p.appendChild(img);
      if (dir < 0) top.before(p);
      else top.after(p);
      tidyAfterMove(par);
    }
    normalize();
    setDirty(true);
    requestAnimationFrame(() => {
      img.scrollIntoView({ block: 'nearest' });
      measure();
    });
  };

  /** Bilder (Dateien) direkt an der Stelle einfügen, an der sie losgelassen wurden. */
  const dropFiles = async (files: File[], spot: Spot) => {
    for (const f of files) {
      const url = await imageToDataUrl(f);
      if (!url) {
        setErr('Dieses Bild konnte nicht gelesen werden.');
        continue;
      }
      const p = document.createElement('p');
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      p.appendChild(img);
      spot.host.insertBefore(p, spot.ref);
    }
    normalize();
    setDirty(true);
  };

  const dnd = useRef({ dropSpot, moveImageTo, dropFiles });
  dnd.current = { dropSpot, moveImageTo, dropFiles };
  useEffect(() => {
    const root = editor.current;
    const w = wrap.current;
    if (!root || !w) return;
    const start = (e: DragEvent) => {
      const t = e.target;
      dragImg.current = t instanceof HTMLImageElement && root.contains(t) && !t.closest(EMBED_SELECTOR) ? t : null;
    };
    const wanted = (e: DragEvent) => !drawingRef.current && (!!dragImg.current || !!e.dataTransfer?.types.includes('Files'));
    const over = (e: DragEvent) => {
      if (!wanted(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = dragImg.current ? 'move' : 'copy';
      const spot = dnd.current.dropSpot(e.clientX, e.clientY);
      setDropLine((prev) => (spot && prev && prev.top === spot.line.top && prev.left === spot.line.left ? prev : spot?.line ?? null));
    };
    const leave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node) || !w.contains(e.relatedTarget)) setDropLine(null);
    };
    const drop = (e: DragEvent) => {
      if (!wanted(e)) return;
      const img = dragImg.current;
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!img && !files.length) return;
      e.preventDefault();
      e.stopPropagation();
      setDropLine(null);
      dragImg.current = null;
      const spot = dnd.current.dropSpot(e.clientX, e.clientY);
      if (!spot) return;
      if (img) dnd.current.moveImageTo(img, spot);
      else void dnd.current.dropFiles(files, spot);
    };
    const end = () => {
      dragImg.current = null;
      setDropLine(null);
    };
    root.addEventListener('dragstart', start);
    w.addEventListener('dragover', over);
    w.addEventListener('dragleave', leave);
    w.addEventListener('drop', drop, true);
    document.addEventListener('dragend', end);
    return () => {
      root.removeEventListener('dragstart', start);
      w.removeEventListener('dragover', over);
      w.removeEventListener('dragleave', leave);
      w.removeEventListener('drop', drop, true);
      document.removeEventListener('dragend', end);
    };
  }, []);

  // Zu hohe Bilder an die Seite anpassen (beim Öffnen, Einfügen, Drehen …)
  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement && root.contains(e.target)) fitImage(e.target);
    };
    root.addEventListener('load', onLoad, true);
    root.querySelectorAll('img').forEach((img) => img.complete && fitImage(img));
    return () => root.removeEventListener('load', onLoad, true);
  }, []);

  // Nach jedem Seitenumbruch: Bild-Rahmen und Spalten-Knöpfe an die neue Lage anpassen
  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    const on = () => {
      measure();
      measureCols();
    };
    root.addEventListener('paginated', on);
    return () => root.removeEventListener('paginated', on);
  }, [measure, measureCols]);

  // ---------- Bild drehen / spiegeln ----------
  // Das Bild wird neu gezeichnet und ersetzt – so sieht es überall gleich aus (auch in älteren App-Versionen).
  const [turning, setTurning] = useState(false);
  const transformImage = async (op: 'left' | 'right' | 'flipH' | 'flipV') => {
    const img = image;
    if (!img || turning) return;
    setTurning(true);
    try {
      if (!img.complete) await img.decode().catch(() => {});
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) throw new Error('leer');
      const rotate = op === 'left' || op === 'right';
      const canvas = document.createElement('canvas');
      canvas.width = rotate ? h : w;
      canvas.height = rotate ? w : h;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      if (op === 'right') ctx.rotate(Math.PI / 2);
      if (op === 'left') ctx.rotate(-Math.PI / 2);
      if (op === 'flipH') ctx.scale(-1, 1);
      if (op === 'flipV') ctx.scale(1, -1);
      ctx.drawImage(img, -w / 2, -h / 2);
      const src = img.getAttribute('src') ?? '';
      // PNG behält Transparenz, alles andere wird JPEG (kleiner).
      const url = /^data:image\/(png|gif)/i.test(src) ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
      // Beim Drehen bleibt die angezeigte Größe gleich: Die neue Breite ist die bisherige Höhe.
      if (rotate && img.hasAttribute('width')) img.setAttribute('width', String(Math.max(24, Math.round(img.getBoundingClientRect().height / zoomNow()))));
      await new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
        img.src = url;
      });
      img.onload = img.onerror = null;
      setDirty(true);
      measure();
    } catch {
      setErr('Das Bild konnte nicht gedreht werden.');
    } finally {
      setTurning(false);
    }
  };

  // ---------- Formatierung ----------
  useEffect(() => {
    const update = () => {
      if (!editor.current?.contains(document.getSelection()?.anchorNode ?? null)) return;
      const block = String(document.queryCommandValue('formatBlock')).toLowerCase();
      const ul = listAt();
      const isCheck = !!ul?.classList.contains('checklist');
      const anchorNode = document.getSelection()?.anchorNode ?? null;
      const anchorEl = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
      setActiveCols((anchorEl?.closest('div.cols') as HTMLElement | null) ?? null);
      setChecklist(isCheck ? ul : null);
      setListShared(isCheck && ul!.dataset.shared === '1');
      setState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        h2: block === 'h2',
        ul: document.queryCommandState('insertUnorderedList') && !isCheck,
        check: isCheck,
        ol: document.queryCommandState('insertOrderedList'),
        center: document.queryCommandState('justifyCenter'),
        right: document.queryCommandState('justifyRight'),
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  const cmd = (command: string, value?: string) => {
    editor.current?.focus();
    // Einfügen ersetzt die Auswahl – geht sie über Zellgrenzen, zuerst nur den markierten Text je Zelle löschen.
    if (editor.current && /^insert(?!(Un)?OrderedList)/.test(command)) deleteAcrossCells(editor.current);
    document.execCommand(command, false, value);
    normalize();
    setDirty(true);
    requestAnimationFrame(measure);
  };
  /** Listen, die der Browser in einen Absatz gelegt hat, herauslösen (sonst stimmen die Einzüge nicht). Cursor bleibt, wo er war. */
  const normalize = () => {
    const el = editor.current;
    if (!el) return;
    const sel = document.getSelection();
    const node = sel?.anchorNode ?? null;
    const off = sel?.anchorOffset ?? 0;
    fixColumns(el);
    if (normalizeBlocks(el) && sel && node && el.contains(node)) {
      try {
        sel.collapse(node, off);
      } catch {
        /* Cursor nicht wiederherstellbar */
      }
    }
  };

  // ---------- Einrücken (Tab / Umschalt+Tab und Knöpfe) ----------
  const MAX_INDENT = 8;
  const indent = (out: boolean) => {
    editor.current?.focus();
    const n = document.getSelection()?.anchorNode ?? null;
    const el = n instanceof HTMLElement ? n : n?.parentElement;
    const li = el?.closest('li');
    if (li && editor.current?.contains(li)) {
      // In Listen: Punkt eine Ebene tiefer/höher (verschachtelte Liste).
      cmd(out ? 'outdent' : 'indent');
      // Verschachtelte Listen in Checklisten sind auch Checklisten (gleicher Modus).
      editor.current?.querySelectorAll<HTMLElement>('ul.checklist ul:not(.checklist)').forEach((ul) => {
        const top = ul.parentElement?.closest('ul.checklist') as HTMLElement | null;
        ul.classList.add('checklist');
        if (top?.dataset.shared === '1') ul.dataset.shared = '1';
      });
      refreshChecks();
      return;
    }
    // Sonst: ganze Absätze/Überschriften einrücken (alle markierten, sonst den mit dem Cursor).
    const block = el?.closest('p, h2, h3') as HTMLElement | null;
    const many = document.getSelection()?.isCollapsed === false ? selectedLines() : [];
    const blocks = many.length ? many : block && editor.current?.contains(block) ? [block] : [];
    for (const b of blocks) {
      const level = Math.max(0, Math.min(MAX_INDENT, Number(b.dataset.indent || 0) + (out ? -1 : 1)));
      if (level) b.dataset.indent = String(level);
      else delete b.dataset.indent;
    }
    if (blocks.length) setDirty(true);
  };
  // ---------- Checklisten ----------
  /** Liste (ul), in der der Cursor steht. */
  function listAt(): HTMLUListElement | null {
    const n = document.getSelection()?.anchorNode ?? null;
    const el = n instanceof HTMLElement ? n : n?.parentElement;
    const ul = el?.closest('ul') as HTMLUListElement | null;
    return ul && editor.current?.contains(ul) ? ul : null;
  }
  /** Jeder Punkt einer Checkliste braucht eine eigene ID (an ihr hängen die Häkchen). Enter kopiert IDs mit – doppelte erneuern. */
  const ensureIds = () => {
    const seen = new Set<string>();
    editor.current?.querySelectorAll<HTMLLIElement>('ul.checklist > li').forEach((li) => {
      if (!li.dataset.id || seen.has(li.dataset.id)) li.dataset.id = newId().replace(/-/g, '').slice(0, 16);
      seen.add(li.dataset.id);
    });
  };
  const refreshChecks = () => {
    if (!editor.current) return;
    ensureIds();
    applyChecks(editor.current, checks.isDone);
  };
  useEffect(() => {
    if (editor.current) applyChecks(editor.current, checks.isDone);
  }, [checks.isDone]);

  const toggleChecklist = () => {
    editor.current?.focus();
    const ul = listAt();
    if (ul?.classList.contains('checklist')) {
      cmd('insertUnorderedList'); // Liste aufheben
    } else {
      if (!ul) document.execCommand('insertUnorderedList');
      const now = listAt();
      if (now) {
        now.classList.add('checklist');
        if (inShared && checklist?.dataset.shared === '1') now.dataset.shared = '1';
      }
      setDirty(true);
    }
    refreshChecks();
    setChecklist(listAt()?.classList.contains('checklist') ? listAt() : null);
    setState((st) => ({ ...st, check: !!listAt()?.classList.contains('checklist'), ul: false }));
  };
  const bulletList = () => {
    const ul = listAt();
    if (ul?.classList.contains('checklist')) {
      // Checkliste -> normale Aufzählung
      ul.classList.remove('checklist');
      delete ul.dataset.shared;
      ul.querySelectorAll('li.done').forEach((li) => li.classList.remove('done'));
      setChecklist(null);
      setState((st) => ({ ...st, check: false, ul: true }));
      setDirty(true);
      return;
    }
    cmd('insertUnorderedList');
  };
  const setShared = (shared: boolean) => {
    if (!checklist) return;
    if (shared) checklist.dataset.shared = '1';
    else delete checklist.dataset.shared;
    setListShared(shared);
    setDirty(true);
    refreshChecks();
  };
  const tick = (li: HTMLLIElement) => {
    ensureIds();
    if (!checks.enabled) {
      setErr('Abhaken geht, sobald das Dokument gespeichert ist.');
      return;
    }
    checks.toggle(li.dataset.id!, li.parentElement?.dataset.shared === '1');
  };

  // ---------- Diagramme & Glücksräder ----------
  const selectEmbed = (el: HTMLElement | null) => {
    editor.current?.querySelectorAll('figure.selected').forEach((x) => x !== el && x.classList.remove('selected'));
    el?.classList.add('selected');
    setEmbedEl(el);
  };
  /** Cursor-Position merken, bevor ein Dialog den Fokus nimmt. */
  const rememberCursor = () => {
    const sel = document.getSelection();
    savedRange.current = sel && sel.rangeCount && editor.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restoreCursor = () => {
    editor.current?.focus();
    const r = savedRange.current;
    const sel = document.getSelection();
    if (r && sel && editor.current?.contains(r.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (sel && editor.current) {
      // ans Ende
      const end = document.createRange();
      end.selectNodeContents(editor.current);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
  };
  const insertEmbeds = (list: EmbedData[]) => {
    if (!list.length) return;
    restoreCursor();
    cmd('insertHTML', list.map(embedFigure).join('') + '<p><br></p>');
    if (editor.current) renderEmbedsIn(editor.current, { editable: true });
    selectEmbed(null);
  };
  const editEmbedDone = (e: EmbedData) => {
    const target = embedEdit?.el;
    setEmbedEdit(null);
    if (target && target.isConnected) {
      target.setAttribute(`data-${e.kind}`, embedJson(e));
      renderEmbedsIn(editor.current!, { editable: true });
      setEmbedEl(null);
      setTimeout(() => selectEmbed(target), 0);
      setDirty(true);
    } else insertEmbeds([e]);
  };
  const deleteEmbed = () => {
    embedEl?.remove();
    setEmbedEl(null);
    setDirty(true);
  };

  // Aktuellen Absatztyp direkt abfragen (der gemerkte Zustand kann nach Enter veraltet sein).
  const toggleBlock = (tag: 'h2' | 'h3') => {
    editor.current?.focus();
    const lines = selectedLines();
    // Mehrere Zeilen markiert: jede Zeile einzeln umwandeln (der Browser würde sie sonst zu einer Überschrift
    // mit Zeilenumbrüchen zusammenziehen).
    if (lines.length > 1) {
      const target = lines.every((l) => l.tagName.toLowerCase() === tag) ? 'p' : tag;
      const sel = document.getSelection()!;
      for (const line of lines) {
        if (!line.isConnected) continue;
        const r = document.createRange();
        r.selectNodeContents(line);
        sel.removeAllRanges();
        sel.addRange(r);
        cmd('formatBlock', target);
      }
      return;
    }
    const current = String(document.queryCommandValue('formatBlock')).toLowerCase();
    cmd('formatBlock', current === tag ? 'p' : tag);
  };
  /** Absätze/Überschriften (nicht in Listen), die die Auswahl berührt. */
  const selectedLines = (): HTMLElement[] => {
    const root = editor.current;
    const sel = document.getSelection();
    if (!root || !sel?.rangeCount) return [];
    const r = sel.getRangeAt(0);
    return Array.from(root.querySelectorAll<HTMLElement>('p, h2, h3')).filter((b) => {
      if (b.closest('li') || !r.intersectsNode(b)) return false;
      // Endet die Auswahl ganz am Anfang dieser Zeile (z. B. nach Dreifachklick), zählt sie nicht mit.
      if (!r.collapsed && b.contains(r.endContainer)) {
        const head = document.createRange();
        head.setStart(b, 0);
        head.setEnd(r.endContainer, r.endOffset);
        if (!head.toString() && !head.cloneContents().querySelector('img, span.math')) return false;
      }
      return true;
    });
  };

  /** Absatz eines Bildes (Bilder direkt im Dokument werden in einen Absatz gepackt). */
  const blockOf = (img: HTMLImageElement): HTMLElement => {
    let el: HTMLElement | null = img.parentElement;
    while (el && el !== editor.current && !/^(P|H2|H3|LI|BLOCKQUOTE)$/.test(el.tagName)) el = el.parentElement;
    if (el && el !== editor.current) return el;
    const p = document.createElement('p');
    img.replaceWith(p);
    p.appendChild(img);
    return p;
  };

  const align = (a: Align) => {
    if (image) {
      const block = blockOf(image);
      if (a === 'left') block.style.removeProperty('text-align');
      else block.style.textAlign = a;
      setDirty(true);
      measure();
      setState((s) => ({ ...s, center: a === 'center', right: a === 'right' }));
      return;
    }
    cmd(a === 'center' ? 'justifyCenter' : a === 'right' ? 'justifyRight' : 'justifyLeft');
  };

  const insertImages = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const url = await imageToDataUrl(f);
      if (!url) {
        setErr('Dieses Bild konnte nicht gelesen werden.');
        continue;
      }
      cmd('insertHTML', `<p><img src="${url}" alt=""></p><p><br></p>`);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    // Auswahl über mehrere Zellen: erst den markierten Text je Zelle löschen, dann normal einfügen.
    if (editor.current && deleteAcrossCells(editor.current)) {
      setDirty(true);
      measureCols();
    }
    // Diagramm/Glücksrad aus der App? (vor Bildern prüfen – Kopien bringen auch ein Bild mit)
    const embed = embedFromPaste(e.clipboardData);
    if (embed && embed !== 'html') {
      e.preventDefault();
      rememberCursor();
      insertEmbeds([embed]);
      return;
    }
    if (embed === 'html') {
      e.preventDefault();
      cmd('insertHTML', sanitizeHtml(e.clipboardData.getData('text/html')));
      if (editor.current) renderEmbedsIn(editor.current, { editable: true });
      refreshChecks();
      return;
    }
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      insertImages(imgs);
      return;
    }
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      cmd('insertHTML', sanitizeHtml(html));
      if (editor.current) renderEmbedsIn(editor.current, { editable: true });
      refreshChecks();
    }
  };

  // ---------- Formeln ----------
  const selectFormula = (el: HTMLElement | null) => {
    editor.current?.querySelectorAll('span.math.selected').forEach((x) => x !== el && x.classList.remove('selected'));
    if (formula && formula !== el && !(formula.dataset.tex ?? '').trim()) formula.remove();
    setFormula(el);
    if (!el) return;
    el.classList.add('selected');
    setTex(el.dataset.tex ?? '');
    setDisplay(el.dataset.display === '1');
    setImage(null);
  };
  /** Formel an der Cursor-Position (bzw. statt der Auswahl) einfügen. */
  const insertFormula = (source = '', select = true) => {
    loadKatex().catch(() => {});
    cmd('insertHTML', `<span class="math" data-tex="${attr(source)}" data-new="1"></span>\u200b`);
    const el = editor.current?.querySelector<HTMLElement>('span.math[data-new]');
    if (!el) return;
    delete el.dataset.new;
    renderMathSpan(el, true);
    if (select) selectFormula(el);
  };
  const updateFormula = (patch: { tex?: string; display?: boolean }) => {
    if (!formula) return;
    if (patch.tex !== undefined) {
      setTex(patch.tex);
      formula.dataset.tex = patch.tex;
    }
    if (patch.display !== undefined) {
      setDisplay(patch.display);
      if (patch.display) formula.dataset.display = '1';
      else delete formula.dataset.display;
    }
    renderMathSpan(formula, true);
    setDirty(true);
  };
  const finishFormula = () => {
    const el = formula;
    selectFormula(null);
    if (!el || !el.isConnected) return;
    el.classList.remove('selected');
    if (!(el.dataset.tex ?? '').trim()) return el.remove();
    // Cursor hinter die Formel setzen.
    editor.current?.focus();
    const r = document.createRange();
    r.setStartAfter(el);
    r.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };
  const deleteFormula = () => {
    formula?.remove();
    setFormula(null);
    setDirty(true);
  };
  /** Gerade "$…$" getippt? Dann in eine Formel umwandeln (gleiche Regeln wie bei Karteikarten). */
  const autoFormula = () => {
    const sel = document.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== Node.TEXT_NODE) return;
    const off = sel.anchorOffset;
    const before = (node.textContent ?? '').slice(0, off);
    if (!before.endsWith('$') || before.endsWith('\\$')) return;
    const open = before.lastIndexOf('$', off - 2);
    if (open < 0 || before[open - 1] === '$' || before[open - 1] === '\\') return;
    const source = before.slice(open + 1, off - 1);
    if (!source || blank(source[0]) || blank(source[source.length - 1]) || source.endsWith('\\')) return;
    const r = document.createRange();
    r.setStart(node, open);
    r.setEnd(node, off);
    sel.removeAllRanges();
    sel.addRange(r);
    insertFormula(source, false);
  };

  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const box = checkboxHit(e);
    if (box && editor.current?.contains(box)) {
      e.preventDefault();
      tick(box);
      return;
    }
    const fig = t.closest?.(EMBED_SELECTOR) as HTMLElement | null;
    if (fig && editor.current?.contains(fig)) {
      if (formula) finishFormula();
      setImage(null);
      selectEmbed(fig);
      return;
    }
    if (embedEl) selectEmbed(null);
    const math = t.closest?.('span.math') as HTMLElement | null;
    if (math && editor.current?.contains(math)) {
      selectFormula(math);
      return;
    }
    if (formula) finishFormula();
    if (t instanceof HTMLImageElement) {
      setImage(t);
      const block = t.closest('p, h2, h3, li, blockquote') as HTMLElement | null;
      const a = block?.style.textAlign;
      setState((s) => ({ ...s, center: a === 'center', right: a === 'right' }));
    } else setImage(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Umschalt+Enter wie Enter: immer eine neue Zeile (Absatz) – Abstand gibt es mit zweimal Enter.
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !image && !embedEl) {
      e.preventDefault();
      cmd('insertParagraph');
      return;
    }
    // ⌫/Entf am Rand einer Spalte bzw. direkt unter/über Spalten: nichts zusammenlegen.
    if ((e.key === 'Backspace' || e.key === 'Delete') && !image && !embedEl && editor.current && blockColumnMerge(editor.current, e.key)) {
      e.preventDefault();
      afterColChange();
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !image && !embedEl) {
      e.preventDefault();
      inCells(() => indent(e.shiftKey))();
      return;
    }
    if (embedEl) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteEmbed();
      } else if (e.key !== 'Shift') selectEmbed(null);
      return;
    }
    if (!image) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const par = image.parentElement;
      image.remove();
      tidyAfterMove(par);
      setImage(null);
      setDirty(true);
    } else if (e.key !== 'Shift') setImage(null);
  };

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib dem Dokument einen Namen.');
    const html = sanitizeHtml(editor.current?.innerHTML ?? '');
    if (await save(name, new Blob([joinDoc(html, pagesRef.current)], { type: DOC_MIME }), description)) onClose();
  };

  // ---------- Handschrift ----------
  const onLayout = useCallback((n: number) => {
    textPages.current = n;
    setPages((cur) => fitPages(cur, n));
  }, []);
  // Zuletzt gezeichnet (nicht getippt)? Dann macht Strg+Z auch im Text-Modus den Strich rückgängig.
  const lastWasInk = useRef(false);
  const onInk = useCallback((i: number, strokes: Stroke[]) => {
    const page = pagesRef.current[i];
    if (!page) return;
    lastWasInk.current = true;
    history.current.undo.push({ id: page.id, before: page.strokes, after: strokes });
    if (history.current.undo.length > 200) history.current.undo.shift();
    history.current.redo = [];
    setHistoryTick((t) => t + 1);
    setPages((cur) => cur.map((p) => (p.id === page.id ? { ...p, strokes, auto: undefined } : p)));
    setDirty(true);
  }, []);
  const stepInk = (dir: 'undo' | 'redo') => {
    const h = history.current;
    const entry = (dir === 'undo' ? h.undo : h.redo).pop();
    if (!entry) return;
    (dir === 'undo' ? h.redo : h.undo).push(entry);
    setHistoryTick((t) => t + 1);
    setPages((cur) => cur.map((p) => (p.id === entry.id ? { ...p, strokes: dir === 'undo' ? entry.before : entry.after } : p)));
    setDirty(true);
  };

  // ---------- Seiten einfügen / löschen / verschieben ----------
  /** order: alte Seitennummern in neuer Reihenfolge (-1 = neue Seite). Text und Handschrift wandern mit. */
  const reorder = (order: number[], fresh?: InkPage) => {
    const el = editor.current;
    if (!el) return;
    if (formula) finishFormula();
    setImage(null);
    selectEmbed(null);
    reorderPages(el, textPages.current, order);
    normalize();
    refreshChecks();
    const cur = fitPages(pagesRef.current, textPages.current);
    const next = order.map((i) => (i >= 0 ? cur[i] ?? newPage(cur[cur.length - 1]) : fresh ?? newPage(cur[cur.length - 1])));
    setPages(next.map((p) => (p.auto ? { ...p, auto: undefined } : p)));
    setDirty(true);
    afterColChange();
  };
  const pageCount = () => Math.max(pagesRef.current.length, textPages.current);
  const pageEditing: PageEditing = {
    insert: (at) => {
      const n = pageCount();
      const cur = pagesRef.current;
      const like = cur[Math.max(0, Math.min(cur.length - 1, at - 1))];
      reorder([...Array.from({ length: at }, (_, i) => i), -1, ...Array.from({ length: n - at }, (_, i) => at + i)], newPage(like));
    },
    remove: (i) => {
      const n = pageCount();
      if (n <= 1) {
        setErr('Die einzige Seite kann nicht gelöscht werden.');
        return;
      }
      if (!confirm(`Seite ${i + 1} löschen? Text und Handschrift auf dieser Seite werden gelöscht.`)) return;
      reorder(Array.from({ length: n }, (_, k) => k).filter((k) => k !== i));
    },
    move: (from, to) => {
      const order = Array.from({ length: pageCount() }, (_, k) => k);
      order.splice(from, 1);
      order.splice(to, 0, from);
      reorder(order);
    },
    paper: (i) => setPaperFor(i),
  };
  const applyPaper = (bg: InkPage['bg'], paper: string, all: boolean) => {
    const i = paperFor;
    setPaperFor(null);
    if (i === null) return;
    setPages((cur) => fitPages(cur, textPages.current).map((p, k) => (all || k === i ? { ...p, bg, paper, auto: undefined } : p)));
    setDirty(true);
  };
  const drawing = drawOnly || penMode;
  // Strg+Z / Strg+Y (bzw. Strg+Umschalt+Z, ⌘ am Mac) für die Handschrift
  const stepInkRef = useRef(stepInk);
  stepInkRef.current = stepInk;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = key === 'y' || (key === 'z' && e.shiftKey);
      if (key !== 'z' && key !== 'y') return;
      // In Eingabefeldern (Titel, Formel …) bleibt Strg+Z beim Feld
      const t = e.target as HTMLElement | null;
      if (typesText(t)) return;
      const h = history.current;
      const inkTurn = drawingRef.current || lastWasInk.current || (redo && h.redo.length > 0 && !editor.current?.contains(document.activeElement));
      if (!inkTurn) return;
      e.preventDefault();
      e.stopPropagation();
      stepInkRef.current(redo ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const inkInput: InkInput = useMemo(
    () => ({ pen: true, mouse: drawing, touch: drawing && fingerDraws, settings: pen, onChange: onInk }),
    [drawing, fingerDraws, pen, onInk],
  );

  const tools: ({ icon: IconName; label: string; on?: boolean; run: () => void } | 'sep')[] = [
    { icon: 'undo', label: 'Rückgängig', run: () => cmd('undo') },
    { icon: 'redo', label: 'Wiederholen', run: () => cmd('redo') },
    'sep',
    { icon: 'bold', label: 'Fett', on: state.bold, run: () => cmd('bold') },
    { icon: 'italic', label: 'Kursiv', on: state.italic, run: () => cmd('italic') },
    { icon: 'underline', label: 'Unterstrichen', on: state.underline, run: () => cmd('underline') },
    { icon: 'heading', label: 'Überschrift', on: state.h2, run: inCells(() => toggleBlock('h2')) },
    'sep',
    { icon: 'alignLeft', label: 'Linksbündig', on: !state.center && !state.right, run: inCells(() => align('left')) },
    { icon: 'alignCenter', label: 'Zentriert', on: state.center, run: inCells(() => align('center')) },
    { icon: 'alignRight', label: 'Rechtsbündig', on: state.right, run: inCells(() => align('right')) },
    'sep',
    { icon: 'listBullet', label: 'Aufzählung', on: state.ul, run: inCells(bulletList) },
    { icon: 'listNumber', label: 'Nummerierung', on: state.ol, run: inCells(() => cmd('insertOrderedList')) },
    { icon: 'checklist', label: 'Checkliste', on: state.check, run: inCells(toggleChecklist) },
    { icon: 'outdent', label: 'Ausrücken (Umschalt+Tab)', run: inCells(() => indent(true)) },
    { icon: 'indent', label: 'Einrücken (Tab)', run: inCells(() => indent(false)) },
    'sep',
    { icon: 'image', label: 'Bild einfügen', run: () => imageInput.current?.click() },
    // Auf Handys/Tablets: direkt die Kamera öffnen – das Foto landet sofort im Dokument (nicht erst in der Galerie).
    ...(isTouchDevice ? [{ icon: 'camera' as const, label: 'Foto aufnehmen', run: () => cameraInput.current?.click() }] : []),
    {
      icon: 'chart',
      label: 'Diagramm einfügen',
      run: () => {
        rememberCursor();
        setInsertKind('chart');
      },
    },
    {
      icon: 'wheel',
      label: 'Glücksrad einfügen',
      run: () => {
        rememberCursor();
        setInsertKind('wheel');
      },
    },
    { icon: 'sigma', label: 'Formel einfügen', on: !!formula, run: () => (formula ? finishFormula() : insertFormula()) },
    { icon: 'columns', label: 'Spalten / Tabelle einfügen', run: addColumnsBlock },
  ];

  const textBar = (
    <>
          <div className="doc-toolbar" role="toolbar" aria-label="Formatierung" data-no-swipe>
            {tools.map((t, i) =>
              t === 'sep' ? (
                <span key={i} className="toolbar-sep" aria-hidden="true" />
              ) : (
                <button
                  key={t.label}
                  type="button"
                  className={`icon-btn${t.on ? ' on' : ''}`}
                  aria-label={t.label}
                  title={t.label}
                  aria-pressed={t.on}
                  // mousedown verhindern, damit die Auswahl im Text erhalten bleibt
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={t.run}
                >
                  <Icon name={t.icon} size={19} />
                </button>
              ),
            )}
          </div>
    </>
  );
  const penBar = (
    <PenBar
      settings={pen}
      onChange={setPen}
      onUndo={() => stepInk('undo')}
      onRedo={() => stepInk('redo')}
      canUndo={history.current.undo.length > 0}
      canRedo={history.current.redo.length > 0}
      extra={
        <div className="finger-toggle" title="Ohne Stift: mit dem Finger zeichnen. Mit Stift: Finger scrollt.">
          <span>Finger zeichnet</span>
          <input type="checkbox" className="switch" checked={fingerDraws} onChange={(e) => setFingerDraws(e.target.checked)} aria-label="Mit dem Finger zeichnen" />
        </div>
      }
    />
  );

  return (
    <StudyScreen
      editing={file}
      title={drawOnly ? `Zeichnen: ${name || 'Dokument'}` : file ? 'Dokument bearbeiten' : 'Neues Text-Dokument'}
      onClose={close}
      bodyClass="doc-body"
      actions={
        <>
          {file && !drawOnly && <DetailsButton file={file} onRenamed={setName} onDeleted={onClose} />}
          <button className="btn primary small" onClick={submit} disabled={busy}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
      bar={
        <div className="doc-bars">
          {!drawOnly && (
            <div className="segmented mode-seg" role="radiogroup" aria-label="Eingabe">
              <button type="button" className={!penMode ? 'active' : ''} aria-pressed={!penMode} onMouseDown={(e) => e.preventDefault()} onClick={() => setPenMode(false)}>
                <Icon name="textMode" size={16} /> Text
              </button>
              <button type="button" className={penMode ? 'active' : ''} aria-pressed={penMode} onMouseDown={(e) => e.preventDefault()} onClick={() => {
                  // Tippen beenden: Cursor/Tastatur weg, Auswahlen (Bild, Formel, Tabelle) aufheben
                  if (formula) finishFormula();
                  setImage(null);
                  selectEmbed(null);
                  setActiveCols(null);
                  (document.activeElement as HTMLElement | null)?.blur?.();
                  document.getSelection()?.removeAllRanges();
                  setPenMode(true);
                }}>
                <Icon name="scribble" size={16} /> Stift
              </button>
            </div>
          )}
          {drawing ? penBar : textBar}
          {formula && (
            <div className="card formula-bar" data-no-swipe>
              <div className="field-label">
                <span>Formel (LaTeX)</span>
                <span className="muted small">{String.raw`z. B. \frac{a}{b}, x^2, \sqrt{x}, \int_0^1`}</span>
              </div>
              <textarea
                autoFocus
                rows={2}
                value={tex}
                placeholder="\int_0^1 x^2\,dx = \frac{1}{3}"
                onChange={(e) => updateFormula({ tex: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finishFormula();
                  } else if (e.key === 'Escape') finishFormula();
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className="toggle-row small-toggle">
                <span>In eigener Zeile (zentriert)</span>
                <input type="checkbox" className="switch" checked={display} onChange={(e) => updateFormula({ display: e.target.checked })} />
              </div>
              <div className="input-row">
                <button className="btn ghost danger" onClick={deleteFormula}>
                  <Icon name="trash" size={18} /> Löschen
                </button>
                <button className="btn primary grow" onClick={finishFormula}>
                  Fertig
                </button>
              </div>
            </div>
          )}
          {checklist && inShared && (
            <div className="card checklist-bar" data-no-swipe onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
              <div className="segmented" role="radiogroup" aria-label="Wer hakt ab?">
                <button type="button" className={!listShared ? 'active' : ''} aria-pressed={!listShared} onMouseDown={(e) => e.preventDefault()} onClick={() => setShared(false)}>
                  <Icon name="user" size={16} /> Jeder für sich
                </button>
                <button type="button" className={listShared ? 'active' : ''} aria-pressed={listShared} onMouseDown={(e) => e.preventDefault()} onClick={() => setShared(true)}>
                  <Icon name="users" size={16} /> Gemeinsam
                </button>
              </div>
              <p className="muted small">
                {listShared
                  ? 'Häkchen gelten für alle Personen im geteilten Ordner.'
                  : 'Jede Person hakt für sich ab – deine Häkchen siehst nur du (auf allen deinen Geräten).'}
              </p>
            </div>
          )}
          {embedEl && embedData && (
            <div className="card chart-bar" data-no-swipe>
              <strong className="grow ellipsis">
                <Icon name={embedData.kind === 'chart' ? 'chart' : 'wheel'} size={16} /> {embedTitle(embedData)}
              </strong>
              <button className="btn ghost small danger" onClick={deleteEmbed}>
                <Icon name="trash" size={16} /> Löschen
              </button>
              <button className="btn ghost small" onClick={embedCopy.run} disabled={!embedCopy.prepared}>
                <Icon name={embedCopy.done ? 'check' : 'copy'} size={16} /> {embedCopy.done ? 'Kopiert' : 'Kopieren'}
              </button>
              <button className="btn primary small" onClick={() => setEmbedEdit({ el: embedEl, kind: embedData.kind, embed: embedData })}>
                <Icon name="edit" size={16} /> Bearbeiten
              </button>
            </div>
          )}
          {!drawOnly && !penMode && <p className="muted small bar-hint">Mit dem Stift kannst du jederzeit direkt auf die Seiten schreiben.</p>}
        </div>
      }
    >
      <div className="doc-editor">
        {!drawOnly && (
          <>
            <TextLine autoFocus={!file} value={name} onChange={(v) => (setName(v), setDirty(true))} placeholder="Titel des Dokuments" maxLength={120} className="doc-title" enterKeyHint="next" onEnter={() => editor.current?.focus()} />
            <TextLine
              value={description}
              onChange={(v) => (setDescription(v), setDirty(true))}
              placeholder="Beschreibung (optional)"
              maxLength={500}
              className="doc-desc"
              enterKeyHint="next"
              onEnter={() => editor.current?.focus()}
            />
          </>
        )}
        <PagedDoc
          pages={pages}
          flowRef={editor}
          onLayout={onLayout}
          editing={pageEditing}
          ink={inkInput}
          sizerRef={wrap}
          overlay={
            <>
              {colBoxes.filter((b) => b.box === activeCols).map((b, bi) => {
                const n = b.cols.length;
                const btn = (label: string, icon: IconName, run: () => void, danger = false) => (
                  <button type="button" className={`icon-btn small${danger ? ' danger' : ''}`} aria-label={label} title={label} onClick={run}>
                    <Icon name={icon} size={icon === 'trash' ? 15 : 16} />
                  </button>
                );
                return (
                  <div key={bi} data-no-swipe onMouseDown={(e) => e.preventDefault()}>
                    <div className="cols-active" style={{ left: b.left - 4, top: b.top - 4, width: b.width + 8, height: b.height + 8 }} />
                    {/* Oben: pro Spalte löschen / rechts einfügen, ganz links zusätzlich links einfügen */}
                    <div className="cols-overlay cols-top" style={{ left: b.left, top: b.top - 34, width: b.width }}>
                      {b.cols.map((c, ci) => (
                        <div key={ci} className="col-bar" style={{ left: c.left, width: c.width }}>
                          {ci === 0 && n < MAX_COLS ? btn('Spalte links einfügen', 'colAddLeft', () => addCol(b.box, ci, 'left')) : <span className="col-bar-gap" />}
                          {btn('Spalte löschen', 'trash', () => deleteCol(b.box, ci), true)}
                          {n < MAX_COLS ? btn('Spalte rechts einfügen', 'colAddRight', () => addCol(b.box, ci, 'right')) : <span className="col-bar-gap" />}
                        </div>
                      ))}
                    </div>
                    {/* Links: Ecke = Zeile oben einfügen; pro Zeile löschen / darunter einfügen */}
                    <div className="cols-overlay cols-corner" style={{ left: b.left - 32, top: b.top - 34 }}>
                      {b.rows[0] && btn('Zeile oben einfügen', 'rowAddAbove', () => addRowAt(b.rows[0].el, 'above'))}
                    </div>
                    <div className="cols-overlay cols-side" style={{ left: b.left - 32, top: b.top, height: b.height }}>
                      {b.rows.map((r, ri) => (
                        <div key={ri} className="row-bar" style={{ top: r.top, height: r.height }}>
                          {btn('Zeile löschen', 'trash', () => deleteRow(r.el), true)}
                          {btn('Zeile darunter einfügen', 'rowAddBelow', () => addRowAt(r.el, 'below'))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {dropLine && <div className="img-drop-line" style={{ left: dropLine.left, top: dropLine.top, width: dropLine.width }} />}
              {image && box && (
                <div className="img-frame" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} data-no-swipe>
                  {HANDLES.map((h) => (
                    <span key={h} className={`img-handle h-${h}`} onPointerDown={startResize(h)} aria-hidden="true" />
                  ))}
                  <span className="img-size">{Math.round(box.width)} px</span>
                  <div
                    className={`img-tools${box.left + box.width + 52 <= (wrap.current?.clientWidth ?? 0) ? ' outside' : ''}`}
                    onPointerDown={(e) => e.preventDefault()}
                  >
                    {(
                      [
                        ['left', 'rotateLeft', '90° nach links drehen'],
                        ['right', 'rotateRight', '90° nach rechts drehen'],
                        ['flipH', 'flipH', 'Horizontal spiegeln (links ↔ rechts)'],
                        ['flipV', 'flipV', 'Vertikal spiegeln (oben ↔ unten)'],
                      ] as const
                    ).map(([op, icon, label]) => (
                      <button key={op} type="button" aria-label={label} title={label} disabled={turning} onClick={() => transformImage(op)}>
                        <Icon name={icon} size={18} />
                      </button>
                    ))}
                    <button type="button" aria-label="Bild nach oben verschieben" title="Nach oben verschieben" onClick={() => stepImage(-1)}>
                      <Icon name="arrowUp" size={18} />
                    </button>
                    <button type="button" aria-label="Bild nach unten verschieben" title="Nach unten verschieben" onClick={() => stepImage(1)}>
                      <Icon name="arrowDown" size={18} />
                    </button>
                  </div>
                </div>
              )}
            </>
          }
        >
          <div
            ref={editor}
            className={`doc-content doc-editable${drawing ? ' draw-only' : ''}`}
            // Im Stift-Modus kann man nicht tippen (kein Cursor, keine Tastatur) – nur zeichnen
            contentEditable={!drawing}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Inhalt"
            data-no-swipe
            onInput={(e) => {
              lastWasInk.current = false;
              setDirty(true);
              measure();
              normalize();
              measureCols();
              if (editor.current?.querySelector('ul.checklist')) refreshChecks();
              const ev = e.nativeEvent as InputEvent;
              if (ev.inputType === 'insertText' && ev.data?.endsWith('$')) autoFormula();
            }}
            onClick={onEditorClick}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </PagedDoc>
        {image && <p className="muted small">Bild ausgewählt: an den Ecken/Kanten ziehen zum Vergrößern/Verkleinern, mit den Knöpfen am Rand drehen oder spiegeln, Ausrichten mit der Leiste, Entf/⌫ löscht es.</p>}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            if (e.target.files) insertImages(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) insertImages(e.target.files);
            e.target.value = '';
          }}
        />
        {err && <p className="notice critical">{err}</p>}
        {checks.notReady && <p className="notice warning">Häkchen werden noch nicht synchronisiert: Bitte supabase/005_checklisten.sql im Supabase „SQL Editor“ ausführen.</p>}
      </div>
      {paperFor !== null && pages[paperFor] && <PaperSheet page={pages[paperFor]} index={paperFor} onApply={applyPaper} onClose={() => setPaperFor(null)} />}
      {insertKind && (
        <EmbedInsertSheet
          kind={insertKind}
          onClose={() => setInsertKind(null)}
          onNew={() => {
            const kind = insertKind;
            setInsertKind(null);
            afterBack(() => setEmbedEdit({ el: null, kind }));
          }}
          onPick={(e) => {
            setInsertKind(null);
            afterBack(() => insertEmbeds([e]));
          }}
        />
      )}
      {embedEdit?.kind === 'chart' && (
        <ChartEditor
          initial={embedEdit.embed?.kind === 'chart' ? embedEdit.embed.data : undefined}
          onClose={() => setEmbedEdit(null)}
          onDone={(data) => editEmbedDone({ kind: 'chart', data })}
        />
      )}
      {embedEdit?.kind === 'wheel' && (
        <WheelEditor
          initial={embedEdit.embed?.kind === 'wheel' ? embedEdit.embed.data : undefined}
          onClose={() => setEmbedEdit(null)}
          onDone={(data) => editEmbedDone({ kind: 'wheel', data })}
        />
      )}
    </StudyScreen>
  );
}
