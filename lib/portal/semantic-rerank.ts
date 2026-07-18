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
import { canUsePaidCloudAi } from './entitlement';
import { getEmailBody } from './local-email-body';

const LEGACY_LS_KEY = 'nesio-node-embeddings-v1';
const DB_NAME = 'nesio-vectors';
const STORE = 'embeddings';

interface CacheEntry { hash: number; vec: Float32Array; model?: string } // model:嵌入同源校验(换模型后旧向量作废)

function djb2(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

// 里程碑 C(付费云深检索):邮件节点嵌入**真实内容**(本机全文优先,退到 article/summary
// 预览),让付费语义检索能按正文语义匹配,而不是只嵌「主题 + 邮件/Gmail tag」。邮件正文比
// 其他节点信息量大,给更大预算(嵌入模型可吃 ~2k token)。非邮件保持 name+rawInput+tags。
// 隐私:仅付费层(canUsePaidCloudAi)走到这里,正文才随嵌入请求过云(与付费深问一致)。
const EMAIL_EMBED_BUDGET = 1600;
function nodeEmbeddingText(n: LifeNode, emailBody?: string): string {
  if (n.source === 'email') {
    const from = typeof n.attributes.from === 'string' ? n.attributes.from : '';
    const article = typeof n.attributes.article === 'string' ? n.attributes.article : '';
    const summary = typeof n.attributes.summary === 'string' ? n.attributes.summary : '';
    const content = (emailBody && emailBody.trim()) || article || summary || n.rawInput || '';
    return [n.name, from, content].join(' ').replace(/\s+/g, ' ').slice(0, EMAIL_EMBED_BUDGET);
  }
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

/** 语义检索没生效的原因 —— UI 据此给准确提示,不再一律说「缺 AI 配置」。 */
export type SemanticReason = 'ok' | 'not_needed' | 'no_key' | 'rate_limited' | 'auth' | 'provider' | 'network';

type FetchVectorsResult = { vectors: Array<number[] | null>; model: string } | { failure: Exclude<SemanticReason, 'ok' | 'not_needed'> };

async function fetchVectors(texts: string[]): Promise<FetchVectorsResult> {
  try {
    const res = await fetch('/api/portal/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) {
      // 分诊:503=缺嵌入 key;429=限流;401=会话;其余=提供方故障(配额/临时)
      if (res.status === 503) return { failure: 'no_key' };
      if (res.status === 429) return { failure: 'rate_limited' };
      if (res.status === 401) return { failure: 'auth' };
      return { failure: 'provider' };
    }
    const data = await res.json() as { ok?: boolean; vectors?: Array<number[] | null>; model?: string };
    return data.ok && Array.isArray(data.vectors) ? { vectors: data.vectors, model: data.model || '' } : { failure: 'provider' };
  } catch { return { failure: 'network' }; }
}

export interface RerankResult {
  nodes: LifeNode[];
  /** true only when embeddings were actually fetched + applied; false = degraded to text order. */
  semantic: boolean;
  /** 没生效时的具体原因(not_needed = 候选太少本就无需语义,不是故障)。 */
  reason: SemanticReason;
}

/**
 * Re-rank `nodes` (already text-ranked by smartSearch) by blending text rank
 * with embedding similarity: final = 0.5·rankScore + 0.5·cosine.
 * Returns the input unchanged when embeddings are unavailable.
 */
export async function semanticRerank(query: string, nodes: LifeNode[], topK = 12): Promise<LifeNode[]> {
  return (await semanticRerankMeta(query, nodes, topK)).nodes;
}

/** Same as semanticRerank but also reports whether embeddings were actually used,
 *  so callers can distinguish "semantic search off (AI not configured)" from "no data". */
export async function semanticRerankMeta(query: string, nodes: LifeNode[], topK = 12): Promise<RerankResult> {
  const q = query.trim();
  if (!q || nodes.length < 3) return { nodes, semantic: false, reason: 'not_needed' }; // 候选太少不是故障,别吓用户

  // 前置分流:免费层不打云 embed —— 直接回词法序,省一次云往返 + 私密不出端。
  // 服务端 /api/portal/embed 已是付费门(免费 402),这里前置拦下不发起。
  // 分层未启用 → canUsePaidCloudAi() 恒 true,行为不变。里程碑 C 的邮件正文出网也据此仅付费。
  if (!canUsePaidCloudAi()) return { nodes, semantic: false, reason: 'not_needed' };

  const pool = nodes.slice(0, Math.min(nodes.length, 20));

  // 里程碑 C:给池内邮件节点预取本机全文(≤20 封,await 便宜),嵌入真实正文而非仅主题。
  const emailBodyById = new Map<string, string>();
  await Promise.all(pool.map(async (n) => {
    if (n.source !== 'email') return;
    const eid = typeof n.attributes.emailId === 'string' ? n.attributes.emailId : '';
    if (!eid) return;
    try { const b = await getEmailBody(eid); if (b) emailBodyById.set(n.id, b); } catch { /* 取不到退预览 */ }
  }));
  const embedText = (n: LifeNode): string => nodeEmbeddingText(n, emailBodyById.get(n.id));

  const db = await openDb();
  const cached = db ? await idbGetMany(db, pool.map((n) => n.id)) : new Map<string, CacheEntry>();

  // Figure out which texts need embedding (query always does)
  const missing: Array<{ idx: number; text: string }> = [];
  const nodeVecs: Array<ArrayLike<number> | null> = pool.map((n, i) => {
    const text = embedText(n);
    const hash = djb2(text);
    const hit = cached.get(n.id);
    if (hit && hit.hash === hash) return hit.vec;
    missing.push({ idx: i, text });
    return null;
  });

  const texts = [q, ...missing.map((m) => m.text)];
  const fetched = await fetchVectors(texts);
  if ('failure' in fetched) return { nodes, semantic: false, reason: fetched.failure };
  if (!fetched.vectors[0]) return { nodes, semantic: false, reason: 'provider' }; // 查询向量都没回来 = 提供方故障/配额

  const queryVec = fetched.vectors[0];
  const toStore: Array<[string, CacheEntry]> = [];
  missing.forEach((m, j) => {
    const vec = fetched.vectors[j + 1];
    if (vec) {
      const typed = Float32Array.from(vec);
      nodeVecs[m.idx] = typed;
      toStore.push([pool[m.idx].id, { hash: djb2(m.text), vec: typed, model: fetched.model }]);
    }
  });
  // 同源校验:缓存向量的模型与本次查询向量不同(服务端换了嵌入提供方)→ 不能混算 cosine,
  // 补一轮重嵌入覆盖(一次性成本;旧条目无 model 视作 legacy-gemini)。
  const staleIdx: number[] = [];
  pool.forEach((n, i) => {
    if (!nodeVecs[i]) return;
    const hit = cached.get(n.id);
    if (!hit || missing.some((m) => m.idx === i)) return;
    const entryModel = hit.model || 'text-embedding-004';
    if (fetched.model && entryModel !== fetched.model) staleIdx.push(i);
  });
  if (staleIdx.length) {
    const refetch = await fetchVectors(staleIdx.map((i) => embedText(pool[i])));
    const refetchOk = !('failure' in refetch) ? refetch : null;
    staleIdx.forEach((i, j) => {
      const vec = refetchOk?.vectors[j];
      if (vec) {
        const typed = Float32Array.from(vec);
        nodeVecs[i] = typed;
        toStore.push([pool[i].id, { hash: djb2(embedText(pool[i])), vec: typed, model: refetchOk?.model || fetched.model }]);
      } else {
        nodeVecs[i] = null; // 刷新失败:宁可不参与语义分,也不用错源向量
      }
    });
  }
  if (db && toStore.length > 0) await idbPutMany(db, toStore);

  const scored = pool.map((node, i) => {
    const rankScore = 1 - i / pool.length; // preserve text-ranking signal
    const sim = nodeVecs[i] ? cosine(queryVec, nodeVecs[i]!) : 0;
    return { node, score: 0.5 * rankScore + 0.5 * sim };
  });

  const reranked = scored.sort((a, b) => b.score - a.score).map((s) => s.node);
  return {
    nodes: [...reranked, ...nodes.slice(pool.length)].slice(0, Math.max(topK, reranked.length)),
    semantic: true,
    reason: 'ok',
  };
}
