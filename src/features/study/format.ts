// Eigene Lern-Dateien der App. Sie werden wie normale Dateien gespeichert (JSON-Inhalt),
// funktionieren dadurch auch in geteilten Ordnern, offline und im Backup.
import { newId } from '../../lib/id';

export const CARDS_EXT = 'karten';
export const CARDS_MIME = 'application/vnd.lernapp.karten+json';
export const QUIZ_EXT = 'quiz';
export const QUIZ_MIME = 'application/vnd.lernapp.quiz+json';

export interface Card {
  id: string;
  front: string;
  back: string;
}
export interface CardsDoc {
  type: 'lernapp-karten';
  version: 1;
  cards: Card[];
}

export interface Answer {
  id: string;
  text: string;
  correct: boolean;
}
export interface Question {
  id: string;
  text: string;
  answers: Answer[];
  explanation?: string;
}
export interface QuizDoc {
  type: 'lernapp-quiz';
  version: 1;
  questions: Question[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

export const newCard = (): Card => ({ id: newId(), front: '', back: '' });
export const newAnswer = (correct = false): Answer => ({ id: newId(), text: '', correct });
export const newQuestion = (): Question => ({ id: newId(), text: '', answers: [newAnswer(true), newAnswer(), newAnswer()] });

/** Liest Karteikarten tolerant ein (kaputte/fehlende Felder werden ergänzt). */
export function parseCards(text: string): CardsDoc {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(text);
  } catch {
    /* leer */
  }
  return {
    type: 'lernapp-karten',
    version: 1,
    cards: arr(raw.cards).map((c) => ({ id: str(c.id) || newId(), front: str(c.front), back: str(c.back) })),
  };
}

export function parseQuiz(text: string): QuizDoc {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(text);
  } catch {
    /* leer */
  }
  return {
    type: 'lernapp-quiz',
    version: 1,
    questions: arr(raw.questions).map((q) => ({
      id: str(q.id) || newId(),
      text: str(q.text),
      explanation: str(q.explanation) || undefined,
      answers: arr(q.answers).map((a) => ({ id: str(a.id) || newId(), text: str(a.text), correct: a.correct === true })),
    })),
  };
}

const toBlob = (doc: unknown, mime: string) => new Blob([JSON.stringify(doc, null, 1)], { type: mime });

/** Leere Karten weglassen und als Datei-Inhalt verpacken. */
export function cardsBlob(cards: Card[]): Blob {
  const doc: CardsDoc = { type: 'lernapp-karten', version: 1, cards: cards.filter((c) => c.front.trim() || c.back.trim()) };
  return toBlob(doc, CARDS_MIME);
}

/** Leere Fragen/Antworten weglassen und als Datei-Inhalt verpacken. */
export function quizBlob(questions: Question[]): Blob {
  const doc: QuizDoc = {
    type: 'lernapp-quiz',
    version: 1,
    questions: questions
      .map((q) => ({ ...q, explanation: q.explanation?.trim() || undefined, answers: q.answers.filter((a) => a.text.trim()) }))
      .filter((q) => q.text.trim()),
  };
  return toBlob(doc, QUIZ_MIME);
}

/** Prüft eine Quizfrage; null = in Ordnung. */
export function questionProblem(q: Question): string | null {
  if (!q.text.trim()) return null; // leere Fragen werden beim Speichern ignoriert
  const filled = q.answers.filter((a) => a.text.trim());
  if (filled.length < 2) return 'Jede Frage braucht mindestens zwei Antworten.';
  if (!filled.some((a) => a.correct)) return 'Markiere mindestens eine richtige Antwort.';
  return null;
}

/** Fisher-Yates-Mischen (neue Liste). */
export function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
