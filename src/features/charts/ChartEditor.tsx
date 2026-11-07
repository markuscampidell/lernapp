import { useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { DescriptionField } from '../../components/DescriptionField';
import { Icon } from '../../components/Icon';
import { StudyScreen } from '../study/StudyScreen';
import { useStudySave } from '../study/useStudySave';
import { DetailsButton } from '../study/DetailsButton';
import {
  CHART_EXT,
  CHART_MIME,
  CHART_TYPES,
  MAX_POINTS,
  PALETTE,
  chartBlob,
  chartSvg,
  cleanChart,
  emptyChart,
  formatNumber,
  newPoint,
  pointsToText,
  textToPoints,
  type Chart,
  type ChartPoint,
} from './chart';

const parseNum = (s: string) => {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Diagramm anlegen/bearbeiten. Zwei Arten:
 * - als Datei (file/folderId): mit Namen, wird im Ordner gespeichert,
 * - eingebettet in ein Text-Dokument (onDone): nur die Daten, "Übernehmen" gibt sie zurück.
 */
export function ChartEditor({
  file,
  folderId,
  initial,
  initialName,
  onClose,
  onDone,
}: {
  file?: FileItem;
  folderId?: string;
  initial?: Chart;
  /** Startname einer neuen Datei (z. B. von „Mit KI erstellen“) */
  initialName?: string;
  onClose: () => void;
  onDone?: (c: Chart) => void;
}) {
  const embedded = !!onDone;
  const [name, setName] = useState(file?.name ?? initialName ?? '');
  const [description, setDescription] = useState(file?.description ?? '');
  const [chart, setChart] = useState<Chart>(() => (initial ? { ...initial, points: initial.points.length ? initial.points : [newPoint()] } : emptyChart()));
  const [mode, setMode] = useState<'table' | 'text'>('table');
  const [text, setText] = useState('');
  // Rohtext der Zahlenfelder (damit "1," oder "-" beim Tippen stehen bleiben).
  const [raw, setRaw] = useState<Record<string, string>>({});
  const start = useRef(JSON.stringify({ name, description, chart }));
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: CHART_EXT, mime: CHART_MIME });
  const lastLabel = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify({ name, description, chart }) !== start.current;
  const svg = useMemo(() => chartSvg(chart), [chart]);
  const round = chart.chart === 'pie' || chart.chart === 'donut';

  const set = (patch: Partial<Chart>) => setChart((c) => ({ ...c, ...patch }));
  const setPoint = (id: string, patch: Partial<ChartPoint>) => set({ points: chart.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPoint = () => {
    if (chart.points.length >= MAX_POINTS) return;
    set({ points: [...chart.points, newPoint()] });
    setTimeout(() => lastLabel.current?.querySelector<HTMLElement>('.chart-row:last-child textarea, .chart-row:last-child input')?.focus(), 0);
  };
  const switchMode = (m: 'table' | 'text') => {
    if (m === mode) return;
    if (m === 'text') setText(pointsToText(chart.points.filter((p) => p.label.trim() || p.value !== 0)));
    else setRaw({});
    setMode(m);
  };

  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    const c = cleanChart(chart);
    if (!c.points.length) return setErr('Gib mindestens einen Wert ein.');
    if (embedded) {
      onDone!(c);
      return;
    }
    if (!name.trim()) return setErr('Gib dem Diagramm einen Namen.');
    if (await save(name, chartBlob(c), description)) onClose();
  };

  return (
    <StudyScreen
      editing={file}
      title={embedded ? 'Diagramm im Dokument' : file ? 'Diagramm bearbeiten' : 'Neues Diagramm'}
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
            <TextLine autoFocus={!file} value={name} onChange={setName} placeholder="z. B. Noten im Semester" maxLength={120} />
          </div>
        )}
        {!embedded && <DescriptionField value={description} onChange={setDescription} />}

        <div className="segmented chart-types" role="tablist" aria-label="Diagrammart" data-no-swipe>
          {CHART_TYPES.map((t) => (
            <button key={t.id} type="button" className={chart.chart === t.id ? 'active' : ''} aria-pressed={chart.chart === t.id} onClick={() => set({ chart: t.id })}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="card chart-preview" dangerouslySetInnerHTML={{ __html: svg }} />

        <div className="card edit-card">
          <label className="field">
            <span className="field-label">
              <span>Überschrift</span>
              <span className="muted small">optional, steht über dem Diagramm</span>
            </span>
            <TextLine value={chart.title} onChange={(title) => set({ title })} placeholder="z. B. Lernzeit pro Woche" maxLength={200} />
          </label>

          <div className="field">
            <div className="field-label">
              <span>Werte</span>
              <div className="segmented small-seg">
                <button type="button" className={mode === 'table' ? 'active' : ''} onClick={() => switchMode('table')}>
                  Tabelle
                </button>
                <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>
                  Als Text
                </button>
              </div>
            </div>

            {mode === 'table' ? (
              <div className="chart-rows" ref={lastLabel}>
                {chart.points.map((p, i) => (
                  <div key={p.id} className="chart-row">
                    <span className="chart-swatch" style={{ background: round ? PALETTE[i % PALETTE.length] : PALETTE[0] }} aria-hidden="true" />
                    <TextLine value={p.label} onChange={(label) => setPoint(p.id, { label })} placeholder={`Beschriftung ${i + 1}`} maxLength={80} onEnter={addPoint} enterKeyHint="next" />
                    <input
                      className="chart-value"
                      inputMode="decimal"
                      aria-label={`Wert ${i + 1}`}
                      value={raw[p.id] ?? formatNumber(p.value).replace(/\./g, '')}
                      onChange={(e) => {
                        setRaw((r) => ({ ...r, [p.id]: e.target.value }));
                        setPoint(p.id, { value: parseNum(e.target.value) });
                      }}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addPoint();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label={`Zeile ${i + 1} entfernen`}
                      onClick={() => set({ points: chart.points.length > 1 ? chart.points.filter((x) => x.id !== p.id) : [newPoint()] })}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
                {chart.points.length < MAX_POINTS && (
                  <button type="button" className="btn ghost small" onClick={addPoint}>
                    <Icon name="plus" size={16} /> Wert
                  </button>
                )}
              </div>
            ) : (
              <>
                <textarea
                  rows={Math.max(5, Math.min(14, text.split('\n').length + 1))}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    set({ points: textToPoints(e.target.value, chart.points) });
                  }}
                  placeholder={'Mathe: 12\nInformatik: 9,5\nPhysik: 4'}
                  spellCheck={false}
                />
                <p className="muted small">Eine Zeile pro Wert: Beschriftung, dann die Zahl (z. B. „Montag: 3,5“).</p>
              </>
            )}
          </div>

          <div className="grid-2">
            <label className="field">
              <span className="field-label">Einheit</span>
              <TextLine value={chart.unit} onChange={(unit) => set({ unit })} placeholder="z. B. %, h, €" maxLength={12} />
            </label>
            <label className="toggle-row small-toggle chart-values-toggle">
              <span>{round ? 'Prozent anzeigen' : 'Werte anzeigen'}</span>
              <input type="checkbox" className="switch" checked={chart.showValues} onChange={(e) => set({ showValues: e.target.checked })} />
            </label>
          </div>
        </div>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}
