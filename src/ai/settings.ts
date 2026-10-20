import { useEffect, useState } from 'react';

export type ModelKey = 'mini' | 'standard' | 'stark';

const KEY = 'lernapp/ai-model';
const EVENT = 'lernapp:ai-settings';

export function getModelKey(): ModelKey {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'mini' || v === 'standard' || v === 'stark') return v;
  } catch {
    /* egal */
  }
  return 'standard';
}

export function setModelKey(v: ModelKey) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* egal */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useModelKey(): ModelKey {
  const [k, setK] = useState(getModelKey);
  useEffect(() => {
    const on = () => setK(getModelKey());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return k;
}
