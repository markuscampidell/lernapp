import { useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { MathText } from '../../components/MathText';
import { StudyScreen } from '../study/StudyScreen';
import { shuffled } from '../study/format';
import { GapsEditor } from './GapsEditor';
import { bankFor, judge, parseGapsDoc, segments, type GapMode, type GapsDoc, type Segment, type Verdict } from './gaps';

type Gap = Extract<Segment, { kind: 'gap' }>;

/** Ansicht einer Lückentext-Datei: Lernen (zwei Modi), Bearbeiten, Text mit/ohne Lösungen. */
export function GapsPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const doc = useMemo(() => parseGapsDoc(text), [text]);
  const segs = useMemo(() => segments(doc.text), [doc.text]);
  const n = segs.filter((s) => s.kind === 'gap').length;
  const [mode, setMode] = useState<GapMode | 'edit' | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const editable = canModify(file) && (!file.shareId || online);

  return (
    <div className="study-panel">
      <div className="card study-hero">
        <span className="thumb file-thumb kind-gaps">
          <Icon name="gaps" size={22} />
        </span>
        <div className="grow">
          <strong>
            {n} {n === 1 ? 'Lücke' : 'Lücken'}
          </strong>
          {doc.distractors.length > 0 && (
            <span className="muted small block">
              {doc.distractors.length} {doc.distractors.length === 1 ? 'Ablenkwort' : 'Ablenkwörter'}
            </span>
          )}
        </div>
        {editable && (
          <button className="btn ghost" onClick={() => setMode('edit')}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        )}
      </div>
      <div className="input-row wrap">
        <button className={`btn grow ${doc.mode === 'drag' ? 'primary' : 'ghost'}`} onClick={() => setMode('drag')} disabled={n === 0}>
          <Icon name="gaps" size={18} /> Wörter einsetzen
        </button>
        <button className={`btn grow ${doc.mode === 'type' ? 'primary' : 'ghost'}`} onClick={() => setMode('type')} disabled={n === 0}>
          <Icon name="edit" size={18} /> Selbst schreiben
        </button>
      </div>
      {n > 0 && (
        <label className="toggle-row small-toggle">
          <span>Lösungen anzeigen</span>
          <input type="checkbox" className="switch" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
        </label>
      )}
      {doc.text.trim() ? (
        <div className="card gaps-text pre-wrap">
          {segs.map((s, i) =>
            s.kind === 'text' ? (
              <MathText key={i} text={s.text} />
            ) : showAnswers ? (
              <span key={i} className="gap-mark">
                {s.answers.join(' / ')}
              </span>
            ) : (
              <span key={i} className="gap-blank" aria-label="Lücke" />
            ),
          )}
        </div>
      ) : (
        <p className="muted center-text">Noch kein Text.</p>
      )}
      {(mode === 'drag' || mode === 'type') && <GapsPlay title={file.name} doc={doc} initialMode={mode} onClose={() => setMode(null)} />}
      {mode === 'edit' && <GapsEditor file={file} initial={doc} onClose={() => setMode(null)} />}
    </div>
  );
}

interface Token {
  id: string;
  text: string;
}

/** Lernmodus: Wörter in die Lücken ziehen/tippen oder selbst schreiben, dann prüfen. */
function GapsPlay({ title, doc, initialMode, onClose }: { title: string; doc: GapsDoc; initialMode: GapMode; onClose: () => void }) {
  const [mode, setMode] = useState<GapMode>(initialMode);
  const segs = useMemo(() => segments(doc.text), [doc.text]);
  const allGaps = useMemo(() => segs.filter((s): s is Gap => s.kind === 'gap'), [segs]);

  // Lücken dieser Runde (bei „Nur falsche wiederholen“ nur die falschen); die anderen sind schon gelöst.
  const [active, setActive] = useState<Set<string>>(() => new Set(allGaps.map((g) => g.id)));
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [bank, setBank] = useState<Token[]>(() => shuffled(bankFor(allGaps, doc.distractors)));
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [selToken, setSelToken] = useState<string | null>(null);
  const [selGap, setSelGap] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict> | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const checked = verdicts !== null;
  const tokenText = (id?: string) => bank.find((t) => t.id === id)?.text ?? '';
  const usedTokens = new Set(Object.values(placed));
  const freeTokens = bank.filter((t) => !usedTokens.has(t.id));
  const activeGaps = allGaps.filter((g) => active.has(g.id));
  const filled = activeGaps.filter((g) => (mode === 'drag' ? placed[g.id] : values[g.id]?.trim())).length;

  const startRound = (ids: Set<string>, keepSolved: Set<string>) => {
    const gaps = allGaps.filter((g) => ids.has(g.id));
    setActive(ids);
    setSolved(keepSolved);
    setBank(shuffled(bankFor(gaps, doc.distractors)));
    setPlaced({});
    setValues({});
    setSelToken(null);
    setSelGap(null);
    setVerdicts(null);
  };
  const restartAll = () => startRound(new Set(allGaps.map((g) => g.id)), new Set());

  const place = (gapId: string, tokenId: string) => {
    setPlaced((p) => {
      const next: Record<string, string> = {};
      for (const [g, t] of Object.entries(p)) if (t !== tokenId && g !== gapId) next[g] = t;
      next[gapId] = tokenId;
      return next;
    });
    setSelToken(null);
    setSelGap(null);
  };
  const unplace = (gapId: string) =>
    setPlaced((p) => {
      const next = { ...p };
      delete next[gapId];
      return next;
    });

  const clickGap = (gapId: string) => {
    if (checked || !active.has(gapId)) return;
    if (selToken) return place(gapId, selToken);
    if (placed[gapId]) return unplace(gapId);
    setSelGap((g) => (g === gapId ? null : gapId));
  };
  const clickToken = (tokenId: string) => {
    if (checked) return;
    if (selGap) return place(selGap, tokenId);
    setSelToken((t) => (t === tokenId ? null : tokenId));
  };

  const check = () => {
    const v: Record<string, Verdict> = {};
    for (const g of activeGaps) {
      const input = mode === 'drag' ? tokenText(placed[g.id]) : values[g.id] ?? '';
      v[g.id] = judge(input, g.answers, mode === 'type' && doc.typos);
    }
    setVerdicts(v);
    setSelToken(null);
    setSelGap(null);
  };

  const results = verdicts ? activeGaps.map((g) => verdicts[g.id]) : [];
  const right = results.filter((r) => r !== 'wrong').length;
  const almost = results.filter((r) => r === 'almost').length;
  const wrongIds = verdicts ? activeGaps.filter((g) => verdicts[g.id] === 'wrong').map((g) => g.id) : [];

  const repeatWrong = () => {
    const nowSolved = new Set(solved);
    for (const g of activeGaps) if (verdicts?.[g.id] !== 'wrong') nowSolved.add(g.id);
    startRound(new Set(wrongIds), nowSolved);
  };

  const focusNext = (gapId: string) => {
    const ids = activeGaps.map((g) => g.id);
    const next = ids[ids.indexOf(gapId) + 1];
    if (next) inputs.current[next]?.focus();
    else inputs.current[gapId]?.blur();
  };

  const renderGap = (g: Gap) => {
    if (!active.has(g.id)) {
      return (
        <span key={g.id} className="gap-slot done">
          {solved.has(g.id) ? g.answers[0] : '…'}
        </span>
      );
    }
    const verdict = verdicts?.[g.id];
    const state = verdict ? (verdict === 'wrong' ? 'wrong' : 'right') : '';
    const solution = verdict === 'wrong' || verdict === 'almost' ? <span className={`gap-solution ${verdict}`}>{g.answers.join(' / ')}</span> : null;
    if (mode === 'type') {
      const width = Math.min(28, Math.max(5, ...g.answers.map((a) => a.length)) + 2);
      return (
        <span key={g.id} className="gap-wrap">
          <input
            ref={(el) => (inputs.current[g.id] = el)}
            className={`gap-input ${state}`}
            style={{ width: `${width}ch` }}
            value={values[g.id] ?? ''}
            disabled={checked}
            aria-label="Lücke"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            onChange={(e) => setValues((v) => ({ ...v, [g.id]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusNext(g.id);
              }
            }}
          />
          {solution}
        </span>
      );
    }
    const token = placed[g.id];
    return (
      <span key={g.id} className="gap-wrap">
        <button
          type="button"
          className={`gap-slot ${state}${token ? ' filled' : ''}${selGap === g.id ? ' selected' : ''}${selToken && !checked ? ' target' : ''}`}
          onClick={() => clickGap(g.id)}
          disabled={checked}
          aria-label={token ? `Lücke: ${tokenText(token)} (antippen zum Entfernen)` : 'Leere Lücke'}
          onDragOver={(e) => !checked && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/x-token');
            if (id && !checked) place(g.id, id);
          }}
          draggable={!!token && !checked}
          onDragStart={(e) => token && e.dataTransfer.setData('text/x-token', token)}
        >
          {token ? tokenText(token) : ' '}
        </button>
        {solution}
      </span>
    );
  };

  return (
    <StudyScreen
      title={title}
      subtitle={mode === 'drag' ? 'Wörter einsetzen' : 'Selbst schreiben'}
      onClose={onClose}
      actions={
        <button
          className="btn ghost small"
          onClick={() => {
            setMode(mode === 'drag' ? 'type' : 'drag');
            restartAll();
          }}
          title="Modus wechseln (startet neu)"
        >
          {mode === 'drag' ? 'Selbst schreiben' : 'Wörter einsetzen'}
        </button>
      }
    >
      <div className="study-play">
        <div className="meter wide">
          <div className="meter-fill" style={{ width: `${activeGaps.length ? (filled / activeGaps.length) * 100 : 0}%` }} />
        </div>
        <p className="muted small">
          {mode === 'drag'
            ? 'Tippe ein Wort an und dann die Lücke, in die es gehört (am PC kannst du es auch hineinziehen). Ein Wort in einer Lücke antippen schickt es zurück.'
            : 'Schreib in jede Lücke das fehlende Wort. Groß-/Kleinschreibung ist egal; mit Enter geht’s zur nächsten Lücke.'}
        </p>

        <div className="card gaps-text gaps-play pre-wrap">{segs.map((s, i) => (s.kind === 'text' ? <MathText key={i} text={s.text} /> : renderGap(s)))}</div>

        {mode === 'drag' && !checked && (
          <div
            className="gap-bank"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/x-token');
              const gap = Object.entries(placed).find(([, t]) => t === id)?.[0];
              if (gap) unplace(gap);
            }}
          >
            {freeTokens.length === 0 ? (
              <span className="muted small">Alle Wörter sind verteilt.</span>
            ) : (
              freeTokens.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`gap-token${selToken === t.id ? ' selected' : ''}`}
                  onClick={() => clickToken(t.id)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/x-token', t.id)}
                >
                  {t.text}
                </button>
              ))
            )}
          </div>
        )}

        {!checked ? (
          <button className="btn primary block" onClick={check} disabled={filled === 0}>
            Prüfen ({filled}/{activeGaps.length} ausgefüllt)
          </button>
        ) : (
          <div className="card study-done">
            <h2>
              {right} von {activeGaps.length} richtig
            </h2>
            {almost > 0 && <p className="muted small">davon {almost} mit kleinem Tippfehler – die richtige Schreibweise steht daneben.</p>}
            {wrongIds.length === 0 && solved.size + activeGaps.length === allGaps.length && <p className="study-big">🏆</p>}
            <div className="input-row wrap center">
              {wrongIds.length > 0 && (
                <button className="btn primary" onClick={repeatWrong}>
                  Nur falsche wiederholen ({wrongIds.length})
                </button>
              )}
              <button className={`btn ${wrongIds.length ? 'ghost' : 'primary'}`} onClick={restartAll}>
                Nochmal
              </button>
              <button className="btn ghost" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        )}
      </div>
    </StudyScreen>
  );
}
