/**
 * ECDICT 离线大词库(欧路/Eudic 兼容开源库 skywind3000/ECDICT)。
 * 数据:public/data/dictionary/{a-z}.json.gz + zh.json.gz + meta.json
 * 按首字母分片懒加载,gzip 由浏览器 DecompressionStream 解压。
 */

import type { DictEntry, DictSense } from './offline-lexicon';

export interface EcdictMeta {
  source: string;
  license?: string;
  version: string;
  count: number;
  shards: string[];
  note?: string;
}

type PackRow = [word: string, phonetic: string, translation: string];

const BASE = '/data/dictionary';
let metaCache: EcdictMeta | null = null;
const shardCache = new Map<string, PackRow[]>();
let zhCache: Record<string, string[]> | null = null;
const inflight = new Map<string, Promise<unknown>>();

async function fetchJsonGz<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`ecdict_load_failed:${url}:${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) {
    // 部分 CDN/中间层已解压
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  // 浏览器:DecompressionStream;Node(契约测试)走 zlib
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    return JSON.parse(text) as T;
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlib = await import('node:zlib');
    const text = zlib.gunzipSync(Buffer.from(buf)).toString('utf8');
    return JSON.parse(text) as T;
  }
  throw new Error('ecdict_gunzip_unsupported');
}

async function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = run().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export async function ensureEcdictMeta(): Promise<EcdictMeta> {
  if (metaCache) return metaCache;
  return once('meta', async () => {
    const res = await fetch(`${BASE}/meta.json`, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`ecdict_meta_failed:${res.status}`);
    metaCache = (await res.json()) as EcdictMeta;
    return metaCache;
  });
}

export function ecdictPackCount(): number {
  return metaCache?.count ?? 0;
}

async function loadShard(letter: string): Promise<PackRow[]> {
  const k = (letter || '_').toLowerCase();
  const key = k[0] || '_';
  if (shardCache.has(key)) return shardCache.get(key)!;
  return once(`shard:${key}`, async () => {
    await ensureEcdictMeta();
    const rows = await fetchJsonGz<PackRow[]>(`${BASE}/${key}.json.gz`);
    shardCache.set(key, Array.isArray(rows) ? rows : []);
    return shardCache.get(key)!;
  });
}

async function loadZhIndex(): Promise<Record<string, string[]>> {
  if (zhCache) return zhCache;
  return once('zh', async () => {
    zhCache = await fetchJsonGz<Record<string, string[]>>(`${BASE}/zh.json.gz`);
    return zhCache;
  });
}

/** 把 ECDICT translation 文本拆成 senses(尽量保留词性前缀)。 */
export function parseEcdictTranslation(translation: string): DictSense[] {
  const lines = (translation || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [{ zh: translation || '' }];
  const out: DictSense[] = [];
  for (const line of lines.slice(0, 8)) {
    const m = line.match(/^([a-z]+\.|[a-z]+\/[a-z]+\.|prep\.|conj\.|interj\.|art\.|aux\.|abbr\.)\s*(.+)$/i);
    if (m) out.push({ pos: m[1], zh: m[2] });
    else out.push({ zh: line });
  }
  return out.length ? out : [{ zh: translation }];
}

function rowToEntry(row: PackRow): DictEntry {
  const [word, phonetic, translation] = row;
  return {
    word: word.toLowerCase(),
    headword: word,
    phonetic: phonetic || undefined,
    senses: parseEcdictTranslation(translation),
  };
}

function lowerBound(rows: PackRow[], q: string): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const w = (rows[mid]?.[0] || '').toLowerCase();
    if (w < q) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type EcdictHit = { entry: DictEntry; rank: 'exact' | 'prefix' | 'contains' | 'zh' };

/** 大词库异步查词(本地分片)。 */
export async function lookupEcdict(query: string, max = 12): Promise<EcdictHit[]> {
  const raw = (query || '').trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const isZh = /[\u4e00-\u9fff]/.test(raw);

  if (isZh) {
    const zh = await loadZhIndex();
    const keys = Object.keys(zh).filter((k) => k.includes(raw) || raw.includes(k));
    keys.sort((a, b) => {
      const ae = a === raw ? 0 : a.startsWith(raw) ? 1 : 2;
      const be = b === raw ? 0 : b.startsWith(raw) ? 1 : 2;
      return ae - be || a.length - b.length;
    });
    const words: string[] = [];
    for (const k of keys.slice(0, 24)) {
      for (const w of zh[k] || []) {
        if (!words.includes(w)) words.push(w);
        if (words.length >= max) break;
      }
      if (words.length >= max) break;
    }
    const hits: EcdictHit[] = [];
    for (const w of words.slice(0, max)) {
      const shard = await loadShard(w[0] || 'a');
      const i = lowerBound(shard, w);
      const row = shard[i];
      if (row && row[0].toLowerCase() === w) hits.push({ entry: rowToEntry(row), rank: 'zh' });
    }
    return hits;
  }

  if (!/^[a-z]/.test(q)) return [];
  const shard = await loadShard(q[0]);
  const i = lowerBound(shard, q);
  const exact: EcdictHit[] = [];
  const prefix: EcdictHit[] = [];
  const contains: EcdictHit[] = [];

  for (let j = i; j < Math.min(shard.length, i + 80); j++) {
    const row = shard[j];
    const w = row[0].toLowerCase();
    if (w === q) exact.push({ entry: rowToEntry(row), rank: 'exact' });
    else if (w.startsWith(q)) prefix.push({ entry: rowToEntry(row), rank: 'prefix' });
    else if (w[0] !== q[0]) break;
  }
  // 少量 contains(同片内)
  if (exact.length + prefix.length < max && q.length >= 3) {
    for (const row of shard) {
      const w = row[0].toLowerCase();
      if (w.includes(q) && w !== q && !w.startsWith(q)) {
        contains.push({ entry: rowToEntry(row), rank: 'contains' });
        if (contains.length >= 4) break;
      }
    }
  }
  return [...exact, ...prefix, ...contains].slice(0, max);
}

/** 按词形精确取一条(生词本回填)。 */
export async function getEcdictEntry(word: string): Promise<DictEntry | null> {
  const q = (word || '').trim().toLowerCase();
  if (!q || !/^[a-z]/.test(q)) return null;
  const shard = await loadShard(q[0]);
  const i = lowerBound(shard, q);
  const row = shard[i];
  if (!row || row[0].toLowerCase() !== q) return null;
  return rowToEntry(row);
}
