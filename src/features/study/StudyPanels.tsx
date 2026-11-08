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
import { isDue, MAX_BOX, nextDue, useCardProgress } from './progress';

const whenText = (ms: number) => {
  const days = Math.max(1, Math.round((ms - Date.now()) / 86_400_000));
  return days === 1 ? 'morgen' : `in ${days} Tagen`;
};

const LETTERS = 'ABCDEF';

/** Ansicht einer Karteikarten-Datei: Lernen, Bearbeiten, alle Karten. */
export function CardsPanel({ file, text }: { file: FileItem; text: string }) {
  const { canModify, online } = useLibrary();
  const doc = useMemo(() => parseCards(text), [text]);
  const [mode, setMode] = useState<'study' | 'review' | 'edit' | null>(null);
  const editable = canModify(file) && (!file.shareId || online);
  const n = doc.cards.length;
  const progress = useCardProgress(file);
  const ids = useMemo(() => doc.cards.map((c) => c.id), [doc.cards]);
  const due = doc.cards.filter((c) => isDue(progress.map[c.id]));
  const known = doc.cards.filter((c) => (progress.map[c.id]?.box ?? 0) >= 3).length;
  const learned = doc.cards.filter((c) => progress.map[c.id]).length;
  // Beim Start von „Wiederholen“ festhalten, welche Karten dran sind (sonst schrumpft die Liste beim Lernen).
  const [reviewCards, setReviewCards] = useState<typeof doc.cards>([]);
  const next = due.length === 0 ? nextDue(progress.map, ids) : null;

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
      </div>
      {n > 0 && (
        <div className="card review-card">
          <div className="review-stats">
            <div>
              <strong className="review-num">{due.length}</strong>
              <span className="muted small">fällig</span>
            </div>
            <div>
              <strong className="review-num">{learned - known}</strong>
              <span className="muted small">in Arbeit</span>
            </div>
            <div>
              <strong className="review-num">{known}</strong>
              <span className="muted small">sitzen</span>
            </div>
            <div>
              <strong className="review-num">{n - learned}</strong>
              <span className="muted small">neu</span>
            </div>
          </div>
          <div className="box-bar" aria-hidden="true">
            {Array.from({ length: MAX_BOX + 1 }, (_, b) => {
              const count = doc.cards.filter((c) => (progress.map[c.id]?.box ?? 0) === b && (b > 0 || progress.map[c.id])).length;
              return count ? <span key={b} className={`box-seg b${b}`} style={{ flexGrow: count }} title={`Stufe ${b}: ${count}`} /> : null;
            })}
            {n - learned > 0 && <span className="box-seg new" style={{ flexGrow: n - learned }} />}
          </div>
          <div className="input-row wrap">
            <button
              className="btn primary grow"
              disabled={due.length === 0}
              onClick={() => {
                setReviewCards(due);
                setMode('review');
              }}
            >
              {due.length ? `Wiederholen (${due.length})` : next ? `Nichts fällig – wieder ${whenText(next)}` : 'Nichts fällig'}
            </button>
            <button className="btn ghost" onClick={() => setMode('study')}>
              Alle lernen
            </button>
          </div>
          <p className="muted small">
            Wiederholen zeigt nur, was heute dran ist: Was du weißt, kommt immer seltener (1, 3, 7, 14 … Tage), was du nicht weißt, gleich wieder.
            {file.shareId ? ' Dein Lernstand gilt nur für dich – auf all deinen Geräten.' : ''}
            {learned > 0 && (
              <>
                {' '}
                <button className="link" onClick={() => confirm('Lernstand dieser Karteikarten zurücksetzen? Alle Karten gelten dann wieder als neu.') && progress.reset()}>
                  Zurücksetzen
                </button>
              </>
            )}
          </p>
          {progress.notReady && <p className="notice warning">Lernstand wird noch nicht synchronisiert: Bitte supabase/009_lernstand_kommentare.sql im Supabase „SQL Editor“ ausführen.</p>}
        </div>
      )}
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
      {mode === 'study' && <CardsStudy title={file.name} cards={doc.cards} onGrade={progress.record} onClose={() => setMode(null)} />}
      {mode === 'review' && (
        <CardsStudy title={file.name} cards={reviewCards} review onGrade={progress.record} progress={progress.map} allIdsForNext={ids} onClose={() => setMode(null)} />
      )}
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
        <div className="toggle-row small-toggle">
          <span>Richtige Antworten anzeigen</span>
          <input type="checkbox" className="switch" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
        </div>
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
