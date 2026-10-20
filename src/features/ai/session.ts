import { useSyncExternalStore } from 'react';

export interface SourceRef {
  fileId: string;
  /** z. B. "S. 3" oder "Folie 2" */
  loc: string;
}

/** Ein Chat-Eintrag. "error" zeigt eine Fehlermeldung mit Wiederholen-Knopf. */
export interface Message {
  id: number;
  role: 'user' | 'model' | 'error';
  text: string;
  pending?: boolean;
  /** Quellen der Antwort: [Quelle N] = sources[N-1] */
  sources?: SourceRef[];
}

export interface QuizQuestion {
  id: number;
  frage: string;
  antworten: string[];
  richtig: number;
  erklaerung: string;
  source: SourceRef;
  /** gewählte Antwort (undefined = noch nicht beantwortet) */
  picked?: number;
}

export interface Quiz {
  target: number;
  questions: QuizQuestion[];
  done: boolean;
  /** Hinweis am Ende, z. B. wenn weniger Fragen möglich waren */
  note?: string;
}

export interface AiSession {
  folderIds: string[];
  fileIds: string[];
  mode: 'chat' | 'quiz';
  messages: Message[];
  quiz: Quiz | null;
  busy: boolean;
  status: string | null;
  /** Dateien, die nicht gelesen werden konnten */
  unreadable: { name: string; reason: string }[];
}

// Liegt außerhalb von React, damit Auswahl, Gespräch und Quiz beim Tabwechsel erhalten bleiben (bis zum Neuladen)
// und laufende Antworten/Quiz-Erstellung im Hintergrund weiterlaufen.
let state: AiSession = { folderIds: [], fileIds: [], mode: 'chat', messages: [], quiz: null, busy: false, status: null, unreadable: [] };
const listeners = new Set<() => void>();

export const getSession = () => state;
export function updateSession(patch: Partial<AiSession> | ((s: AiSession) => Partial<AiSession>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export function useSession(): AiSession {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let nextId = 1;
export const newId = () => nextId++;
