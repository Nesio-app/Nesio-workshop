/**
 * ai-cache — 记住 AI 的回复,离线时本地复用(批次 56)。
 *
 * "从 AI 的回复中学习"最诚实的一种:每次 AI 成功返回,就把结果按 用途+输入签名 存本机;
 * 下次 AI 不在线(没网/没配 key/上游挂了)时,同样的输入直接复用上次 AI 的答案 ——
 * 用得越多,离线越顶得住,而且离线给的也是"真·AI 曾经给过的",不是本地瞎编。
 *
 * 纯本地(localStorage `nesio-ai-cache-v1`)· 每个 scope 一个 LRU(按最近命中时间淘汰)。
 */

const KEY = 'nesio-ai-cache-v1';
const PER_SCOPE_CAP = 60;

interface Entry<T> { v: T; at: number }
type Store = Record<string, Record<string, Entry<unknown>>>; // scope → sig → entry

function load(): Store {
  if (typeof window === 'undefined') return {};
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function save(s: Store): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

/** 把输入压成稳定的短签名(忽略大小写/多余空白,截断)。 */
export function sig(input: string): string {
  return (input || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** 记住一条 AI 结果。 */
export function rememberAI<T>(scope: string, inputSig: string, value: T): void {
  const s = load();
  const bucket = (s[scope] ||= {});
  bucket[inputSig] = { v: value, at: Date.now() };
  // LRU 淘汰:超额就丢最久没命中的
  const keys = Object.keys(bucket);
  if (keys.length > PER_SCOPE_CAP) {
    keys.sort((a, b) => (bucket[a].at) - (bucket[b].at));
    for (const k of keys.slice(0, keys.length - PER_SCOPE_CAP)) delete bucket[k];
  }
  save(s);
}

/** 取回一条 AI 结果(命中则刷新其最近使用时间);没有返回 null。 */
export function recallAI<T>(scope: string, inputSig: string): T | null {
  const s = load();
  const e = s[scope]?.[inputSig];
  if (!e) return null;
  e.at = Date.now();
  save(s);
  return e.v as T;
}

/** 某 scope 记住了多少条(供透明面板"从 AI 学了 N 条"展示)。 */
export function aiCacheCount(scope?: string): number {
  const s = load();
  if (scope) return Object.keys(s[scope] || {}).length;
  return Object.values(s).reduce((n, b) => n + Object.keys(b).length, 0);
}
