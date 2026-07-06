import { getSignals, type Signal } from './signal';

export type CloudSignalRow = {
  signal_id?: string;
  source?: Signal['source'];
  type?: string;
  occurred_at?: string;
  captured_at?: string;
  title?: string;
  payload?: Record<string, unknown>;
  entities?: Signal['entities'];
  evidence?: Signal['evidence'];
  confidence?: number;
  sensitivity?: Signal['sensitivity'];
  retention_policy?: Signal['retentionPolicy'];
  feedback?: Record<string, unknown>;
  embedding_text?: string;
};

type CloudSignalSearchResponse = {
  signals?: CloudSignalRow[];
  search?: {
    mode?: string;
  };
};

function tokenize(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter(Boolean);
  const cjk = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{1,4}/g)).map((match) => match[0]);
  return Array.from(new Set([...words, ...cjk])).filter((token) => token.length > 0);
}

export function buildSignalSearchText(signal: Signal): string {
  const payload = signal.payload || {};
  const entityText = (signal.entities || []).map((entity) => `${entity.type} ${entity.name}`).join(' ');
  return [
    signal.title,
    signal.source,
    signal.type,
    signal.evidence?.raw || '',
    ...(signal.tags || []),
    entityText,
    JSON.stringify(payload),
  ].join(' ').slice(0, 12000);
}

/** 纯查询相关性(词法/实体命中),不含近因/置信 —— 决定"够不够格进结果"的门。
 *  近因和置信与查询无关,不能用它们把无关记录顶进结果(否则查任何词都返回最近几条)。 */
export function relevanceScore(signal: Signal, query: string): number {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const haystack = buildSignalSearchText(signal).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length >= 2 ? 2 : 1;
  }
  if (signal.title && query.includes(signal.title)) score += 4;
  if ((signal.tags || []).some((tag) => query.includes(tag))) score += 3;
  return score;
}

export function scoreSignalForQuery(signal: Signal, query: string): number {
  const rel = relevanceScore(signal, query);
  const ageHours = (Date.now() - new Date(signal.capturedAt).getTime()) / 3_600_000;
  const recencyBoost = Number.isFinite(ageHours) ? Math.max(0, 1.2 - ageHours / 168) : 0;
  return rel + recencyBoost + signal.confidence * 0.8;
}

export function searchSignalsSemantically(query: string, limit = 8): Signal[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return getSignals()
    .map((signal) => ({ signal, rel: relevanceScore(signal, trimmed), score: scoreSignalForQuery(signal, trimmed) }))
    // 门只认查询相关性:必须真的命中查询词/实体才够格,近因/置信只用来排序。
    .filter((entry) => entry.rel > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.signal);
}

export function cloudSignalRowToSignal(row: CloudSignalRow): Signal | null {
  if (!row.signal_id || !row.source || !row.type) return null;
  const now = new Date().toISOString();
  const embeddingText = typeof row.embedding_text === 'string' ? row.embedding_text : '';
  const payload = {
    ...(row.payload || {}),
    ...(embeddingText ? { embedding_text: embeddingText } : {}),
  };
  const evidence = row.evidence || { source: row.source, raw: embeddingText };
  return {
    id: row.signal_id,
    source: row.source,
    type: row.type,
    occurredAt: row.occurred_at || row.captured_at || now,
    capturedAt: row.captured_at || row.occurred_at || now,
    title: row.title || 'Signal',
    payload,
    content: payload,
    entities: Array.isArray(row.entities) ? row.entities : [],
    confidence: typeof row.confidence === 'number' ? row.confidence : 0.7,
    sensitivity: row.sensitivity || 'normal',
    retentionPolicy: row.retention_policy || 'Normal',
    evidence,
    tags: [],
  };
}

export function cloudSignalRowsToSignals(rows: readonly CloudSignalRow[]): Signal[] {
  return rows.map(cloudSignalRowToSignal).filter((signal): signal is Signal => Boolean(signal));
}

function rankSignals(signals: readonly Signal[], query: string, limit: number): Signal[] {
  return signals
    .map((signal) => ({ signal, score: scoreSignalForQuery(signal, query) }))
    .filter((entry) => entry.score > 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.signal);
}

function mergeRankedSignals(primary: readonly Signal[], fallback: readonly Signal[], limit: number): Signal[] {
  const seen = new Set<string>();
  const merged: Signal[] = [];
  for (const signal of [...primary, ...fallback]) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);
    merged.push(signal);
    if (merged.length >= limit) break;
  }
  return merged;
}

export async function searchSignalsWithCloudFallback(query: string, limit = 8): Promise<Signal[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const localMatches = searchSignalsSemantically(trimmed, limit);
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return localMatches;

  try {
    const params = new URLSearchParams({
      q: trimmed,
      limit: String(Math.max(50, limit * 20)),
    });
    const response = await fetch(`/api/cloud/signals?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return localMatches;
    const data = await response.json() as CloudSignalSearchResponse;
    const cloudSignals = cloudSignalRowsToSignals(data.signals || []);
    const cloudMatches = data.search?.mode === 'signal_vector_pgvector'
      ? cloudSignals.slice(0, limit)
      : rankSignals(cloudSignals, trimmed, limit);
    return mergeRankedSignals(cloudMatches, localMatches, limit);
  } catch {
    return localMatches;
  }
}
