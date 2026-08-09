/**
 * 离线查词 —— 精确 / 前缀 / 包含 / 中文反查。
 * 纯函数,可单测;UI 层只负责展示。
 */

import { OFFLINE_LEXICON, type DictEntry } from './offline-lexicon';

export interface DictHit {
  entry: DictEntry;
  /** exact | prefix | contains | zh */
  rank: 'exact' | 'prefix' | 'contains' | 'zh';
}

function norm(q: string): string {
  return (q || '').trim().toLowerCase();
}

/** 查词。空串 → [];最多 max 条。 */
export function lookupWord(query: string, max = 12): DictHit[] {
  const q = norm(query);
  if (!q) return [];
  const exact: DictHit[] = [];
  const prefix: DictHit[] = [];
  const contains: DictHit[] = [];
  const zh: DictHit[] = [];

  for (const entry of OFFLINE_LEXICON) {
    const w = entry.word;
    if (w === q || entry.headword.toLowerCase() === q) {
      exact.push({ entry, rank: 'exact' });
      continue;
    }
    if (w.startsWith(q) || entry.headword.toLowerCase().startsWith(q)) {
      prefix.push({ entry, rank: 'prefix' });
      continue;
    }
    if (w.includes(q) || entry.headword.toLowerCase().includes(q)) {
      contains.push({ entry, rank: 'contains' });
      continue;
    }
    const keys = entry.zhKeys || [];
    if (keys.some((k) => k.includes(query.trim()) || query.trim().includes(k))) {
      zh.push({ entry, rank: 'zh' });
    } else if (entry.senses.some((s) => s.zh.includes(query.trim()))) {
      zh.push({ entry, rank: 'zh' });
    }
  }

  return [...exact, ...prefix, ...contains, ...zh].slice(0, max);
}

/** 生词本(本机)。 */
const BOOK_KEY = 'nesio-dict-wordbook-v1';

export function loadWordbook(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(BOOK_KEY) || '[]') as string[];
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export function toggleWordbook(word: string): { ok: boolean; inBook: boolean } {
  if (typeof window === 'undefined') return { ok: false, inBook: false };
  const w = norm(word);
  if (!w) return { ok: false, inBook: false };
  const cur = loadWordbook();
  const has = cur.includes(w);
  const next = has ? cur.filter((x) => x !== w) : [...cur, w].slice(0, 500);
  try {
    localStorage.setItem(BOOK_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, inBook: has };
  }
  return { ok: true, inBook: !has };
}

export function isInWordbook(word: string): boolean {
  return loadWordbook().includes(norm(word));
}

export function entriesForWordbook(): DictEntry[] {
  const ids = new Set(loadWordbook());
  return OFFLINE_LEXICON.filter((e) => ids.has(e.word));
}
