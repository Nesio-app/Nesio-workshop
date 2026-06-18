import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const QUOTE_URL = 'https://v1.hitokoto.cn/?c=i&c=k&encode=json';
const MAX_QUOTE_LENGTH = 140;

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

export async function GET() {
  try {
    const response = await fetchQuoteWithTimeout(1800);
    if (!response.ok) throw new Error(`quote upstream ${response.status}`);
    const quote = normalizeQuote(await response.json());
    if (!quote) throw new Error('quote upstream returned unusable payload');
    return NextResponse.json(
      { ok: true, quote, source: 'hitokoto' },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, quote: null, source: 'local_fallback' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
