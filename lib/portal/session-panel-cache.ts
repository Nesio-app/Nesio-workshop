/**
 * 会话级面板缓存 —— 家务 / Tesla / 运营等「开一次就要联网」的页,
 * 关掉再开不应整页 Loading 从头拉。TTL 内复用上次成功结果,后台静默刷新。
 *
 * 与 prefetch-cache(日历/天气)同思路,但放内存(+可选 sessionStorage),
 * 避免大 JSON 挤配额;页内 refresh 仍可强制绕过。
 */

type Entry<T> = { at: number; data: T };

const mem = new Map<string, Entry<unknown>>();

/** 默认 10 分钟:够覆盖「切走又回来」,又不会把过期车况当永久真相。 */
export const PANEL_CACHE_TTL_MS = 10 * 60_000;

export function readPanelCache<T>(key: string, ttlMs = PANEL_CACHE_TTL_MS): T | null {
  const hit = mem.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    mem.delete(key);
    return null;
  }
  return hit.data;
}

export function writePanelCache<T>(key: string, data: T): void {
  mem.set(key, { at: Date.now(), data });
}

export function clearPanelCache(key?: string): void {
  if (key) mem.delete(key);
  else mem.clear();
}

export const PANEL_CACHE_KEYS = {
  tesla: 'panel:tesla',
  family: 'panel:family',
  adminMetrics: 'panel:admin-metrics',
} as const;
