import { useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { DescriptionField } from '../../components/DescriptionField';
import { Icon } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import { WheelSpinner } from './WheelSpinner';
import {
  MAX_ENTRIES,
  MAX_WEIGHT,
  WHEEL_EXT,
  WHEEL_MIME,
  cleanWheel,
  emptyWheel,
  entriesToText,
  newEntry,
  slices,
  textToEntries,
  wheelBlob,
  type Wheel,
  type WheelEntry,
} from './wheel';

/**
 * Glücksrad anlegen/bearbeiten – als Datei (file/folderId) oder eingebettet in ein Text-Dokument (onDone).
 */
export function WheelEditor({
  file,
  folderId,
  initial,
  onClose,
  onDone,
}: {
  file?: FileItem;
  folderId?: string;
  initial?: Wheel;
  onClose: () => void;
  onDone?: (w: Wheel) => void;
}) {
  const embedded = !!onDone;
  const [name, setName] = useState(file?.name ?? '');
  const [description, setDescription] = useState(file?.description ?? '');
  const [wheel, setWheel] = useState<Wheel>(() => (initial ? { ...initial, entries: initial.entries.length ? initial.entries : [newEntry()] } : emptyWheel()));
  const [mode, setMode] = useState<'list' | 'text'>('list');
  const [text, setText] = useState('');
  const start = useRef(JSON.stringify({ name, description, wheel }));
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: WHEEL_EXT, mime: WHEEL_MIME });
  const rows = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify({ name, description, wheel }) !== start.current;
  const colors = new Map(slices(wheel.entries.filter((e) => e.label.trim())).map((s) => [s.entry.id, s.color]));
  const set = (patch: Partial<Wheel>) => setWheel((w) => ({ ...w, ...patch }));
  const setEntry = (id: string, patch: Partial<WheelEntry>) => set({ entries: wheel.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const addEntry = () => {
    if (wheel.entries.length >= MAX_ENTRIES) return;
    set({ entries: [...wheel.entries, newEntry()] });
    setTimeout(() => rows.current?.querySelector<HTMLElement>('.chart-row:last-of-type textarea')?.focus(), 0);
  };
  const switchMode = (m: 'list' | 'text') => {
    if (m === mode) return;
    if (m === 'text') setText(entriesToText(wheel.entries.filter((e) => e.label.trim())));
    setMode(m);
  };

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    const w = cleanWheel(wheel);
    if (w.entries.length < 2) return setErr('Gib mindestens zwei Einträge ein.');
    if (embedded) return onDone!(w);
    if (!name.trim()) return setErr('Gib dem Glücksrad einen Namen.');
    if (await save(name, wheelBlob(w), description)) onClose();
  };

  return (
    <StudyScreen
      editing={file}
      title={embedded ? 'Glücksrad im Dokument' : file ? 'Glücksrad bearbeiten' : 'Neues Glücksrad'}
      onClose={close}
      actions={
        <>
          {file && <DetailsButton file={file} onRenamed={setName} onDeleted={onClose} />}
          <button className="btn primary small" onClick={submit} disabled={busy}>
            {embedded ? 'Übernehmen' : busy ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="study-form chart-editor">
        {!embedded && (
          <div className="field">
            <div className="field-label">
              <span>Name</span>
            </div>
            <TextLine autoFocus={!file} value={name} onChange={setName} placeholder="z. B. Wer stellt vor?" maxLength={120} />
          </div>
        )}
        {!embedded && <DescriptionField value={description} onChange={setDescription} />}

        <div className="card chart-preview">
          <WheelSpinner wheel={wheel} />
        </div>

        <div className="card edit-card">
          <label className="field">
            <span className="field-label">
              <span>Überschrift</span>
              <span className="muted small">optional, steht über dem Rad</span>
            </span>
            <TextLine value={wheel.title} onChange={(title) => set({ title })} placeholder="z. B. Nächstes Thema" maxLength={200} />
          </label>

          <div className="field">
            <div className="field-label">
              <span>Einträge</span>
              <div className="segmented small-seg">
                <button type="button" className={mode === 'list' ? 'active' : ''} onClick={() => switchMode('list')}>
                  Liste
                </button>
                <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>
                  Als Text
                </button>
              </div>
            </div>

            {mode === 'list' ? (
              <div className="chart-rows" ref={rows}>
                {wheel.entries.map((e, i) => (
                  <div key={e.id} className="chart-row">
                    <span className="chart-swatch" style={{ background: colors.get(e.id) ?? 'var(--border)' }} aria-hidden="true" />
                    <TextLine value={e.label} onChange={(label) => setEntry(e.id, { label })} placeholder={`Eintrag ${i + 1}`} maxLength={80} onEnter={addEntry} enterKeyHint="next" />
                    <select
                      className="wheel-weight"
                      value={e.weight}
                      onChange={(ev) => setEntry(e.id, { weight: Number(ev.target.value) })}
                      aria-label={`Größe von Eintrag ${i + 1}`}
                      title="Größe des Feldes – größere Felder kommen öfter"
                    >
                      {Array.from({ length: MAX_WEIGHT }, (_, k) => k + 1).map((n) => (
                        <option key={n} value={n}>
                          ×{n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label={`Eintrag ${i + 1} entfernen`}
                      onClick={() => set({ entries: wheel.entries.length > 1 ? wheel.entries.filter((x) => x.id !== e.id) : [newEntry()] })}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
                {wheel.entries.length < MAX_ENTRIES && (
                  <button type="button" className="btn ghost small" onClick={addEntry}>
                    <Icon name="plus" size={16} /> Eintrag
                  </button>
                )}
                <p className="muted small">×2, ×3 … macht ein Feld größer – es kommt entsprechend öfter.</p>
              </div>
            ) : (
              <>
                <textarea
                  rows={Math.max(5, Math.min(14, text.split('\n').length + 1))}
                  value={text}
                  onChange={(ev) => {
                    setText(ev.target.value);
                    set({ entries: textToEntries(ev.target.value, wheel.entries) });
                  }}
                  placeholder={'Anna\nBen\nClara ×2'}
                  spellCheck={false}
                />
                <p className="muted small">Ein Eintrag pro Zeile. „×2“ am Ende macht das Feld doppelt so groß.</p>
              </>
            )}
          </div>

          <label className="toggle-row small-toggle">
            <span>
              Gezogene entfernen
              <span className="muted small block">Was gezogen wurde, ist beim nächsten Drehen nicht mehr dabei – bis „Zurücksetzen“.</span>
            </span>
            <input type="checkbox" className="switch" checked={wheel.removePicked} onChange={(ev) => set({ removePicked: ev.target.checked })} />
          </label>
        </div>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}
