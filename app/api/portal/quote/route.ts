import { NextResponse } from 'next/server';
import {
  QUOTE_URL,
  MAX_QUOTE_LENGTH,
  fallbackQuote,
  isPositiveEnough,
  normalizeQuoteLocale,
} from '../../../../lib/portal/positive-quote-catalog.mjs';

export const dynamic = 'force-dynamic';

type QuoteLocale = 'zh' | 'en';

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
