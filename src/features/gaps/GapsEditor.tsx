import { useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { DescriptionField } from '../../components/DescriptionField';
import { Icon } from '../../components/Icon';
import { MathText } from '../../components/MathText';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import { emptyGaps, GAPS_EXT, GAPS_MIME, gapsBlob, gapsOf, MAX_DISTRACTORS, MAX_TEXT, segments, type GapsDoc } from './gaps';

/** Lückentext anlegen/bearbeiten: Text schreiben, Wörter markieren und zu Lücken machen. */
export function GapsEditor({
  file,
  folderId,
  initial,
  initialName,
  initialDescription,
  onClose,
}: {
  file?: FileItem;
  folderId?: string;
  initial?: GapsDoc;
  initialName?: string;
  initialDescription?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(file?.name ?? initialName ?? '');
  const [description, setDescription] = useState(file?.description ?? initialDescription ?? '');
  const [doc, setDoc] = useState<GapsDoc>(() => initial ?? emptyGaps());
  const [distractorText, setDistractorText] = useState(() => (initial?.distractors ?? []).join('\n'));
  const start = useRef(JSON.stringify({ name, description, doc }));
  const area = useRef<HTMLTextAreaElement>(null);
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: GAPS_EXT, mime: GAPS_MIME });

  const set = (patch: Partial<GapsDoc>) => setDoc((d) => ({ ...d, ...patch }));
  const gaps = gapsOf(doc.text);
  const distractors = distractorText
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, MAX_DISTRACTORS);
  const current = { ...doc, distractors };
  const dirty = JSON.stringify({ name, description, doc: current }) !== start.current;

  /** Markierten Text zur Lücke machen (bzw. leere Lücke einfügen). */
  const makeGap = () => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    let sel = value.slice(a, b);
    // Leerzeichen am Rand der Markierung bleiben außerhalb der Lücke
    const lead = sel.match(/^\s*/)?.[0] ?? '';
    const trail = sel.match(/\s*$/)?.[0] ?? '';
    sel = sel.trim();
    const insert = sel ? `${lead}[[${sel}]]${trail}` : '[[]]';
    const next = value.slice(0, a) + insert + value.slice(b);
    set({ text: next.slice(0, MAX_TEXT) });
    requestAnimationFrame(() => {
      el.focus();
      const caret = sel ? a + insert.length : a + 2;
      el.setSelectionRange(caret, caret);
    });
  };

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib dem Lückentext einen Namen.');
    if (!doc.text.trim()) return setErr('Schreib zuerst einen Text.');
    if (!gaps.length) return setErr('Mach mindestens ein Wort zur Lücke: markieren und auf „Lücke“ tippen.');
    if (await save(name, gapsBlob(current), description)) onClose();
  };

  return (
    <StudyScreen
      editing={file}
      title={file ? 'Lückentext bearbeiten' : 'Neuer Lückentext'}
      subtitle={`${gaps.length} ${gaps.length === 1 ? 'Lücke' : 'Lücken'}`}
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
      <div className="study-form">
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <TextLine autoFocus={!file && !initial} value={name} onChange={setName} placeholder="z. B. Zellteilung" maxLength={120} enterKeyHint="next" onEnter={() => area.current?.focus()} />
        </div>
        <DescriptionField value={description} onChange={setDescription} />

        <div className="card edit-card">
          <div className="field">
            <div className="field-label">
              <span>Text</span>
              <button type="button" className="btn ghost small" onMouseDown={(e) => e.preventDefault()} onClick={makeGap}>
                <Icon name="gaps" size={16} /> Lücke
              </button>
            </div>
            <textarea
              ref={area}
              rows={8}
              value={doc.text}
              maxLength={MAX_TEXT}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="z. B. Die [[Mitose]] besteht aus vier Phasen: [[Prophase]], Metaphase, Anaphase und Telophase."
            />
            <p className="muted small">
              Wort markieren und auf „Lücke“ tippen – oder selbst in doppelte eckige Klammern schreiben: <code>[[Mitose]]</code>. Mehrere richtige
              Antworten mit <code>|</code> trennen: <code>[[Prophase|Vorphase]]</code>. Formeln wie sonst mit <code>$…$</code>.
            </p>
          </div>

          {doc.text.trim() && (
            <div className="field">
              <div className="field-label">
                <span>Vorschau</span>
              </div>
              <div className="gaps-preview pre-wrap">
                {segments(doc.text).map((s, i) =>
                  s.kind === 'text' ? (
                    <MathText key={i} text={s.text} />
                  ) : (
                    <span key={i} className="gap-mark">
                      {s.answers.join(' / ')}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card edit-card">
          <label className="field">
            <span className="field-label">
              <span>Ablenkwörter</span>
              <span className="muted small">optional, eines pro Zeile</span>
            </span>
            <textarea rows={3} value={distractorText} onChange={(e) => setDistractorText(e.target.value)} placeholder={'z. B.\nMeiose\nInterphase'} />
            <span className="muted small">
              Zusätzliche falsche Wörter für „Wörter einsetzen“ – damit man das letzte Wort nicht einfach durch Ausschließen findet.
            </span>
          </label>

          <div className="field">
            <div className="field-label">
              <span>Vorgeschlagener Lernmodus</span>
            </div>
            <div className="segmented">
              <button type="button" className={doc.mode === 'drag' ? 'on' : ''} onClick={() => set({ mode: 'drag' })}>
                Wörter einsetzen
              </button>
              <button type="button" className={doc.mode === 'type' ? 'on' : ''} onClick={() => set({ mode: 'type' })}>
                Selbst schreiben
              </button>
            </div>
            <span className="muted small">Beim Lernen kann man trotzdem jedes Mal wählen.</span>
          </div>

          <label className="input-row">
            <span className="grow">
              Kleine Tippfehler erlauben
              <span className="muted small block">Beim Selbst-Schreiben zählt z. B. „Mitoes“ statt „Mitose“ noch als richtig. Groß-/Kleinschreibung zählt nie.</span>
            </span>
            <input type="checkbox" className="switch" checked={doc.typos} onChange={(e) => set({ typos: e.target.checked })} />
          </label>
        </div>

        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}
