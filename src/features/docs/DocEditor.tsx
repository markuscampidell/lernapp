import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon, type IconName } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import { DOC_EXT, DOC_MIME, imageToDataUrl, sanitizeHtml } from './sanitize';

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

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.innerHTML = sanitizeHtml(initial) || '<p><br></p>';
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
      setState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        h2: block === 'h2',
        ul: document.queryCommandState('insertUnorderedList'),
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
    }
  };

  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLImageElement) {
      setImage(t);
      const block = t.closest('p, h2, h3, li, blockquote') as HTMLElement | null;
      const a = block?.style.textAlign;
      setState((s) => ({ ...s, center: a === 'center', right: a === 'right' }));
    } else setImage(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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
    { icon: 'listBullet', label: 'Aufzählung', on: state.ul, run: () => cmd('insertUnorderedList') },
    { icon: 'listNumber', label: 'Nummerierung', on: state.ol, run: () => cmd('insertOrderedList') },
    { icon: 'image', label: 'Bild einfügen', run: () => imageInput.current?.click() },
  ];

  return (
    <StudyScreen
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
            onInput={() => {
              setDirty(true);
              measure();
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
      </div>
    </StudyScreen>
  );
}
