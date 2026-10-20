import { useSyncExternalStore } from 'react';
import type { Part } from '../../ai/gemini';

/** Ein Chat-Eintrag. "error" zeigt eine Fehlermeldung mit Wiederholen-Knopf. */
export interface Message {
  id: number;
  role: 'user' | 'model' | 'error';
  text: string;
  pending?: boolean;
}

export interface AiSession {
  folderIds: string[];
  fileIds: string[];
  messages: Message[];
  /** Vorbereitete Unterlagen (Uploads/Text) – wird neu gemacht, wenn sich die Auswahl ändert. */
  prepared: { signature: string; parts: Part[]; skipped: string[]; fileIds: string[] } | null;
}

// Liegt außerhalb von React, damit Auswahl und Gespräch beim Tabwechsel erhalten bleiben (bis zum Neuladen).
let state: AiSession = { folderIds: [], fileIds: [], messages: [], prepared: null };
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
export const msgId = () => nextId++;
