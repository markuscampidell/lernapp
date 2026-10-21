import type { FileItem } from '../../domain/types';
import { fullName } from '../../lib/files';
import { generateJson, streamText, type Turn } from '../../ai/gemini';
import { fileText, type Chunk } from '../../ai/text';
import { buildIndex, search, spread, type Index } from '../../ai/search';
import { getSession, newId, updateSession, type Message, type QuizQuestion, type SourceRef } from './session';

/*
 * Ablauf der KI (Google Gemini über unseren Worker):
 *  1. Text aus den gewählten Dateien lesen und in Abschnitte teilen.
 *  2. Fragen: Passen alle Unterlagen in die Anfrage, bekommt die KI alles; sonst nur die passendsten Abschnitte.
 *  3. Quiz: Abschnitte über alle Dateien verteilt wählen, die KI erstellt alle Fragen in einem Durchgang.
 */

const CONTEXT_CHARS = 60_000; // ca. 15 000 Tokens Unterlagen pro Anfrage
const QUIZ_CHARS = 40_000;

let controller: AbortController | null = null;
let indexCache: { signature: string; chunks: Chunk[]; index: Index } | null = null;

const signatureOf = (files: FileItem[]) => files.map((f) => `${f.id}:${f.updatedAt}`).join('|');
const ref = (c: Chunk): SourceRef => ({ fileId: c.fileId, loc: c.loc });
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

async function loadChunks(files: FileItem[]) {
  const sig = signatureOf(files);
  if (indexCache?.signature === sig) return indexCache;
  const chunks: Chunk[] = [];
  const unreadable: { name: string; reason: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    updateSession({ status: `Unterlagen werden gelesen … ${i + 1}/${files.length}` });
    const r = await fileText(files[i]);
    if (r.ok) chunks.push(...r.chunks);
    else unreadable.push({ name: fullName(files[i]), reason: r.reason });
  }
  updateSession({ unreadable, status: null });
  indexCache = { signature: sig, chunks, index: buildIndex(chunks) };
  return indexCache;
}

/** Nimmt Abschnitte, solange sie in die Anfrage passen. */
function fit(chunks: Chunk[], maxChars = CONTEXT_CHARS): Chunk[] {
  const out: Chunk[] = [];
  let total = 0;
  for (const c of chunks) {
    if (total + c.text.length > maxChars && out.length) break;
    out.push(c);
    total += c.text.length;
  }
  return out;
}

const totalChars = (chunks: Chunk[]) => chunks.reduce((s, c) => s + c.text.length, 0);
const OVERVIEW = /zusammenfass|überblick|ueberblick|kernaussage|worum geht|wichtigste|hauptthem|lernzettel/i;

const CHAT_SYSTEM = `Du bist der Lernassistent der App „Lernapp“. Du bekommst Auszüge aus den Unterlagen des Nutzers – jeder ist als [Quelle N] nummeriert – und beantwortest Fragen dazu.

Regeln:
1. Verwende ausschließlich Informationen aus den Auszügen. Fülle keine Lücken mit Allgemeinwissen und rate nie.
2. Steht die Antwort nicht in den Auszügen, sag klar: „Das steht nicht in deinen Unterlagen.“ Du darfst nennen, was es an verwandten Informationen gibt.
3. Belege deine Aussagen mit Quellenangaben im Format [Quelle N].
4. Wirken Unterlagen widersprüchlich oder offensichtlich fehlerhaft, weise auf die Stelle hin, statt sie still aus eigenem Wissen zu korrigieren.
5. Antworte in der Sprache der Frage (meist Deutsch), klar und gut strukturiert. Markdown ist erlaubt (Überschriften, Listen, **fett**). Formeln schreibst du lesbar, z. B. a² + b² = c².
6. Aufgaben wie „fasse zusammen“, „erstelle Lernfragen“ oder „erkläre“ sind erlaubt – aber nur auf Basis der Auszüge.`;

function patchMessage(id: number, p: Partial<Message>) {
  updateSession((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
}

export function cancel() {
  controller?.abort();
}

/** Eine Frage stellen (Chat). */
export async function ask(question: string, files: FileItem[], opts: { retry?: boolean } = {}) {
  const q = question.trim();
  if (!q || getSession().busy || files.length === 0) return;
  const ctrl = new AbortController();
  controller = ctrl;
  let messages = getSession().messages.filter((m) => m.role !== 'error');
  if (!opts.retry) messages = [...messages, { id: newId(), role: 'user', text: q }];
  const answer: Message = { id: newId(), role: 'model', text: '', pending: true };
  updateSession({ messages: [...messages, answer], busy: true });

  try {
    const { chunks, index } = await loadChunks(files);
    if (!chunks.length) throw new Error('Aus den gewählten Dateien konnte kein Text gelesen werden.');

    // Alles mitschicken, wenn es passt – sonst die passendsten Stellen (vorherige Frage hilft bei Rückfragen).
    let picked: Chunk[];
    if (totalChars(chunks) <= CONTEXT_CHARS) picked = chunks;
    else {
      const prevUser = messages.filter((m) => m.role === 'user').slice(-2, -1)[0]?.text ?? '';
      picked = OVERVIEW.test(q) ? spread(chunks, 80) : search(index, q, 50);
      if (!picked.length && prevUser) picked = search(index, `${q} ${prevUser}`, 50);
      if (!picked.length) picked = spread(chunks, 80);
      picked = fit(picked);
    }
    updateSession({ status: null });

    const excerpt = picked.map((c, i) => `[Quelle ${i + 1}] aus „${c.fileName}“${c.loc ? `, ${c.loc}` : ''}:\n${c.text}`).join('\n\n');
    // Bisheriger Verlauf (nur Text), damit Rückfragen funktionieren.
    const history: Turn[] = messages
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'model')
      .slice(-8)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text.slice(0, 3000) }] }));
    const contents: Turn[] = [
      ...history,
      { role: 'user', parts: [{ text: `Auszüge aus meinen Unterlagen:\n\n${excerpt}\n\nMeine Frage: ${q}` }] },
    ];
    patchMessage(answer.id, { sources: picked.map(ref) });
    let text = '';
    for await (const t of streamText(CHAT_SYSTEM, contents, { signal: ctrl.signal })) {
      text = t;
      patchMessage(answer.id, { text });
    }
    patchMessage(answer.id, { pending: false, text: text || 'Keine Antwort erhalten.' });
  } catch (e) {
    const cur = getSession().messages.find((m) => m.id === answer.id);
    const aborted = isAbort(e) || ctrl.signal.aborted;
    if (aborted && cur?.text) patchMessage(answer.id, { pending: false, text: `${cur.text}\n\n_(Abgebrochen)_` });
    else
      updateSession((s) => ({
        messages: s.messages
          .filter((m) => m.id !== answer.id)
          .concat({ id: newId(), role: 'error', text: aborted ? 'Abgebrochen.' : e instanceof Error ? e.message : 'Unbekannter Fehler.' }),
      }));
  } finally {
    if (controller === ctrl) controller = null;
    updateSession({ busy: false, status: null });
  }
}

// ---------- Quiz ----------

const QUIZ_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fragen: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          frage: { type: 'STRING' },
          antworten: { type: 'ARRAY', items: { type: 'STRING' } },
          richtig: { type: 'INTEGER' },
          erklaerung: { type: 'STRING' },
          abschnitt: { type: 'INTEGER' },
        },
        required: ['frage', 'antworten', 'richtig', 'erklaerung', 'abschnitt'],
      },
    },
  },
  required: ['fragen'],
};

interface RawQuestion {
  frage?: unknown;
  antworten?: unknown;
  richtig?: unknown;
  erklaerung?: unknown;
  abschnitt?: unknown;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Abschnitte für das Quiz: abwechselnd aus allen Dateien, zufällig, bis die Textmenge erreicht ist. */
function pickQuizChunks(chunks: Chunk[]): Chunk[] {
  const byFile = new Map<string, Chunk[]>();
  for (const c of chunks) if (c.text.trim().length >= 40) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c]);
  const lists = shuffle([...byFile.values()].map((l) => shuffle(l)));
  const out: Chunk[] = [];
  for (let round = 0; lists.some((l) => l.length > round); round++) for (const l of lists) if (l[round]) out.push(l[round]);
  return fit(out, QUIZ_CHARS);
}

function validate(raw: RawQuestion, sections: Chunk[]): Omit<QuizQuestion, 'id'> | null {
  if (typeof raw.frage !== 'string' || !raw.frage.trim() || !Array.isArray(raw.antworten)) return null;
  const answers = raw.antworten.map((a) => String(a ?? '').trim()).filter(Boolean);
  const correct = Number(raw.richtig);
  if (answers.length !== 4 || new Set(answers.map((a) => a.toLowerCase())).size !== 4) return null;
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
  const sec = sections[Number(raw.abschnitt) - 1] ?? sections[0];
  const right = answers[correct];
  const mixed = shuffle(answers);
  return {
    frage: raw.frage.trim(),
    antworten: mixed,
    richtig: mixed.indexOf(right),
    erklaerung: typeof raw.erklaerung === 'string' ? raw.erklaerung.trim() : '',
    source: ref(sec),
  };
}

export async function runQuiz(count: number, files: FileItem[]) {
  if (getSession().busy || files.length === 0) return;
  const ctrl = new AbortController();
  controller = ctrl;
  updateSession({ busy: true, quiz: { target: count, questions: [], done: false } });
  try {
    const { chunks } = await loadChunks(files);
    if (!chunks.length) throw new Error('Aus den gewählten Dateien konnte kein Text gelesen werden.');
    const sections = pickQuizChunks(chunks);
    if (!sections.length) throw new Error('Die Unterlagen enthalten zu wenig Text für ein Quiz.');
    const text = sections.map((c, i) => `[Abschnitt ${i + 1}] aus „${c.fileName}“${c.loc ? `, ${c.loc}` : ''}:\n${c.text}`).join('\n\n');
    const fileCount = new Set(sections.map((c) => c.fileId)).size;

    const made: string[] = [];
    // Höchstens zwei Durchgänge: falls beim ersten ungültige Fragen dabei waren, wird der Rest nachgefordert.
    for (let attempt = 0; attempt < 2; attempt++) {
      const have = getSession().quiz?.questions.length ?? 0;
      const need = count - have;
      if (need <= 0 || ctrl.signal.aborted) break;
      updateSession({ status: attempt === 0 ? `${count} Fragen werden erstellt …` : `Noch ${need} Fragen werden erstellt …` });
      const avoid = made.length ? `\n\nDiese Fragen gibt es schon – stelle sie NICHT noch einmal:\n${made.map((m) => `- ${m}`).join('\n')}` : '';
      const raw = await generateJson<{ fragen?: RawQuestion[] }>(
        'Du erstellst Quizfragen für Schüler und Studierende. Du verwendest ausschließlich die gegebenen Unterlagen.',
        [
          {
            role: 'user',
            parts: [
              {
                text: `Unterlagen:\n\n${text}\n\nErstelle genau ${need} Multiple-Choice-Fragen auf Deutsch zu wichtigen Inhalten dieser Unterlagen.
- Verteile die Fragen über möglichst viele verschiedene Abschnitte${fileCount > 1 ? ` und über alle ${fileCount} Dateien` : ''}.
- Die richtige Antwort muss eindeutig in den Unterlagen stehen. Frage nach Verständnis, nicht nur nach einzelnen Wörtern.
- Je Frage genau 4 kurze Antwortmöglichkeiten, genau eine davon richtig. Die falschen sollen plausibel klingen, laut Unterlagen aber falsch sein.
- "richtig" ist die Nummer (0 bis 3) der richtigen Antwort in "antworten".
- "erklaerung" ist ein kurzer Satz, warum die Antwort laut Unterlagen stimmt.
- "abschnitt" ist die Nummer des Abschnitts, aus dem die Frage stammt.${avoid}`,
              },
            ],
          },
        ],
        QUIZ_SCHEMA,
        { temperature: 0.7, maxOutputTokens: Math.min(8192, 600 + need * 350), signal: ctrl.signal },
      );
      const fresh: QuizQuestion[] = [];
      for (const r of raw?.fragen ?? []) {
        const q = validate(r, sections);
        if (!q || made.some((m) => m.toLowerCase() === q.frage.toLowerCase())) continue;
        made.push(q.frage);
        fresh.push({ ...q, id: newId() });
        if (have + fresh.length >= count) break;
      }
      updateSession((s) => (s.quiz ? { quiz: { ...s.quiz, questions: [...s.quiz.questions, ...fresh] } } : {}));
    }
    const got = getSession().quiz?.questions.length ?? 0;
    updateSession((s) =>
      s.quiz
        ? {
            quiz: {
              ...s.quiz,
              done: true,
              note:
                got < count
                  ? `Es konnten nur ${got} von ${count} Fragen erstellt werden – die Unterlagen sind dafür vielleicht zu kurz.`
                  : undefined,
            },
          }
        : {},
    );
  } catch (e) {
    const aborted = isAbort(e) || ctrl.signal.aborted;
    updateSession((s) => ({
      quiz: s.quiz
        ? { ...s.quiz, done: true, note: aborted ? 'Erstellung abgebrochen.' : e instanceof Error ? e.message : 'Quiz konnte nicht erstellt werden.' }
        : null,
    }));
  } finally {
    if (controller === ctrl) controller = null;
    updateSession({ busy: false, status: null });
  }
}

export function answerQuestion(id: number, picked: number) {
  updateSession((s) =>
    s.quiz ? { quiz: { ...s.quiz, questions: s.quiz.questions.map((q) => (q.id === id && q.picked === undefined ? { ...q, picked } : q)) } } : {},
  );
}
