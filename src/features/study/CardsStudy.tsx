import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { StudyScreen } from './StudyScreen';
import { shuffled, type Card } from './format';
import { MathText } from '../../components/MathText';

interface Round {
  /** Noch nicht gezeigte Karten; die erste ist die aktuelle. Jede Karte kommt pro Runde genau einmal dran. */
  queue: string[];
  known: number;
  /** Karten, bei denen "Nochmal" gewählt wurde – sie kommen erst in der nächsten Runde wieder. */
  missed: string[];
}

/** Lernmodus: jede Karte einmal ansehen, umdrehen, "Gewusst" oder "Nochmal" (für die nächste Runde merken). */
export function CardsStudy({ title, cards, onClose }: { title: string; cards: Card[]; onClose: () => void }) {
  const [mix, setMix] = useState(true);
  const [reverse, setReverse] = useState(false);
  const [only, setOnly] = useState<string[] | null>(null);
  // Nur neu beginnen, wenn sich wirklich andere Karten ergeben (nicht bei jedem Neuladen der Datei).
  const idsKey = cards.map((c) => c.id).join('|');
  const allIds = useMemo(() => (idsKey ? idsKey.split('|') : []), [idsKey]);
  const makeRound = useCallback(
    (ids: string[] = allIds): Round => ({ queue: mix ? shuffled(ids) : [...ids], known: 0, missed: [] }),
    [allIds, mix],
  );
  const [round, setRound] = useState<Round>(() => makeRound());
  const [flipped, setFlipped] = useState(false);

  // Einstellungen geändert -> neu beginnen.
  useEffect(() => {
    setRound(makeRound(only ?? undefined));
    setFlipped(false);
  }, [makeRound, only]);

  const total = round.known + round.missed.length + round.queue.length;
  const shown = total - round.queue.length;
  const card = cards.find((c) => c.id === round.queue[0]);
  const done = !card;

  const answer = useCallback(
    (knew: boolean) => {
      setRound((r) => {
        const [id, ...rest] = r.queue;
        if (!id) return r;
        return knew ? { ...r, queue: rest, known: r.known + 1 } : { ...r, queue: rest, missed: [...r.missed, id] };
      });
      setFlipped(false);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && (e.key === 'ArrowRight' || e.key === '1')) answer(true);
      else if (flipped && (e.key === 'ArrowLeft' || e.key === '2')) answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, flipped, answer]);

  const hard = round.missed;
  const [a, b] = card ? (reverse ? [card.back, card.front] : [card.front, card.back]) : ['', ''];

  return (
    <StudyScreen
      title={title}
      subtitle={done ? 'Fertig' : `Karte ${shown + 1} von ${total} · ${round.known} gewusst`}
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

        {done ? (
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
              <div className="input-row">
                <button className="btn ghost grow again-btn" onClick={() => answer(false)}>
                  Nochmal
                </button>
                <button className="btn primary grow" onClick={() => answer(true)}>
                  <Icon name="check" size={18} /> Gewusst
                </button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => setFlipped(true)}>
                Umdrehen
              </button>
            )}
            <p className="muted small center-text">Tippe auf die Karte zum Umdrehen. Jede Karte kommt einmal dran – „Nochmal“-Karten kannst du am Ende wiederholen.</p>
          </>
        )}
      </div>
    </StudyScreen>
  );
}
