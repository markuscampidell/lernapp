import { useEffect, useState } from 'react';

// Der Gemini-Schlüssel bleibt nur auf diesem Gerät (localStorage) und geht nur direkt an Google.
const KEY = 'lernapp/gemini-key';
const MODEL = 'lernapp/gemini-model';
const EVENT = 'lernapp:ai-settings';

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const store = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* privates Surfen o. ä. */
  }
  window.dispatchEvent(new Event(EVENT));
};

export const getApiKey = () => read(KEY);
export const setApiKey = (v: string) => store(KEY, v.trim());
export const getModel = () => read(MODEL);
export const setModel = (v: string) => store(MODEL, v);

export function useAiSettings() {
  const [state, setState] = useState(() => ({ apiKey: getApiKey(), model: getModel() }));
  useEffect(() => {
    const on = () => setState({ apiKey: getApiKey(), model: getModel() });
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return state;
}
