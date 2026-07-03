/**
 * POST /api/portal/parse-url
 *
 * Fetches a URL and extracts product metadata (og:title, og:image, price).
 * Used by the 冷冻仓 flow to identify what the user wants to buy.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ParseResult {
  ok: boolean;
  title?: string;
  price?: string;
  image?: string;
  store?: string;
  description?: string;
  error?: string;
}

function extractMeta(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractTitle(html: string): string {
  const og = extractMeta(html, 'og:title');
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? '';
}

function extractPrice(html: string, url: string): string {
  // Common price patterns in Chinese shopping sites
  const pricePatterns = [
    /["']price["']\s*[:=]\s*["']?(\d+\.?\d*)["']?/i,
    /class=["'][^"']*price[^"']*["'][^>]*>[\s¥￥$]*(\d+[\d,.]*)/i,
    /<span[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /content=["'][^"']*["'][^>]*itemprop=["']price["']/i,
  ];
  for (const p of pricePatterns) {
    const m = html.match(p);
    if (m?.[1]) return `¥${m[1]}`;
  }
  return '';
}

function inferStore(url: string): string {
  if (/taobao\.com|tmall\.com/i.test(url)) return '淘宝/天猫';
  if (/jd\.com/i.test(url)) return '京东';
  if (/amazon\./i.test(url)) return 'Amazon';
  if (/pinduoduo\.com/i.test(url)) return '拼多多';
  if (/suning\.com/i.test(url)) return '苏宁';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

export async function POST(req: NextRequest): Promise<NextResponse<ParseResult>> {
  let url: string;
  try {
    const body = await req.json() as { url?: string };
    url = (body.url ?? '').trim();
    if (!url) throw new Error('missing url');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    new URL(url); // validate
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'invalid_url' });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NesioBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch_error_${res.status}` });
    }

    const html = await res.text();

    const title = extractTitle(html) || url;
    const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const price = extractPrice(html, url);
    const store = inferStore(url);

    return NextResponse.json({ ok: true, title, image, price, store, description });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg.includes('timeout') ? 'timeout' : 'fetch_failed' });
  }
}
