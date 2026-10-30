import { useMemo, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Icon } from '../../components/Icon';
import { parseCards, parseQuiz } from './format';
import { CardsEditor } from './CardsEditor';
import { CardsStudy } from './CardsStudy';
import { QuizEditor } from './QuizEditor';
import { QuizPlay } from './QuizPlay';
import { MathText } from '../../components/MathText';

const LETTERS = 'ABCDEF';

/** Ansicht einer Karteikarten-Datei: Lernen, Bearbeiten, alle Karten. */
export function CardsPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const doc = useMemo(() => parseCards(text), [text]);
  const [mode, setMode] = useState<'study' | 'edit' | null>(null);
  const editable = canModify(file) && (!file.shareId || online);
  const n = doc.cards.length;

  return (
    <div className="study-panel">
      <div className="card study-hero">
        <span className="thumb file-thumb kind-flashcards">
          <Icon name="cards" size={22} />
        </span>
        <div className="grow">
          <strong>
            {n} {n === 1 ? 'Karte' : 'Karten'}
          </strong>
        </div>
        {editable && (
          <button className="btn ghost" onClick={() => setMode('edit')}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        )}
        <button className="btn primary" onClick={() => setMode('study')} disabled={n === 0}>
          Lernen
        </button>
      </div>
      {n === 0 ? (
        <p className="muted center-text">Noch keine Karten.</p>
      ) : (
        <ol className="study-list">
          {doc.cards.map((c) => (
            <li key={c.id} className="card study-item">
              <span className="pre-wrap"><MathText text={c.front} /></span>
              <span className="muted pre-wrap"><MathText text={c.back} /></span>
            </li>
          ))}
        </ol>
      )}
      {mode === 'study' && <CardsStudy title={file.name} cards={doc.cards} onClose={() => setMode(null)} />}
      {mode === 'edit' && <CardsEditor file={file} initial={doc.cards} onClose={() => setMode(null)} />}
    </div>
  );
}

/** Ansicht einer Quiz-Datei: Quiz starten, Bearbeiten, alle Fragen. */
export function QuizPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const doc = useMemo(() => parseQuiz(text), [text]);
  const [mode, setMode] = useState<'play' | 'edit' | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const editable = canModify(file) && (!file.shareId || online);
  const n = doc.questions.length;

  return (
    <div className="study-panel">
      <div className="card study-hero">
        <span className="thumb file-thumb kind-quiz">
          <Icon name="quiz" size={22} />
        </span>
        <div className="grow">
          <strong>
            {n} {n === 1 ? 'Frage' : 'Fragen'}
          </strong>
        </div>
        {editable && (
          <button className="btn ghost" onClick={() => setMode('edit')}>
            <Icon name="edit" size={18} /> Bearbeiten
          </button>
        )}
        <button className="btn primary" onClick={() => setMode('play')} disabled={n === 0}>
          Quiz starten
        </button>
      </div>
      {n > 0 && (
        <label className="toggle-row small-toggle">
          <span>Richtige Antworten anzeigen</span>
          <input type="checkbox" className="switch" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
        </label>
      )}
      {n === 0 ? (
        <p className="muted center-text">Noch keine Fragen.</p>
      ) : (
        <ol className="study-list">
          {doc.questions.map((q) => (
            <li key={q.id} className="card study-item">
              <strong className="pre-wrap"><MathText text={q.text} /></strong>
              <ul className="study-answers">
                {q.answers.map((a, i) => (
                  <li key={a.id} className={showAnswers && a.correct ? 'right' : ''}>
                    <span className="quiz-letter small">{showAnswers && a.correct ? <Icon name="check" size={13} /> : LETTERS[i]}</span>
                    <span className="pre-wrap"><MathText text={a.text} /></span>
                  </li>
                ))}
              </ul>
              {showAnswers && q.explanation && <span className="muted small pre-wrap"><MathText text={q.explanation} /></span>}
            </li>
          ))}
        </ol>
      )}
      {mode === 'play' && <QuizPlay title={file.name} questions={doc.questions} onClose={() => setMode(null)} />}
      {mode === 'edit' && <QuizEditor file={file} initial={doc.questions} onClose={() => setMode(null)} />}
    </div>
  );
}
