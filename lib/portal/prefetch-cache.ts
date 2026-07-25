const TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  at: number;
  data: T;
}

export function readPortalCache<T>(key: string): T | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.at > TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function writePortalCache<T>(key: string, data: T): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const entry: CacheEntry<T> = { at: Date.now(), data };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export const PORTAL_CACHE_KEYS = {
  calendar: 'treasurebox-cache-calendar',
  weather: 'treasurebox-cache-weather',
  decModules: 'treasurebox-cache-dec-modules',
  family: 'treasurebox-cache-family',
} as const;

export const TREASURE_TOOLBOX_KEY = 'treasurebox-toolbox-open';
