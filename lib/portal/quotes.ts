import type { PortalConfig } from './types';

const SHOWN_KEY = 'treasurebox-quote-shown';
const POOL_KEY = 'treasurebox-quote-pool-id';
const LAST_KEY = 'treasurebox-quote-last';

const FALLBACK = '今天也要好好照顾自己。';

function quotePool(config: PortalConfig): string[] {
  return [
    ...(config.meta.energyQuotes || []),
    ...(config.meta.warmReminders || []),
  ].filter(Boolean);
}

function poolSignature(pool: string[]): string {
  return `${pool.length}:${pool.join('\u0001')}`;
}

function readShown(poolId: string): string[] {
  try {
    if (localStorage.getItem(POOL_KEY) !== poolId) return [];
    const raw = localStorage.getItem(SHOWN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeShown(poolId: string, shown: string[]): void {
  localStorage.setItem(POOL_KEY, poolId);
  localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
}

/** Pick a new quote on each page load; cycle through the pool without repeats. */
export function pickFreshQuote(config: PortalConfig): string {
  const pool = quotePool(config);
  if (pool.length === 0) return FALLBACK;

  const poolId = poolSignature(pool);
  const shown = readShown(poolId);
  const remaining = pool.filter((q) => !shown.includes(q));
  const pickFrom = remaining.length > 0 ? remaining : pool;

  const last = (() => {
    try {
      return sessionStorage.getItem(LAST_KEY) || '';
    } catch {
      return '';
    }
  })();

  let candidates = pickFrom;
  if (pickFrom.length > 1 && last) {
    const withoutLast = pickFrom.filter((q) => q !== last);
    if (withoutLast.length > 0) candidates = withoutLast;
  }

  const quote = candidates[Math.floor(Math.random() * candidates.length)];

  if (remaining.length > 0) {
    writeShown(poolId, [...shown, quote]);
  } else {
    writeShown(poolId, [quote]);
  }

  try {
    sessionStorage.setItem(LAST_KEY, quote);
  } catch { /* ignore */ }

  return quote;
}
