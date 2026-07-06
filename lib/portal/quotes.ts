import type { PortalConfig } from './types';
import { reportStorageDropped } from './storage-health';

const SHOWN_KEY = 'treasurebox-quote-shown';
const POOL_KEY = 'treasurebox-quote-pool-id';
const LAST_KEY = 'treasurebox-quote-last';
const PREF_KEY = 'treasurebox-quote-preferences-v1';
const CURRENT_KEY = 'treasurebox-quote-current-v1';

const FALLBACK = '今天也要好好照顾自己。';

export type QuoteCategory = 'positive' | 'calm' | 'focus' | 'classic';
export type QuoteFrequency = 'each_open' | 'hourly' | 'daily';

export interface QuotePreferences {
  categories: QuoteCategory[];
  frequency: QuoteFrequency;
  externalEnabled: boolean;
}

interface CurrentQuoteCache {
  quote: string;
  savedAt: number;
  source?: 'local' | 'external';
}

export const QUOTE_CATEGORY_LABELS: Record<QuoteCategory, string> = {
  positive: '正向',
  calm: '安定',
  focus: '行动',
  classic: '诗意',
};

export const QUOTE_FREQUENCY_LABELS: Record<QuoteFrequency, string> = {
  each_open: '每次打开',
  hourly: '每小时',
  daily: '每天',
};

export const DEFAULT_QUOTE_PREFERENCES: QuotePreferences = {
  categories: ['positive', 'calm', 'focus'],
  frequency: 'hourly',
  externalEnabled: true,
};

const CATEGORY_QUOTES: Record<QuoteCategory, string[]> = {
  positive: [
    '你已经在路上了，今天只需要再往前一点点。',
    '允许自己慢慢来，也允许事情变好。',
    '能照顾好此刻，就是很重要的能力。',
    '今天不必完美，只要真实地推进一点。',
    '你不是落后，你是在用自己的节奏长出来。',
  ],
  calm: [
    '慢一点，深一点，稳一点。',
    '先把呼吸放回来，答案会清楚一点。',
    '把该放下的放下，把能做的留下。',
    '此刻先不用解决全部，只要安放自己。',
    '给自己三分钟，什么都不用想。',
  ],
  focus: [
    '只做最小的一件事，局面就会开始松动。',
    '把注意力放回手边，下一步会自己出现。',
    '先完成一个小闭环，再决定下一件事。',
    '今天的胜利可以很小，但要真实。',
    '把复杂留给系统，把下一步留给自己。',
  ],
  classic: [],
};

function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)));
}

function normalizePreferences(value: Partial<QuotePreferences> | null | undefined): QuotePreferences {
  const categories = Array.isArray(value?.categories)
    ? value.categories.filter((c): c is QuoteCategory => c in QUOTE_CATEGORY_LABELS)
    : [];
  const frequency = value?.frequency && value.frequency in QUOTE_FREQUENCY_LABELS
    ? value.frequency
    : DEFAULT_QUOTE_PREFERENCES.frequency;
  return {
    categories: categories.length ? categories : [...DEFAULT_QUOTE_PREFERENCES.categories],
    frequency,
    externalEnabled: value?.externalEnabled !== false,
  };
}

function quotePool(config: PortalConfig, preferences: QuotePreferences): string[] {
  const classic = [
    ...(config.meta.energyQuotes || []),
    ...(config.meta.warmReminders || []),
  ];
  const pools = preferences.categories.flatMap((category) => (
    category === 'classic' ? classic : CATEGORY_QUOTES[category]
  ));
  return unique(pools.length ? pools : [...CATEGORY_QUOTES.positive, ...classic]);
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

function frequencyMs(frequency: QuoteFrequency): number {
  if (frequency === 'daily') return 24 * 60 * 60 * 1000;
  if (frequency === 'hourly') return 60 * 60 * 1000;
  return 0;
}

export function loadQuotePreferences(): QuotePreferences {
  if (typeof window === 'undefined') return DEFAULT_QUOTE_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return normalizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_QUOTE_PREFERENCES;
  }
}

export function saveQuotePreferences(preferences: QuotePreferences): QuotePreferences {
  const next = normalizePreferences(preferences);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch { reportStorageDropped(); }
  }
  return next;
}

export function readCurrentQuote(): CurrentQuoteCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed.quote !== 'string' || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isQuoteCacheFresh(frequency: QuoteFrequency, at = Date.now()): boolean {
  const ttl = frequencyMs(frequency);
  if (ttl <= 0) return false;
  const current = readCurrentQuote();
  return Boolean(current?.quote && at - current.savedAt < ttl);
}

export function rememberCurrentQuote(quote: string, source: 'local' | 'external' = 'local'): void {
  if (typeof window === 'undefined') return;
  const trimmed = quote.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify({
      quote: trimmed,
      savedAt: Date.now(),
      source,
    }));
  } catch { /* ignore */ }
}

/** Pick a new quote on each page load; cycle through the pool without repeats. */
export function pickFreshQuote(
  config: PortalConfig,
  preferences = loadQuotePreferences(),
  options: { force?: boolean } = {},
): string {
  if (!options.force && isQuoteCacheFresh(preferences.frequency)) {
    const current = readCurrentQuote();
    if (current?.quote) return current.quote;
  }

  const pool = quotePool(config, preferences);
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

  rememberCurrentQuote(quote, 'local');
  return quote;
}
