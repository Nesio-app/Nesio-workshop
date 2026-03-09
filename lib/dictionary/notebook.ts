import type { NotebookEntry } from './types';

const KEY = 'ai-dictionary-notebook';

export function getNotebook(): NotebookEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NotebookEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveToNotebook(entry: Omit<NotebookEntry, 'id' | 'savedAt'>): NotebookEntry {
  const list = getNotebook();
  const newEntry: NotebookEntry = {
    ...entry,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  list.unshift(newEntry);
  localStorage.setItem(KEY, JSON.stringify(list));
  return newEntry;
}

export function removeFromNotebook(id: string): void {
  const list = getNotebook().filter((e) => e.id !== id);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function isInNotebook(term: string, targetLang: string): boolean {
  return getNotebook().some((e) => e.result.term === term && e.result.targetLang === targetLang);
}
