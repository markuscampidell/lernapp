import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type { FileItem } from '../../domain/types';
import { fullName } from '../../lib/files';
import { chatStream, ensureEngine, generateJson, interrupt } from '../../ai/local';
import { fileText, type Chunk } from '../../ai/text';
import { buildIndex, search, spread, type Index } from '../../ai/search';
import { getSession, newId, updateSession, type Message, type QuizQuestion, type SourceRef } from './session';

/*
 * Ablauf der lokalen KI:
 *  1. Text aus den gewählten Dateien lesen und in Abschnitte teilen.
 *  2. Fragen: passende Abschnitte suchen und nur diese dem Modell geben (es hat wenig "Gedächtnis").
 *  3. Quiz: Abschnitte über alle Dateien verteilt wählen und je eine Frage daraus erzeugen.
 */

const CONTEXT_CHARS = 5500; // passt mit Anweisungen und Antwort in das Kontextfenster (4096 Tokens)

let cancelled = false;
let indexCache: { signature: string; chunks: Chunk[]; index: Index } | null = null;

const signatureOf = (files: FileItem[]) => files.map((f) => `${f.id}:${f.updatedAt}`).join('|');
const ref = (c: Chunk): SourceRef => ({ fileId: c.fileId, loc: c.loc });

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

/** Nimmt Abschnitte, solange sie ins Kontextfenster passen. */
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

const OVERVIEW = /zusammenfass|überblick|ueberblick|kernaussage|worum geht|wichtigste|hauptthem|lernzettel/i;

const CHAT_SYSTEM = `Du bist ein Lernassistent. Beantworte die Frage NUR mit den Informationen aus den Auszügen, die du bekommst.
- Erfinde nichts und benutze kein eigenes Wissen.
- Steht die Antwort nicht in den Auszügen, schreibe: „Das steht nicht in deinen Unterlagen.“
- Gib nach jeder Aussage die Quelle an, z. B. [Quelle 2].
- Wirkt etwas in den Auszügen falsch oder widersprüchlich, weise darauf hin.
- Antworte auf Deutsch, kurz und klar. Du darfst Listen und **fett** verwenden.`;

function patchMessage(id: number, p: Partial<Message>) {
  updateSession((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
}

export function cancel() {
  cancelled = true;
  interrupt();
}

/** Eine Frage stellen (Chat). */
export async function ask(question: string, files: FileItem[], opts: { retry?: boolean } = {}) {
  const q = question.trim();
  if (!q || getSession().busy || files.length === 0) return;
  cancelled = false;
  let messages = getSession().messages.filter((m) => m.role !== 'error');
  if (!opts.retry) messages = [...messages, { id: newId(), role: 'user', text: q }];
  const answer: Message = { id: newId(), role: 'model', text: '', pending: true };
  updateSession({ messages: [...messages, answer], busy: true });

  try {
    const { chunks, index } = await loadChunks(files);
    if (!chunks.length) throw new Error('Aus den gewählten Dateien konnte kein Text gelesen werden.');

    // Passende Stellen finden (vorherige Frage hilft bei Rückfragen wie "und warum?")
    const prevUser = messages.filter((m) => m.role === 'user').slice(-2, -1)[0]?.text ?? '';
    let picked = OVERVIEW.test(q) ? spread(chunks, 8) : search(index, q, 8);
    if (!picked.length && prevUser) picked = search(index, `${q} ${prevUser}`, 8);
    picked = fit(picked);
    if (!picked.length) {
      patchMessage(answer.id, {
        pending: false,
        text: 'Dazu habe ich in deinen Unterlagen nichts gefunden. Versuche es mit anderen Stichwörtern, die im Text vorkommen.',
      });
      return;
    }

    updateSession({ status: null });
    await ensureEngine();

    const excerpt = picked.map((c, i) => `[Quelle ${i + 1}] aus „${c.fileName}“${c.loc ? `, ${c.loc}` : ''}:\n${c.text}`).join('\n\n');
    // Kurzer Verlauf (nur Text), damit Rückfragen funktionieren, ohne das Kontextfenster zu sprengen.
    const history: ChatCompletionMessageParam[] = messages
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'model')
      .slice(-4)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 400) }));
    const prompt: ChatCompletionMessageParam[] = [
      { role: 'system', content: CHAT_SYSTEM },
      ...history,
      { role: 'user', content: `Auszüge aus meinen Unterlagen:\n\n${excerpt}\n\nFrage: ${q}` },
    ];
    patchMessage(answer.id, { sources: picked.map(ref) });
    let text = '';
    for await (const t of chatStream(prompt)) {
      text = t;
      patchMessage(answer.id, { text });
    }
    patchMessage(answer.id, { pending: false, text: text || (cancelled ? '_(Abgebrochen)_' : 'Keine Antwort erhalten.') });
  } catch (e) {
    const cur = getSession().messages.find((m) => m.id === answer.id);
    if (cancelled && cur?.text) patchMessage(answer.id, { pending: false, text: `${cur.text}\n\n_(Abgebrochen)_` });
    else
      updateSession((s) => ({
        messages: s.messages
          .filter((m) => m.id !== answer.id)
          .concat({ id: newId(), role: 'error', text: cancelled ? 'Abgebrochen.' : e instanceof Error ? e.message : 'Unbekannter Fehler.' }),
      }));
  } finally {
    updateSession({ busy: false, status: null });
  }
}

// ---------- Quiz ----------

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    frage: { type: 'string' },
    antworten: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    richtig: { type: 'integer', minimum: 0, maximum: 3 },
    erklaerung: { type: 'string' },
  },
  required: ['frage', 'antworten', 'richtig', 'erklaerung'],
};

interface RawQuestion {
  frage?: unknown;
  antworten?: unknown;
  richtig?: unknown;
  erklaerung?: unknown;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Abschnitte für das Quiz: gleichmäßig über die Dateien, zufällig, nicht zu kurz. */
function pickQuizChunks(chunks: Chunk[], n: number): Chunk[] {
  const byFile = new Map<string, Chunk[]>();
  for (const c of chunks) if (c.text.length >= 200) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c]);
  // Notfalls auch kürzere Abschnitte
  if (byFile.size === 0) for (const c of chunks) if (c.text.length >= 60) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c]);
  const lists = shuffle([...byFile.values()].map((l) => shuffle(l)));
  const out: Chunk[] = [];
  // doppelt so viele Kandidaten wie nötig, falls eine Frage misslingt
  for (let round = 0; out.length < n * 2 && lists.some((l) => l.length > round); round++) for (const l of lists) if (l[round]) out.push(l[round]);
  return out;
}

function validate(raw: RawQuestion | null): Omit<QuizQuestion, 'id' | 'source'> | null {
  if (!raw || typeof raw.frage !== 'string' || !Array.isArray(raw.antworten)) return null;
  const answers = raw.antworten.map((a) => String(a ?? '').trim()).filter(Boolean);
  const correct = Number(raw.richtig);
  if (answers.length !== 4 || new Set(answers.map((a) => a.toLowerCase())).size !== 4) return null;
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
  const right = answers[correct];
  const mixed = shuffle(answers);
  return {
    frage: raw.frage.trim(),
    antworten: mixed,
    richtig: mixed.indexOf(right),
    erklaerung: typeof raw.erklaerung === 'string' ? raw.erklaerung.trim() : '',
  };
}

export async function runQuiz(count: number, files: FileItem[]) {
  if (getSession().busy || files.length === 0) return;
  cancelled = false;
  updateSession({ busy: true, quiz: { target: count, questions: [], done: false } });
  try {
    const { chunks } = await loadChunks(files);
    if (!chunks.length) throw new Error('Aus den gewählten Dateien konnte kein Text gelesen werden.');
    const candidates = pickQuizChunks(chunks, count);
    if (!candidates.length) throw new Error('Die Unterlagen enthalten zu wenig Text für ein Quiz.');
    updateSession({ status: 'KI wird gestartet …' });
    await ensureEngine();

    const made: string[] = [];
    for (const c of candidates) {
      const quiz = getSession().quiz;
      if (cancelled || !quiz || quiz.questions.length >= count) break;
      updateSession({ status: `Frage ${quiz.questions.length + 1} von ${count} wird erstellt …` });
      const avoid = made.length ? `\nStelle KEINE dieser schon gestellten Fragen noch einmal:\n${made.slice(-5).map((m) => `- ${m}`).join('\n')}` : '';
      const raw = await generateJson<RawQuestion>(
        [
          { role: 'system', content: 'Du erstellst Quizfragen für Schüler. Du verwendest ausschließlich den gegebenen Text und antwortest nur mit JSON.' },
          {
            role: 'user',
            content: `Text aus „${c.fileName}“${c.loc ? `, ${c.loc}` : ''}:
"""
${c.text}
"""

Erstelle genau EINE Multiple-Choice-Frage auf Deutsch zu einer wichtigen Information aus diesem Text.
- Die richtige Antwort muss eindeutig im Text stehen.
- Genau 4 kurze Antwortmöglichkeiten, genau eine davon richtig.
- Die falschen Antworten sollen plausibel klingen, laut Text aber falsch sein.
- "richtig" ist die Nummer (0 bis 3) der richtigen Antwort in "antworten".
- "erklaerung" ist ein kurzer Satz, warum die Antwort laut Text stimmt.${avoid}

Antworte nur als JSON: {"frage": "...", "antworten": ["...", "...", "...", "..."], "richtig": 0, "erklaerung": "..."}`,
          },
        ],
        QUIZ_SCHEMA,
      );
      if (cancelled) break;
      const q = validate(raw);
      if (!q || made.some((m) => m.toLowerCase() === q.frage.toLowerCase())) continue;
      made.push(q.frage);
      updateSession((s) => (s.quiz ? { quiz: { ...s.quiz, questions: [...s.quiz.questions, { ...q, id: newId(), source: ref(c) }] } } : {}));
    }
    const got = getSession().quiz?.questions.length ?? 0;
    updateSession((s) =>
      s.quiz
        ? {
            quiz: {
              ...s.quiz,
              done: true,
              note: cancelled
                ? 'Erstellung abgebrochen.'
                : got < count
                  ? `Es konnten nur ${got} von ${count} Fragen erstellt werden – die Unterlagen sind dafür zu kurz oder die KI hatte Probleme.`
                  : undefined,
            },
          }
        : {},
    );
  } catch (e) {
    updateSession((s) => ({
      quiz: s.quiz ? { ...s.quiz, done: true, note: e instanceof Error ? e.message : 'Quiz konnte nicht erstellt werden.' } : null,
    }));
  } finally {
    updateSession({ busy: false, status: null });
  }
}

export function answerQuestion(id: number, picked: number) {
  updateSession((s) =>
    s.quiz ? { quiz: { ...s.quiz, questions: s.quiz.questions.map((q) => (q.id === id && q.picked === undefined ? { ...q, picked } : q)) } } : {},
  );
}
