import { getSignals, type Signal } from './signal';

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

export function scoreSignalForQuery(signal: Signal, query: string): number {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const haystack = buildSignalSearchText(signal).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length >= 2 ? 2 : 1;
  }
  if (signal.title && query.includes(signal.title)) score += 4;
  if ((signal.tags || []).some((tag) => query.includes(tag))) score += 3;
  const ageHours = (Date.now() - new Date(signal.capturedAt).getTime()) / 3_600_000;
  const recencyBoost = Number.isFinite(ageHours) ? Math.max(0, 1.2 - ageHours / 168) : 0;
  return score + recencyBoost + signal.confidence * 0.8;
}

export function searchSignalsSemantically(query: string, limit = 8): Signal[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return getSignals()
    .map((signal) => ({ signal, score: scoreSignalForQuery(signal, trimmed) }))
    .filter((entry) => entry.score > 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.signal);
}
