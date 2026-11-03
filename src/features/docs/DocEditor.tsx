import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon, type IconName } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import { DOC_EXT, DOC_MIME, imageToDataUrl, sanitizeHtml } from './sanitize';
import { loadKatex, renderMathIn, renderMathSpan } from '../../lib/math';
import { useKatex } from '../../components/MathText';
import { newId } from '../../lib/id';
import { useLibrary } from '../../state/Library';
import { applyChecks, checkboxHit, useChecks } from './checks';
import { chartFigure, chartFromPaste, parseChart, renderChartsIn, type Chart } from '../charts/chart';
import { ChartEditor } from '../charts/ChartEditor';
import { useChartCopy } from '../charts/ChartPanel';
import { ChartInsertSheet } from './ChartInsertSheet';
import { afterBack } from '../../lib/router';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blank = (c: string | undefined) => c === undefined || /\s/.test(c);

type Align = 'left' | 'center' | 'right';
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_IMAGE = 40;

/** Text-Dokument mit Formatierung und Bildern bearbeiten (wie ein einfaches Google Doc). */
export function DocEditor({ file, folderId, initial = '', onClose }: { file?: FileItem; folderId?: string; initial?: string; onClose: () => void }) {
  const [name, setName] = useState(file?.name ?? '');
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<Record<string, boolean>>({});
  // Angeklicktes Bild (zum Größe ändern / Ausrichten / Löschen).
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
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
  const [chartEl, setChartEl] = useState<HTMLElement | null>(null);
  const chartData = useMemo(() => (chartEl ? parseChart(chartEl.dataset.chart ?? '') : null), [chartEl]);
  const chartCopy = useChartCopy(chartData);
  const [chartSheet, setChartSheet] = useState(false);
  const [chartEdit, setChartEdit] = useState<{ el: HTMLElement | null; chart?: Chart } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const katexOk = useKatex(!!formula);
  useEffect(() => {
    if (katexOk && formula) renderMathSpan(formula, true);
  }, [katexOk, formula]);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.innerHTML = sanitizeHtml(initial) || '<p><br></p>';
    renderMathIn(el, true);
    renderChartsIn(el, { editable: true });
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (file) el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return () => {
      window.removeEventListener('resize', measure);
      scroller?.removeEventListener('scroll', measure);
    };
  }, [image, measure]);

  /** Größe per Ecke/Kante ziehen – das Seitenverhältnis bleibt immer gleich. */
  const startResize = (handle: Handle) => (e: React.PointerEvent) => {
    if (!image || !editor.current) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = image.getBoundingClientRect().width;
    const ratio = image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : image.offsetHeight / Math.max(1, image.offsetWidth);
    const maxW = editor.current.clientWidth - 40;
    const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    // Bei mittiger Ausrichtung wächst das Bild nach beiden Seiten – dann zählt die Bewegung doppelt.
    const centered = getComputedStyle(image.parentElement ?? image).textAlign === 'center' ? 2 : 1;
    const move = (ev: PointerEvent) => {
      const byX = sx * (ev.clientX - startX) * centered;
      const byY = (sy * (ev.clientY - startY)) / ratio;
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

  // ---------- Formatierung ----------
  useEffect(() => {
    const update = () => {
      if (!editor.current?.contains(document.getSelection()?.anchorNode ?? null)) return;
      const block = String(document.queryCommandValue('formatBlock')).toLowerCase();
      const ul = listAt();
      const isCheck = !!ul?.classList.contains('checklist');
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
    document.execCommand(command, false, value);
    setDirty(true);
    requestAnimationFrame(measure);
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

  // ---------- Diagramme ----------
  const selectChart = (el: HTMLElement | null) => {
    editor.current?.querySelectorAll('figure.chart.selected').forEach((x) => x !== el && x.classList.remove('selected'));
    el?.classList.add('selected');
    setChartEl(el);
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
  const insertCharts = (list: Chart[]) => {
    if (!list.length) return;
    restoreCursor();
    cmd('insertHTML', list.map(chartFigure).join('') + '<p><br></p>');
    if (editor.current) renderChartsIn(editor.current, { editable: true });
    selectChart(null);
  };
  const editChartDone = (c: Chart) => {
    const target = chartEdit?.el;
    setChartEdit(null);
    if (target && target.isConnected) {
      target.dataset.chart = JSON.stringify(c);
      renderChartsIn(editor.current!, { editable: true });
      target.classList.add('selected');
      setChartEl(null);
      setTimeout(() => selectChart(target), 0);
      setDirty(true);
    } else insertCharts([c]);
  };
  const deleteChart = () => {
    chartEl?.remove();
    setChartEl(null);
    setDirty(true);
  };

  // Aktuellen Absatztyp direkt abfragen (der gemerkte Zustand kann nach Enter veraltet sein).
  const toggleBlock = (tag: 'h2' | 'h3') => {
    editor.current?.focus();
    const current = String(document.queryCommandValue('formatBlock')).toLowerCase();
    cmd('formatBlock', current === tag ? 'p' : tag);
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
    // Diagramm aus der App? (vor Bildern prüfen – kopierte Diagramme bringen auch ein Bild mit)
    const chart = chartFromPaste(e.clipboardData);
    if (chart && chart !== 'html') {
      e.preventDefault();
      rememberCursor();
      insertCharts([chart]);
      return;
    }
    if (chart === 'html') {
      e.preventDefault();
      cmd('insertHTML', sanitizeHtml(e.clipboardData.getData('text/html')));
      if (editor.current) renderChartsIn(editor.current, { editable: true });
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
      if (editor.current) renderChartsIn(editor.current, { editable: true });
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
    const fig = t.closest?.('figure.chart') as HTMLElement | null;
    if (fig && editor.current?.contains(fig)) {
      if (formula) finishFormula();
      setImage(null);
      selectChart(fig);
      return;
    }
    if (chartEl) selectChart(null);
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
    if (chartEl) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteChart();
      } else if (e.key !== 'Shift') selectChart(null);
      return;
    }
    if (!image) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      image.remove();
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
    if (await save(name, new Blob([html], { type: DOC_MIME }))) onClose();
  };

  const tools: ({ icon: IconName; label: string; on?: boolean; run: () => void } | 'sep')[] = [
    { icon: 'undo', label: 'Rückgängig', run: () => cmd('undo') },
    { icon: 'redo', label: 'Wiederholen', run: () => cmd('redo') },
    'sep',
    { icon: 'bold', label: 'Fett', on: state.bold, run: () => cmd('bold') },
    { icon: 'italic', label: 'Kursiv', on: state.italic, run: () => cmd('italic') },
    { icon: 'underline', label: 'Unterstrichen', on: state.underline, run: () => cmd('underline') },
    { icon: 'heading', label: 'Überschrift', on: state.h2, run: () => toggleBlock('h2') },
    'sep',
    { icon: 'alignLeft', label: 'Linksbündig', on: !state.center && !state.right, run: () => align('left') },
    { icon: 'alignCenter', label: 'Zentriert', on: state.center, run: () => align('center') },
    { icon: 'alignRight', label: 'Rechtsbündig', on: state.right, run: () => align('right') },
    'sep',
    { icon: 'listBullet', label: 'Aufzählung', on: state.ul, run: bulletList },
    { icon: 'listNumber', label: 'Nummerierung', on: state.ol, run: () => cmd('insertOrderedList') },
    { icon: 'checklist', label: 'Checkliste', on: state.check, run: toggleChecklist },
    'sep',
    { icon: 'image', label: 'Bild einfügen', run: () => imageInput.current?.click() },
    {
      icon: 'chart',
      label: 'Diagramm einfügen',
      run: () => {
        rememberCursor();
        setChartSheet(true);
      },
    },
    { icon: 'sigma', label: 'Formel einfügen', on: !!formula, run: () => (formula ? finishFormula() : insertFormula()) },
  ];

  return (
    <StudyScreen
      editing={file}
      title={file ? 'Dokument bearbeiten' : 'Neues Text-Dokument'}
      onClose={close}
      actions={
        <>
          {file && <DetailsButton file={file} onRenamed={setName} onDeleted={onClose} />}
          <button className="btn primary small" onClick={submit} disabled={busy}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="doc-editor">
        <TextLine autoFocus={!file} value={name} onChange={(v) => (setName(v), setDirty(true))} placeholder="Titel des Dokuments" maxLength={120} className="doc-title" enterKeyHint="next" onEnter={() => editor.current?.focus()} />
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
            <label className="toggle-row small-toggle">
              <span>In eigener Zeile (zentriert)</span>
              <input type="checkbox" className="switch" checked={display} onChange={(e) => updateFormula({ display: e.target.checked })} />
            </label>
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
        {chartEl && chartData && (
          <div className="card chart-bar" data-no-swipe>
            <strong className="grow ellipsis">
              <Icon name="chart" size={16} /> {chartData.title || 'Diagramm'}
            </strong>
            <button className="btn ghost small danger" onClick={deleteChart}>
              <Icon name="trash" size={16} /> Löschen
            </button>
            <button className="btn ghost small" onClick={chartCopy.run} disabled={!chartCopy.prepared}>
              <Icon name={chartCopy.done ? 'check' : 'copy'} size={16} /> {chartCopy.done ? 'Kopiert' : 'Kopieren'}
            </button>
            <button className="btn primary small" onClick={() => setChartEdit({ el: chartEl, chart: chartData })}>
              <Icon name="edit" size={16} /> Bearbeiten
            </button>
          </div>
        )}
        <div className="doc-edit-wrap" ref={wrap}>
          <div
            ref={editor}
            className="doc-content doc-editable"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Inhalt"
            data-no-swipe
            onInput={(e) => {
              setDirty(true);
              measure();
              if (editor.current?.querySelector('ul.checklist')) refreshChecks();
              const ev = e.nativeEvent as InputEvent;
              if (ev.inputType === 'insertText' && ev.data?.endsWith('$')) autoFormula();
            }}
            onClick={onEditorClick}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                insertImages(e.dataTransfer.files);
              }
            }}
          />
          {image && box && (
            <div className="img-frame" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} data-no-swipe>
              {HANDLES.map((h) => (
                <span key={h} className={`img-handle h-${h}`} onPointerDown={startResize(h)} aria-hidden="true" />
              ))}
              <span className="img-size">{Math.round(box.width)} px</span>
            </div>
          )}
        </div>
        {image && <p className="muted small">Bild ausgewählt: an den Ecken/Kanten ziehen zum Vergrößern/Verkleinern, Ausrichten mit der Leiste, Entf/⌫ löscht es.</p>}
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
      {chartSheet && (
        <ChartInsertSheet
          onClose={() => setChartSheet(false)}
          onNew={() => {
            setChartSheet(false);
            afterBack(() => setChartEdit({ el: null }));
          }}
          onPick={(c) => {
            setChartSheet(false);
            afterBack(() => insertCharts([c]));
          }}
        />
      )}
      {chartEdit && <ChartEditor initial={chartEdit.chart} onClose={() => setChartEdit(null)} onDone={editChartDone} />}
    </StudyScreen>
  );
}
