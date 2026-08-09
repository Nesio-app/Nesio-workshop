/**
 * 查词 —— 离线优先;可选 AI 兜底(用户开关)。
 * 纯函数 + 本机偏好;UI 层负责展示与重试。
 */

import { OFFLINE_LEXICON, type DictEntry } from './offline-lexicon';
import {
  ensureEcdictMeta, lookupEcdict, getEcdictEntry, ecdictPackCount,
} from './ecdict-pack';

export interface DictHit {
  entry: DictEntry;
  /** exact | prefix | contains | zh */
  rank: 'exact' | 'prefix' | 'contains' | 'zh';
}

function norm(q: string): string {
  return (q || '').trim().toLowerCase();
}

function mergeHits(primary: DictHit[], secondary: DictHit[], max: number): DictHit[] {
  const seen = new Set<string>();
  const out: DictHit[] = [];
  for (const h of [...primary, ...secondary]) {
    const k = h.entry.word;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** 同步查词(内置精选库)。UI 应优先用 lookupWordAsync 覆盖 ECDICT 大词库。 */
export function lookupWord(query: string, max = 12): DictHit[] {
  const q = norm(query);
  if (!q) return [];
  const exact: DictHit[] = [];
  const prefix: DictHit[] = [];
  const contains: DictHit[] = [];
  const zh: DictHit[] = [];
  const raw = query.trim();

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
    if (keys.some((k) => k.includes(raw) || raw.includes(k))) {
      zh.push({ entry, rank: 'zh' });
    } else if (entry.senses.some((s) => s.zh.includes(raw))) {
      zh.push({ entry, rank: 'zh' });
    }
  }

  return [...exact, ...prefix, ...contains, ...zh].slice(0, max);
}

/** 离线查词:内置精选 + ECDICT 40 万分包(欧路兼容开源库)。 */
export async function lookupWordAsync(query: string, max = 12): Promise<DictHit[]> {
  const local = lookupWord(query, max);
  try {
    await ensureEcdictMeta();
    const pack = await lookupEcdict(query, max);
    // exact 优先来自大词库(释义更全);本地精选补例子/中文反查
    const packExact = pack.filter((h) => h.rank === 'exact');
    const restPack = pack.filter((h) => h.rank !== 'exact');
    return mergeHits(packExact, mergeHits(local, restPack, max), max);
  } catch {
    return local;
  }
}

/** 词库规模(大包已加载则用大包计数,否则精选库)。 */
export function lexiconSizeLabel(): number {
  return ecdictPackCount() || OFFLINE_LEXICON.length;
}

/** AI 查词开关(本机偏好,换设备默认关 —— cache)。 */
const AI_KEY = 'nesio-dict-ai-enabled-v1';

export function loadAiEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(AI_KEY) === '1'; } catch { return false; }
}

export function saveAiEnabled(on: boolean): { ok: boolean } {
  if (typeof window === 'undefined') return { ok: false };
  try {
    localStorage.setItem(AI_KEY, on ? '1' : '0');
    return { ok: true };
  } catch { return { ok: false }; }
}

/** 云 AI 查词(仅当本地 miss 且开关打开时由 UI 调用)。 */
export async function fetchAiLookup(query: string, locale?: string): Promise<DictEntry> {
  const res = await fetch('/api/portal/dictionary-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.trim().slice(0, 80), locale, mode: 'lookup' }),
  });
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; entry?: DictEntry };
  if (!res.ok || !data.ok || !data.entry) {
    throw new Error(data.error || `lookup_failed_${res.status}`);
  }
  return data.entry;
}

/** 详情页 AI 补全:例句 + 助记/词根/搭配(可与本地释义合并)。 */
export async function fetchAiEnrich(query: string, locale?: string): Promise<DictEntry> {
  const res = await fetch('/api/portal/dictionary-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.trim().slice(0, 80), locale, mode: 'enrich' }),
  });
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; entry?: DictEntry };
  if (!res.ok || !data.ok || !data.entry) {
    throw new Error(data.error || `enrich_failed_${res.status}`);
  }
  return data.entry;
}

/** 详情补全缓存(换设备可从零 —— cache)。 */
const ENRICH_KEY = 'nesio-dict-enrich-cache-v1';
const ENRICH_MAX = 80;

type EnrichMap = Record<string, DictEntry>;

function readEnrichMap(): EnrichMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(ENRICH_KEY) || '{}') as EnrichMap;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function loadEnrichCache(word: string): DictEntry | null {
  const w = norm(word);
  if (!w) return null;
  return readEnrichMap()[w] || null;
}

export function saveEnrichCache(entry: DictEntry): { ok: boolean } {
  if (typeof window === 'undefined') return { ok: false };
  const w = norm(entry.word);
  if (!w) return { ok: false };
  try {
    const map = readEnrichMap();
    map[w] = {
      word: entry.word,
      headword: entry.headword,
      phonetic: entry.phonetic,
      senses: entry.senses.slice(0, 6),
      examples: entry.examples?.slice(0, 4),
      mnemonic: entry.mnemonic,
      roots: entry.roots,
      collocations: entry.collocations?.slice(0, 8),
    };
    const keys = Object.keys(map);
    if (keys.length > ENRICH_MAX) {
      for (const k of keys.slice(0, keys.length - ENRICH_MAX)) delete map[k];
    }
    localStorage.setItem(ENRICH_KEY, JSON.stringify(map));
    return { ok: true };
  } catch { return { ok: false }; }
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

/** 生词本异步回填(含 ECDICT 大词库词条)。 */
export async function entriesForWordbookAsync(): Promise<DictEntry[]> {
  const ids = loadWordbook();
  const out: DictEntry[] = [];
  const have = new Set<string>();
  for (const e of OFFLINE_LEXICON) {
    if (ids.includes(e.word)) { out.push(e); have.add(e.word); }
  }
  for (const w of ids) {
    if (have.has(w)) continue;
    try {
      const e = await getEcdictEntry(w);
      if (e) out.push(e);
    } catch { /* 分片未就绪就跳过 */ }
  }
  return out;
}
