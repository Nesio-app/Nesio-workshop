import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const QUOTE_URL = 'https://v1.hitokoto.cn/?c=i&c=k&encode=json';
const MAX_QUOTE_LENGTH = 140;
const BLOCKED_TERMS = [
  '死',
  '亡',
  '病',
  '杀',
  '恨',
  '愁',
  '悲',
  '伤',
  '泪',
  '孤',
  '墓',
  '沙场',
  '马革',
  '离别',
  '断肠',
  '并无新事',
];
const POSITIVE_TERMS = [
  '希望',
  '勇气',
  '温柔',
  '平安',
  '安心',
  '晴',
  '春',
  '花',
  '笑',
  '爱',
  '光明',
  '成长',
  '梦想',
  '前进',
  '稳',
  '允许',
  '变好',
  '完成',
  '路上',
  '一点点',
];

type QuoteLocale = 'zh' | 'en';

const POSITIVE_FALLBACK_QUOTES_BY_LOCALE: Record<QuoteLocale, string[]> = {
  zh: [
    '你已经在路上了，今天只需要再往前一点点。',
    '慢一点，深一点，稳一点。',
    '先完成一个小闭环，再决定下一件事。',
    '允许自己慢慢来，也允许事情变好。',
    '把复杂留给系统，把下一步留给自己。',
  ],
  en: [
    'You are not behind. You are growing at your own rhythm.',
    'Start with the smallest honest step.',
    'Let today be steady, not perfect.',
    'You can move gently and still move forward.',
    'Keep the next step simple enough to begin.',
  ],
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeQuote(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const quote = asTrimmedString(record.hitokoto);
  if (quote.length < 4 || quote.length > MAX_QUOTE_LENGTH) return null;
  const source = asTrimmedString(record.from);
  if (!source) return quote;
  const line = `${quote} —— ${source}`;
  return line.length <= MAX_QUOTE_LENGTH ? line : quote;
}

function isPositiveEnough(quote: string): boolean {
  if (BLOCKED_TERMS.some((term) => quote.includes(term))) return false;
  return POSITIVE_TERMS.some((term) => quote.includes(term));
}

function normalizeQuoteLocale(value: string | null | undefined): QuoteLocale {
  return value === 'en' ? 'en' : 'zh';
}

function fallbackQuote(locale: QuoteLocale): string {
  const quotes = POSITIVE_FALLBACK_QUOTES_BY_LOCALE[locale];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

async function fetchQuoteWithTimeout(ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(QUOTE_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const locale = normalizeQuoteLocale(new URL(request.url).searchParams.get('locale'));

  if (locale === 'en') {
    return NextResponse.json(
      { ok: true, quote: fallbackQuote(locale), source: 'local_fallback', locale: 'en' },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
    );
  }

  try {
    const response = await fetchQuoteWithTimeout(1800);
    if (!response.ok) throw new Error(`quote upstream ${response.status}`);
    const quote = normalizeQuote(await response.json());
    if (!quote) throw new Error('quote upstream returned unusable payload');
    if (!isPositiveEnough(quote)) {
      return NextResponse.json(
        { ok: true, quote: fallbackQuote(locale), source: 'positive_fallback', locale },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          },
        },
      );
    }
    return NextResponse.json(
      { ok: true, quote, source: 'hitokoto', locale },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: true, quote: fallbackQuote(locale), source: 'local_fallback', locale },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
    );
  }
}
