import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { StudyScreen } from './StudyScreen';
import { shuffled, type Question } from './format';

const LETTERS = 'ABCDEF';

interface Result {
  id: string;
  ok: boolean;
}

/** Quizmodus: eine Frage nach der anderen, sofortige Rückmeldung, Auswertung am Ende. */
export function QuizPlay({ title, questions, onClose }: { title: string; questions: Question[]; onClose: () => void }) {
  const [mix, setMix] = useState(true);
  const prepare = (list: Question[], m: boolean) => (m ? shuffled(list) : list).map((q) => ({ ...q, answers: m ? shuffled(q.answers) : q.answers }));
  const [order, setOrder] = useState<Question[]>(() => prepare(questions, true));
  const [pos, setPos] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const restart = (list: Question[], m = mix) => {
    setOrder(prepare(list, m));
    setPos(0);
    setPicked(new Set());
    setChecked(false);
    setResults([]);
  };

  const q = order[pos];
  const done = !q;
  const multi = q ? q.answers.filter((a) => a.correct).length > 1 : false;
  const score = results.filter((r) => r.ok).length;
  const wrong = useMemo(() => results.filter((r) => !r.ok).map((r) => questions.find((x) => x.id === r.id)!).filter(Boolean), [results, questions]);

  const check = (sel: Set<string>) => {
    const ok = q.answers.every((a) => a.correct === sel.has(a.id));
    setResults((r) => [...r, { id: q.id, ok }]);
    setChecked(true);
  };
  const pick = (id: string) => {
    if (checked) return;
    if (!multi) {
      const sel = new Set([id]);
      setPicked(sel);
      check(sel);
      return;
    }
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const next = () => {
    setPos((p) => p + 1);
    setPicked(new Set());
    setChecked(false);
  };

  const lastOk = results[results.length - 1]?.ok;

  return (
    <StudyScreen
      title={title}
      subtitle={done ? 'Auswertung' : `Frage ${pos + 1} von ${order.length}`}
      onClose={onClose}
      actions={
        <button
          className={`icon-btn toggle${mix ? ' on' : ''}`}
          aria-pressed={mix}
          aria-label="Mischen"
          title="Fragen & Antworten mischen (startet neu)"
          onClick={() => {
            setMix(!mix);
            restart(questions, !mix);
          }}
        >
          <Icon name="shuffle" />
        </button>
      }
    >
      <div className="study-play">
        <div className="meter wide">
          <div className="meter-fill" style={{ width: `${order.length ? ((pos + (checked ? 1 : 0)) / order.length) * 100 : 0}%` }} />
        </div>

        {done ? (
          <div className="card study-done">
            <p className="study-big">{score === order.length ? '🏆' : score >= order.length / 2 ? '👍' : '📚'}</p>
            <h2>
              {score} von {order.length} richtig
            </h2>
            <p className="muted">{Math.round((score / Math.max(1, order.length)) * 100)} %</p>
            {wrong.length > 0 && (
              <div className="quiz-review">
                <h3 className="section-title">Falsch beantwortet</h3>
                {wrong.map((w) => (
                  <div key={w.id} className="quiz-review-item">
                    <strong className="pre-wrap">{w.text}</strong>
                    <span className="muted small">
                      Richtig: {w.answers.filter((a) => a.correct).map((a) => a.text).join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="input-row wrap center">
              {wrong.length > 0 && (
                <button className="btn primary" onClick={() => restart(wrong)}>
                  Falsche wiederholen ({wrong.length})
                </button>
              )}
              <button className={`btn ${wrong.length ? 'ghost' : 'primary'}`} onClick={() => restart(questions)}>
                Nochmal
              </button>
              <button className="btn ghost" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="card quiz-question">
              <p className="quiz-text pre-wrap">{q.text}</p>
              {multi && <span className="muted small">Mehrere Antworten sind richtig.</span>}
            </div>
            <div className="quiz-options">
              {q.answers.map((a, i) => {
                const state = checked ? (a.correct ? 'right' : picked.has(a.id) ? 'wrong' : 'dim') : picked.has(a.id) ? 'picked' : '';
                return (
                  <button key={a.id} className={`quiz-option ${state}`} onClick={() => pick(a.id)} disabled={checked}>
                    <span className="quiz-letter">{checked && a.correct ? <Icon name="check" size={16} /> : checked && picked.has(a.id) ? <Icon name="close" size={16} /> : LETTERS[i]}</span>
                    <span className="grow pre-wrap">{a.text}</span>
                  </button>
                );
              })}
            </div>
            {checked ? (
              <>
                <p className={`notice ${lastOk ? 'good' : 'critical'}`}>
                  <strong>{lastOk ? 'Richtig!' : 'Leider falsch.'}</strong>
                  {q.explanation && <span className="pre-wrap"> {q.explanation}</span>}
                </p>
                <button className="btn primary block" onClick={next}>
                  {pos + 1 < order.length ? 'Weiter' : 'Auswertung'}
                </button>
              </>
            ) : (
              multi && (
                <button className="btn primary block" disabled={picked.size === 0} onClick={() => check(picked)}>
                  Prüfen
                </button>
              )
            )}
          </>
        )}
      </div>
    </StudyScreen>
  );
}
