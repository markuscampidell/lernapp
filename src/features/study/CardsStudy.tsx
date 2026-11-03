import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { StudyScreen } from './StudyScreen';
import { shuffled, type Card } from './format';
import { MathText } from '../../components/MathText';
import { nextDue, type Grade, type ProgressMap } from './progress';

interface Round {
  /** Noch nicht gezeigte Karten; die erste ist die aktuelle. Jede Karte kommt pro Runde genau einmal dran. */
  queue: string[];
  known: number;
  /** Karten, bei denen "Nochmal" gewählt wurde – sie kommen erst in der nächsten Runde wieder (beim Wiederholen: gleich nochmal). */
  missed: string[];
  /** Beim Wiederholen: wie oft „Nochmal“ gedrückt wurde (für die Zusammenfassung). */
  again: number;
}

const formatIn = (ms: number) => {
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
};

/**
 * Lernmodus: Karte ansehen, umdrehen, bewerten.
 * review = „Wiederholen“: nur fällige Karten, „Nochmal“-Karten kommen in derselben Runde wieder; jede Antwort zählt für den Lernstand.
 * Sonst „Alle lernen“: jede Karte einmal, „Nochmal“-Karten am Ende wiederholbar.
 */
export function CardsStudy({
  title,
  cards,
  onClose,
  review = false,
  onGrade,
  progress,
  allIdsForNext,
}: {
  title: string;
  cards: Card[];
  onClose: () => void;
  review?: boolean;
  onGrade?: (cardId: string, grade: Grade) => void;
  progress?: ProgressMap;
  /** Alle Karten der Datei (für „nächste Wiederholung …“). */
  allIdsForNext?: string[];
}) {
  const [mix, setMix] = useState(true);
  const [reverse, setReverse] = useState(false);
  const [only, setOnly] = useState<string[] | null>(null);
  // Nur neu beginnen, wenn sich wirklich andere Karten ergeben (nicht bei jedem Neuladen der Datei).
  const idsKey = cards.map((c) => c.id).join('|');
  const allIds = useMemo(() => (idsKey ? idsKey.split('|') : []), [idsKey]);
  const makeRound = useCallback(
    (ids: string[] = allIds): Round => ({ queue: mix ? shuffled(ids) : [...ids], known: 0, missed: [], again: 0 }),
    [allIds, mix],
  );
  const [round, setRound] = useState<Round>(() => makeRound());
  const [flipped, setFlipped] = useState(false);

  // Einstellungen geändert -> neu beginnen. (Beim Wiederholen nicht: die fälligen Karten ändern sich durchs Lernen selbst.)
  useEffect(() => {
    if (review && round.known + round.again > 0) return;
    setRound(makeRound(only ?? undefined));
    setFlipped(false);
  }, [makeRound, only]);

  const total = review ? allIds.length : round.known + round.missed.length + round.queue.length;
  const shown = review ? Math.min(total, round.known) : total - round.queue.length;
  const card = cards.find((c) => c.id === round.queue[0]);
  const done = !card;

  const answer = useCallback(
    (grade: Grade) => {
      const id = round.queue[0];
      if (!id) return;
      onGrade?.(id, grade);
      setRound((r) => {
        const [first, ...rest] = r.queue;
        if (first !== id) return r;
        if (grade !== 'again') return { ...r, queue: rest, known: r.known + 1 };
        // Wiederholen: gleich nochmal (ans Ende), sonst für die nächste Runde merken.
        return review
          ? { ...r, queue: [...rest, id], again: r.again + 1, missed: r.missed.includes(id) ? r.missed : [...r.missed, id] }
          : { ...r, queue: rest, missed: [...r.missed, id] };
      });
      setFlipped(false);
    },
    [round.queue, onGrade, review],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && (e.key === 'ArrowRight' || e.key === '3')) answer('good');
      else if (flipped && (e.key === 'ArrowDown' || e.key === '2')) answer('hard');
      else if (flipped && (e.key === 'ArrowLeft' || e.key === '1')) answer('again');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, flipped, answer]);

  const hard = round.missed;
  const next = review && done && progress && allIdsForNext ? nextDue(progress, allIdsForNext) : null;
  const [a, b] = card ? (reverse ? [card.back, card.front] : [card.front, card.back]) : ['', ''];

  return (
    <StudyScreen
      title={title}
      subtitle={done ? 'Fertig' : review ? `Wiederholen · noch ${round.queue.length}` : `Karte ${shown + 1} von ${total} · ${round.known} gewusst`}
      onClose={onClose}
      actions={
        <>
          <button className={`icon-btn toggle${mix ? ' on' : ''}`} aria-pressed={mix} aria-label="Mischen" title="Mischen" onClick={() => setMix(!mix)}>
            <Icon name="shuffle" />
          </button>
          <button className={`icon-btn toggle${reverse ? ' on' : ''}`} aria-pressed={reverse} aria-label="Rückseite zuerst" title="Rückseite zuerst" onClick={() => setReverse(!reverse)}>
            <Icon name="swap" />
          </button>
        </>
      }
    >
      <div className="study-play">
        <div className="meter wide">
          <div className="meter-fill" style={{ width: `${total ? (shown / total) * 100 : 0}%` }} />
        </div>

        {done && review ? (
          <div className="card study-done">
            <p className="study-big">🎉</p>
            <h2>Für heute geschafft!</h2>
            <p className="muted">
              {round.known} {round.known === 1 ? 'Karte' : 'Karten'} wiederholt
              {round.again > 0 ? ` – ${round.again}× „Nochmal“.` : '.'}
              {next ? ` Nächste Wiederholung: ${formatIn(next)}.` : ''}
            </p>
            <div className="input-row wrap center">
              <button className="btn primary" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="card study-done">
            <p className="study-big">🎉</p>
            <h2>Geschafft!</h2>
            <p className="muted">
              {total} {total === 1 ? 'Karte' : 'Karten'} gelernt
              {hard.length > 0 ? ` – ${round.known} gewusst, ${hard.length} zum Wiederholen.` : ' – alle gewusst.'}
            </p>
            <div className="input-row wrap center">
              {hard.length > 0 && (
                <button className="btn primary" onClick={() => (only?.join() === hard.join() ? setRound(makeRound(hard)) : setOnly(hard))}>
                  Nur die schweren ({hard.length})
                </button>
              )}
              <button className={`btn ${hard.length ? 'ghost' : 'primary'}`} onClick={() => (only ? setOnly(null) : setRound(makeRound()))}>
                Alle nochmal
              </button>
              <button className="btn ghost" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className={`flashcard${flipped ? ' flipped' : ''}`} onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Rückseite – tippen zum Umdrehen' : 'Vorderseite – tippen zum Umdrehen'}>
              <span className="flashcard-inner">
                <span className="flashcard-face front">
                  <span className="flashcard-label">{reverse ? 'Rückseite' : 'Vorderseite'}</span>
                  <span className="flashcard-text">{a ? <MathText text={a} /> : <span className="muted">(leer)</span>}</span>
                </span>
                <span className="flashcard-face back">
                  <span className="flashcard-label">{reverse ? 'Vorderseite' : 'Rückseite'}</span>
                  <span className="flashcard-text">{b ? <MathText text={b} /> : <span className="muted">(leer)</span>}</span>
                </span>
              </span>
            </button>
            {flipped ? (
              <div className="input-row grade-row">
                <button className="btn ghost grow again-btn" onClick={() => answer('again')} title="Taste 1 / ←">
                  Nochmal
                </button>
                <button className="btn ghost grow hard-btn" onClick={() => answer('hard')} title="Taste 2 / ↓">
                  Unsicher
                </button>
                <button className="btn primary grow" onClick={() => answer('good')} title="Taste 3 / →">
                  <Icon name="check" size={18} /> Gewusst
                </button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => setFlipped(true)}>
                Umdrehen
              </button>
            )}
            <p className="muted small center-text">
              {review
                ? 'Gewusst → kommt erst in ein paar Tagen wieder (immer seltener). Unsicher → morgen. Nochmal → gleich noch einmal.'
                : 'Tippe auf die Karte zum Umdrehen. Jede Karte kommt einmal dran – „Nochmal“-Karten kannst du am Ende wiederholen.'}
            </p>
          </>
        )}
      </div>
    </StudyScreen>
  );
}
