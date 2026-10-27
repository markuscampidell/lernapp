import { useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon } from '../../components/Icon';
import { Pager, StudyScreen } from './StudyScreen';
import { newAnswer, newQuestion, questionProblem, QUIZ_EXT, QUIZ_MIME, quizBlob, type Answer, type Question } from './format';
import { useStudySave } from './useStudySave';

const MAX_ANSWERS = 6;
const LETTERS = 'ABCDEF';

/** Multiple-Choice-Quiz anlegen/bearbeiten: eine Frage pro Seite. */
export function QuizEditor({ file, folderId, initial, onClose }: { file?: FileItem; folderId?: string; initial?: Question[]; onClose: () => void }) {
  const [name, setName] = useState(file?.name ?? '');
  const [questions, setQuestions] = useState<Question[]>(() => (initial?.length ? initial : [newQuestion()]));
  const [index, setIndex] = useState(0);
  const start = useRef(JSON.stringify({ name, questions }));
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: QUIZ_EXT, mime: QUIZ_MIME });
  const questionRef = useRef<HTMLTextAreaElement>(null);

  const q = questions[Math.min(index, questions.length - 1)];
  const filled = questions.filter((x) => x.text.trim()).length;
  const dirty = JSON.stringify({ name, questions }) !== start.current;
  const bad = useMemo(() => new Set(questions.map((x, i) => (questionProblem(x) ? i : -1)).filter((i) => i >= 0)), [questions]);
  const problem = questionProblem(q);

  const update = (patch: Partial<Question>) => setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, ...patch } : x)));
  const updateAnswer = (id: string, patch: Partial<Answer>) => update({ answers: q.answers.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const go = (i: number) => {
    setIndex(i);
    setTimeout(() => questionRef.current?.focus(), 0);
  };
  const add = () => {
    setQuestions((prev) => [...prev.slice(0, index + 1), newQuestion(), ...prev.slice(index + 1)]);
    go(index + 1);
  };
  const remove = () => {
    if (q.text.trim() && !confirm('Diese Frage löschen?')) return;
    if (questions.length === 1) setQuestions([newQuestion()]);
    else {
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
      setIndex(Math.max(0, index - (index === questions.length - 1 ? 1 : 0)));
    }
  };
  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib dem Quiz einen Namen.');
    if (filled === 0) return setErr('Füge mindestens eine Frage hinzu.');
    if (bad.size) {
      const first = [...bad][0];
      setIndex(first);
      return setErr(`Frage ${first + 1}: ${questionProblem(questions[first])}`);
    }
    if (await save(name, quizBlob(questions))) onClose();
  };

  return (
    <StudyScreen
      title={file ? 'Quiz bearbeiten' : 'Neues Quiz'}
      subtitle={`${filled} ${filled === 1 ? 'Frage' : 'Fragen'}`}
      onClose={close}
      actions={
        <button className="btn primary small" onClick={submit} disabled={busy}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
      }
    >
      <div className="study-form">
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <TextLine autoFocus={!file} value={name} onChange={setName} placeholder="z. B. Quiz Lineare Algebra" maxLength={120} enterKeyHint="next" onEnter={() => questionRef.current?.focus()} />
        </div>

        <Pager index={index} count={questions.length} noun="Frage" onIndex={go} marks={bad} />

        <div className="card edit-card">
          <label className="field">
            <span className="field-label">Frage</span>
            <textarea ref={questionRef} rows={3} value={q.text} onChange={(e) => update({ text: e.target.value })} placeholder="z. B. Was ist die Ableitung von sin x?" />
          </label>

          <div className="field">
            <div className="field-label">
              <span>Antworten</span>
              <span className="muted small">Häkchen = richtig (auch mehrere)</span>
            </div>
            <div className="answer-list">
              {q.answers.map((a, i) => (
                <div key={a.id} className={`answer-edit${a.correct ? ' correct' : ''}`}>
                  <button
                    type="button"
                    className="answer-toggle"
                    aria-pressed={a.correct}
                    aria-label={a.correct ? `Antwort ${LETTERS[i]} ist richtig` : `Antwort ${LETTERS[i]} als richtig markieren`}
                    onClick={() => updateAnswer(a.id, { correct: !a.correct })}
                  >
                    {a.correct ? <Icon name="check" size={16} /> : LETTERS[i]}
                  </button>
                  <TextLine value={a.text} onChange={(text) => updateAnswer(a.id, { text })} placeholder={`Antwort ${LETTERS[i]}`} maxLength={500} />
                  {q.answers.length > 2 && (
                    <button type="button" className="icon-btn small" aria-label={`Antwort ${LETTERS[i]} entfernen`} onClick={() => update({ answers: q.answers.filter((x) => x.id !== a.id) })}>
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {q.answers.length < MAX_ANSWERS && (
              <button type="button" className="btn ghost small" onClick={() => update({ answers: [...q.answers, newAnswer()] })}>
                <Icon name="plus" size={16} /> Antwort
              </button>
            )}
          </div>

          <label className="field">
            <span className="field-label">
              <span>Erklärung</span>
              <span className="muted small">optional, wird nach dem Antworten gezeigt</span>
            </span>
            <textarea rows={2} value={q.explanation ?? ''} onChange={(e) => update({ explanation: e.target.value })} />
          </label>
          {problem && q.text.trim() && <p className="notice warning">{problem}</p>}
        </div>

        <div className="input-row">
          <button className="btn ghost danger" onClick={remove}>
            <Icon name="trash" size={18} /> Frage löschen
          </button>
          <button className="btn primary grow" onClick={add}>
            <Icon name="plus" size={18} /> Neue Frage
          </button>
        </div>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}
