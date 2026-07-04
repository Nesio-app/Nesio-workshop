/**
 * Semantic Rerank — Phase 2 of smart search (the "vector embeddings" phase
 * smart-search.ts promised in its header).
 *
 * smartSearch stays synchronous rule-based retrieval; this layer re-orders
 * its top results by embedding similarity when the /api/portal/embed
 * endpoint is available. Fails open: any error returns the input order.
 *
 * Node vectors are cached in localStorage keyed by node id + content hash,
 * so each node is embedded once until its text changes.
 */

import type { LifeNode } from './life-graph';

const CACHE_KEY = 'nesio-node-embeddings-v1';
const CACHE_MAX_ENTRIES = 600;

interface CacheEntry { hash: number; vec: number[] }
type VectorCache = Record<string, CacheEntry>;

function djb2(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

function nodeEmbeddingText(n: LifeNode): string {
  return [n.name, n.rawInput || '', ...(n.tags || [])].join(' ').slice(0, 400);
}

function loadCache(): VectorCache {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as VectorCache; }
  catch { return {}; }
}

function saveCache(cache: VectorCache): void {
  try {
    const ids = Object.keys(cache);
    if (ids.length > CACHE_MAX_ENTRIES) {
      // Drop arbitrary overflow — cache is a pure performance aid
      for (const id of ids.slice(0, ids.length - CACHE_MAX_ENTRIES)) delete cache[id];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota — skip persisting */ }
}

function cosine(a: number[], b: number[]): number {
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
 * with embedding similarity: final = 0.5·rankScore + 0.5·cosine.
 * Returns the input unchanged when embeddings are unavailable.
 */
export async function semanticRerank(query: string, nodes: LifeNode[], topK = 12): Promise<LifeNode[]> {
  const q = query.trim();
  if (!q || nodes.length < 3) return nodes;

  const pool = nodes.slice(0, Math.min(nodes.length, 20));
  const cache = loadCache();

  // Figure out which texts need embedding (query always does)
  const missing: Array<{ idx: number; text: string }> = [];
  const nodeVecs: Array<number[] | null> = pool.map((n, i) => {
    const text = nodeEmbeddingText(n);
    const hash = djb2(text);
    const hit = cache[n.id];
    if (hit && hit.hash === hash) return hit.vec;
    missing.push({ idx: i, text });
    return null;
  });

  const texts = [q, ...missing.map((m) => m.text)];
  const fetched = await fetchVectors(texts);
  if (!fetched || !fetched[0]) return nodes; // endpoint unavailable — keep text order

  const queryVec = fetched[0];
  missing.forEach((m, j) => {
    const vec = fetched[j + 1];
    if (vec) {
      nodeVecs[m.idx] = vec;
      cache[pool[m.idx].id] = { hash: djb2(m.text), vec };
    }
  });
  saveCache(cache);

  const scored = pool.map((node, i) => {
    const rankScore = 1 - i / pool.length; // preserve text-ranking signal
    const sim = nodeVecs[i] ? cosine(queryVec, nodeVecs[i]!) : 0;
    return { node, score: 0.5 * rankScore + 0.5 * sim };
  });

  const reranked = scored.sort((a, b) => b.score - a.score).map((s) => s.node);
  return [...reranked, ...nodes.slice(pool.length)].slice(0, Math.max(topK, reranked.length));
}
