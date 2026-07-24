/**
 * 云 signals 文本评分检索(纯函数,无副作用,可单测)。
 * 从 app/api/cloud/signals/route.ts 抽出:向量检索不可用时的确定性回退排序。
 * 供 GET /api/cloud/signals 与 /api/alexa 语音召回共用 —— 同一套排序,行为一致。
 */

export function tokenizeSearchQuery(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter(Boolean);
  const cjk = Array.from(normalized.matchAll(/[一-鿿]{1,4}/g)).map((match) => match[0]);
  return Array.from(new Set([...words, ...cjk])).filter(Boolean);
}

export function stringifySearchValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function scoreCloudSignalRow(row: Record<string, unknown>, query: string, now = Date.now()): number {
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) return 0;
  const haystack = [
    row.title,
    row.source,
    row.type,
    row.embedding_text,
    stringifySearchValue(row.payload),
    stringifySearchValue(row.entities),
    stringifySearchValue(row.evidence),
    stringifySearchValue(row.feedback),
  ].join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 2 ? 2 : 1;
  }
  const title = typeof row.title === 'string' ? row.title.toLowerCase() : '';
  if (title && query.toLowerCase().includes(title)) score += 4;
  const confidence = typeof row.confidence === 'number' ? row.confidence : 0.6;
  const capturedAt = typeof row.captured_at === 'string' ? Date.parse(row.captured_at) : NaN;
  const ageHours = Number.isFinite(capturedAt) ? (now - capturedAt) / 3_600_000 : NaN;
  const recencyBoost = Number.isFinite(ageHours) ? Math.max(0, 1.2 - ageHours / 168) : 0;
  return score + confidence * 0.8 + recencyBoost;
}

export function sortRowsForQuery(
  rows: Array<Record<string, unknown>>,
  query: string,
  limit: number,
  now = Date.now(),
): Array<Record<string, unknown>> {
  if (!query) return rows.slice(0, limit);
  return rows
    .map((row) => ({ row, score: scoreCloudSignalRow(row, query, now) }))
    .filter((entry) => entry.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.row);
}
