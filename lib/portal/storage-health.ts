/**
 * Storage Health — visibility into the localStorage budget.
 *
 * The life graph (primary user data) lives in localStorage, which browsers
 * cap at ~5 MB per origin. Before this module, hitting the cap was silent:
 * life-graph's saveAll swallowed QuotaExceededError and new memories were
 * dropped without any signal to the user. Now saveAll dispatches
 * STORAGE_FULL_EVENT, and this module measures usage so the shell can warn
 * *before* the cliff (WARNING_EVENT at >80%, throttled daily).
 */

export const STORAGE_FULL_EVENT = 'nesio-storage-full';
export const STORAGE_WARNING_EVENT = 'nesio-storage-warning';

// Browsers commonly cap localStorage at 5 MiB of UTF-16 code units.
const ASSUMED_LIMIT_BYTES = 5 * 1024 * 1024;
const WARN_THRESHOLD = 0.8;
const WARN_THROTTLE_KEY = 'nesio-storage-warned-at';

export interface StorageHealth {
  usedBytes: number;
  limitBytes: number;
  percent: number; // 0-100
  largestKeys: Array<{ key: string; bytes: number }>;
}

export function getStorageHealth(): StorageHealth {
  const empty: StorageHealth = { usedBytes: 0, limitBytes: ASSUMED_LIMIT_BYTES, percent: 0, largestKeys: [] };
  if (typeof window === 'undefined') return empty;
  try {
    const sizes: Array<{ key: string; bytes: number }> = [];
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) ?? '';
      const bytes = (key.length + value.length) * 2; // UTF-16 code units
      sizes.push({ key, bytes });
      total += bytes;
    }
    sizes.sort((a, b) => b.bytes - a.bytes);
    return {
      usedBytes: total,
      limitBytes: ASSUMED_LIMIT_BYTES,
      percent: Math.round((total / ASSUMED_LIMIT_BYTES) * 100),
      largestKeys: sizes.slice(0, 5),
    };
  } catch {
    return empty;
  }
}

/**
 * 写入被配额丢弃时调用:派发可见事件让壳层提示用户(替代静默 catch)。
 * 设计红线:localStorage 写失败若会丢用户数据,必须可见,不能静默吞。
 */
export function reportStorageDropped(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: getStorageHealth() }));
}

/** Call after significant writes; fires the warning event at most once a day. */
export function checkStorageWarning(): void {
  if (typeof window === 'undefined') return;
  const health = getStorageHealth();
  if (health.percent < WARN_THRESHOLD * 100) return;
  try {
    const lastWarned = parseInt(localStorage.getItem(WARN_THROTTLE_KEY) || '0', 10);
    if (Date.now() - lastWarned < 24 * 3_600_000) return;
    localStorage.setItem(WARN_THROTTLE_KEY, String(Date.now()));
  } catch { /* if even this write fails, still warn */ }
  window.dispatchEvent(new CustomEvent(STORAGE_WARNING_EVENT, { detail: health }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
