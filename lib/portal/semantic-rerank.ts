/**
 * Semantic Rerank — Phase 2 of smart search (the "vector embeddings" phase
 * smart-search.ts promised in its header).
 *
 * smartSearch stays synchronous rule-based retrieval; this layer re-orders
 * its top results by embedding similarity when the /api/portal/embed
 * endpoint is available. Fails open: any error returns the input order.
 *
 * Node vectors are cached in IndexedDB (NOT localStorage: 600 × 768 float
 * vectors JSON-encoded would eat most of the ~5MB localStorage budget that
 * the life graph itself needs). IndexedDB stores Float32Array natively via
 * structured clone — no JSON overhead, GB-scale quota. Keyed by node id +
 * content hash, so each node is embedded once until its text changes.
 */

import type { LifeNode } from './life-graph';
import { blendRankSim } from './semantic-blend.mjs';

const LEGACY_LS_KEY = 'nesio-node-embeddings-v1';
const DB_NAME = 'nesio-vectors';
const STORE = 'embeddings';

interface CacheEntry { hash: number; vec: Float32Array }

function djb2(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

function nodeEmbeddingText(n: LifeNode): string {
  return [n.name, n.rawInput || '', ...(n.tags || [])].join(' ').slice(0, 400);
}

// ── IndexedDB micro-helper (no dependency) ────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      // One-time cleanup of the legacy localStorage cache
      try { localStorage.removeItem(LEGACY_LS_KEY); } catch { /* ignore */ }
      resolve(req.result);
    };
    req.onerror = () => resolve(null);
  });
}

function idbGetMany(db: IDBDatabase, ids: string[]): Promise<Map<string, CacheEntry>> {
  return new Promise((resolve) => {
    const out = new Map<string, CacheEntry>();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => { if (req.result) out.set(id, req.result as CacheEntry); };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => resolve(out);
  });
}

function idbPutMany(db: IDBDatabase, entries: Array<[string, CacheEntry]>): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [id, entry] of entries) store.put(entry, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

async function fetchVectors(texts: string[]): Promise<Array<number[] | null> | null> {
  try {
    const res = await fetch('/api/portal/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; vectors?: Array<number[] | null> };
    return data.ok && Array.isArray(data.vectors) ? data.vectors : null;
  } catch { return null; }
}

/**
 * Re-rank `nodes` (already text-ranked by smartSearch) by blending text rank
 * with embedding similarity. cosine 相关文本聚在 0.7–0.9 窄带,直接和占满 [0,1] 的
 * rankScore 等权混合会被淹没,所以先对有向量的 sim 做 min-max 归一化再混合
 * (见 semantic-blend.mjs),让语义真正参与排序。
 * Returns the input unchanged when embeddings are unavailable.
 */
export async function semanticRerank(query: string, nodes: LifeNode[], topK = 12): Promise<LifeNode[]> {
  const q = query.trim();
  if (!q || nodes.length < 3) return nodes;

  const pool = nodes.slice(0, Math.min(nodes.length, 20));
  const db = await openDb();
  const cached = db ? await idbGetMany(db, pool.map((n) => n.id)) : new Map<string, CacheEntry>();

  // Figure out which texts need embedding (query always does)
  const missing: Array<{ idx: number; text: string }> = [];
  const nodeVecs: Array<ArrayLike<number> | null> = pool.map((n, i) => {
    const text = nodeEmbeddingText(n);
    const hash = djb2(text);
    const hit = cached.get(n.id);
    if (hit && hit.hash === hash) return hit.vec;
    missing.push({ idx: i, text });
    return null;
  });

  const texts = [q, ...missing.map((m) => m.text)];
  const fetched = await fetchVectors(texts);
  if (!fetched || !fetched[0]) return nodes; // endpoint unavailable — keep text order

  const queryVec = fetched[0];
  const toStore: Array<[string, CacheEntry]> = [];
  missing.forEach((m, j) => {
    const vec = fetched[j + 1];
    if (vec) {
      const typed = Float32Array.from(vec);
      nodeVecs[m.idx] = typed;
      toStore.push([pool[m.idx].id, { hash: djb2(m.text), vec: typed }]);
    }
  });
  if (db && toStore.length > 0) await idbPutMany(db, toStore);

  const items = pool.map((_, i) => ({
    rank: 1 - i / pool.length,                                  // preserve text-ranking signal
    sim: nodeVecs[i] ? cosine(queryVec, nodeVecs[i]!) : 0,
    hasVec: Boolean(nodeVecs[i]),
  }));
  const blended = blendRankSim(items);                          // min-max 归一化 sim 后再等权混合
  const scored = pool.map((node, i) => ({ node, score: blended[i] }));

  const reranked = scored.sort((a, b) => b.score - a.score).map((s) => s.node);
  return [...reranked, ...nodes.slice(pool.length)].slice(0, Math.max(topK, reranked.length));
}
