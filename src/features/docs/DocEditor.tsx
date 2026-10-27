import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon, type IconName } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DOC_EXT, DOC_MIME, imageToDataUrl, sanitizeHtml } from './sanitize';

/** Text-Dokument mit Formatierung und Bildern bearbeiten (wie ein einfaches Google Doc). */
export function DocEditor({ file, folderId, initial = '', onClose }: { file?: FileItem; folderId?: string; initial?: string; onClose: () => void }) {
  const [name, setName] = useState(file?.name ?? '');
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<Record<string, boolean>>({});
  const editor = useRef<HTMLDivElement>(null);
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

  // Zeigt an, welche Formatierung an der Cursor-Position aktiv ist.
  useEffect(() => {
    const update = () => {
      if (!editor.current?.contains(document.getSelection()?.anchorNode ?? null)) return;
      const block = String(document.queryCommandValue('formatBlock')).toLowerCase();
      setState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        h2: block === 'h2',
        h3: block === 'h3',
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  const cmd = (command: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, value);
    setDirty(true);
  };
  // Aktuellen Absatztyp direkt abfragen (der gemerkte Zustand kann nach Enter veraltet sein).
  const toggleBlock = (tag: 'h2' | 'h3') => {
    editor.current?.focus();
    const current = String(document.queryCommandValue('formatBlock')).toLowerCase();
    cmd('formatBlock', current === tag ? 'p' : tag);
  };

  const insertImages = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const url = await imageToDataUrl(f);
      if (!url) {
        setErr('Dieses Bild konnte nicht gelesen werden.');
        continue;
      }
      cmd('insertHTML', `<img src="${url}" alt=""><p><br></p>`);
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

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib dem Dokument einen Namen.');
    const html = sanitizeHtml(editor.current?.innerHTML ?? '');
    if (await save(name, new Blob([html], { type: DOC_MIME }))) onClose();
  };

  const tools: { icon: IconName; label: string; on?: boolean; run: () => void }[] = [
    { icon: 'undo', label: 'Rückgängig', run: () => cmd('undo') },
    { icon: 'redo', label: 'Wiederholen', run: () => cmd('redo') },
    { icon: 'bold', label: 'Fett', on: state.bold, run: () => cmd('bold') },
    { icon: 'italic', label: 'Kursiv', on: state.italic, run: () => cmd('italic') },
    { icon: 'underline', label: 'Unterstrichen', on: state.underline, run: () => cmd('underline') },
    { icon: 'heading', label: 'Überschrift', on: state.h2, run: () => toggleBlock('h2') },
    { icon: 'listBullet', label: 'Aufzählung', on: state.ul, run: () => cmd('insertUnorderedList') },
    { icon: 'listNumber', label: 'Nummerierung', on: state.ol, run: () => cmd('insertOrderedList') },
    { icon: 'image', label: 'Bild einfügen', run: () => imageInput.current?.click() },
  ];

  return (
    <StudyScreen
      title={file ? 'Dokument bearbeiten' : 'Neues Text-Dokument'}
      onClose={close}
      actions={
        <button className="btn primary small" onClick={submit} disabled={busy}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
      }
    >
      <div className="doc-editor">
        <TextLine autoFocus={!file} value={name} onChange={(v) => (setName(v), setDirty(true))} placeholder="Titel des Dokuments" maxLength={120} className="doc-title" enterKeyHint="next" onEnter={() => editor.current?.focus()} />
        <div className="doc-toolbar" role="toolbar" aria-label="Formatierung" data-no-swipe>
          {tools.map((t) => (
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
          ))}
        </div>
        <div
          ref={editor}
          className="doc-content doc-editable"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Inhalt"
          data-no-swipe
          onInput={() => setDirty(true)}
          onPaste={onPaste}
          onDrop={(e) => {
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              insertImages(e.dataTransfer.files);
            }
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
      </div>
    </StudyScreen>
  );
}
