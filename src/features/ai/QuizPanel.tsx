import { useState } from 'react';
import type { FileItem } from '../../domain/types';
import { Icon } from '../../components/Icon';
import { answerQuestion, cancel, runQuiz } from './runner';
import { updateSession, useSession, type SourceRef } from './session';

const COUNTS = [5, 10, 15];

export function QuizPanel({ files, renderSource }: { files: FileItem[]; renderSource: (s: SourceRef, key: string) => React.ReactNode }) {
  const { quiz, busy, status } = useSession();
  const [count, setCount] = useState(10);

  if (!quiz) {
    return (
      <div className="card stack quiz-setup">
        <div>
          <h2>Quiz erstellen</h2>
          <p className="muted small">
            Die KI erstellt Multiple-Choice-Fragen aus deinen Unterlagen – verteilt über alle gewählten Dateien. Jede Frage zeigt,
            aus welcher Datei sie stammt. Das dauert meist nur einige Sekunden.
          </p>
        </div>
        <div className="field">
          <div className="field-label">
            <span>Anzahl Fragen</span>
          </div>
          <div className="segmented">
            {COUNTS.map((c) => (
              <button key={c} className={count === c ? 'on' : ''} onClick={() => setCount(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary" disabled={busy || files.length === 0} onClick={() => runQuiz(count, files)}>
          <Icon name="ai" size={18} /> Quiz erstellen
        </button>
      </div>
    );
  }

  const answered = quiz.questions.filter((q) => q.picked !== undefined);
  const correct = answered.filter((q) => q.picked === q.richtig).length;
  const finished = quiz.done && answered.length === quiz.questions.length && quiz.questions.length > 0;

  return (
    <div className="quiz">
      <div className="quiz-head">
        <strong>
          Quiz · {quiz.questions.length}
          {!quiz.done ? ` von ${quiz.target}` : ''} Fragen
        </strong>
        <span className="muted small">
          {correct} von {answered.length} richtig
        </span>
      </div>

      {quiz.questions.map((q, i) => {
        const done = q.picked !== undefined;
        return (
          <div key={q.id} className="card quiz-card">
            <p className="muted small">Frage {i + 1}</p>
            <h3 className="quiz-q">{q.frage}</h3>
            <div className="quiz-options">
              {q.antworten.map((a, j) => {
                const cls = !done ? '' : j === q.richtig ? ' right' : j === q.picked ? ' wrong' : ' dim';
                return (
                  <button key={j} className={`quiz-option${cls}`} disabled={done} onClick={() => answerQuestion(q.id, j)}>
                    <span className="quiz-letter">{'ABCD'[j]}</span>
                    <span className="grow">{a}</span>
                    {done && j === q.richtig && <Icon name="check" size={18} />}
                    {done && j === q.picked && j !== q.richtig && <Icon name="close" size={18} />}
                  </button>
                );
              })}
            </div>
            {done && (
              <div className={`quiz-feedback ${q.picked === q.richtig ? 'good' : 'bad'}`}>
                <strong>{q.picked === q.richtig ? 'Richtig!' : 'Leider falsch.'}</strong>
                {q.erklaerung && <span> {q.erklaerung}</span>}
                <div className="quiz-source">Quelle: {renderSource(q.source, `s${q.id}`)}</div>
              </div>
            )}
          </div>
        );
      })}

      {!quiz.done && (
        <div className="card quiz-pending">
          <span className="typing" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="muted small grow">{status ?? 'Wird vorbereitet …'}</span>
          <button className="btn ghost small" onClick={cancel}>
            Stopp
          </button>
        </div>
      )}

      {quiz.done && quiz.note && <p className="notice warning">{quiz.note}</p>}

      {finished && (
        <div className="card quiz-result">
          <h2>
            {correct} von {quiz.questions.length} richtig
          </h2>
          <p className="muted">
            {correct === quiz.questions.length
              ? 'Perfekt!'
              : correct >= quiz.questions.length * 0.7
                ? 'Sehr gut – schau dir die falschen Fragen noch einmal an.'
                : 'Lies die Stellen bei den falschen Fragen noch einmal nach.'}
          </p>
        </div>
      )}

      {quiz.done && (
        <button className="btn primary block" disabled={busy} onClick={() => updateSession({ quiz: null })}>
          <Icon name="refresh" size={18} /> Neues Quiz
        </button>
      )}
    </div>
  );
}
