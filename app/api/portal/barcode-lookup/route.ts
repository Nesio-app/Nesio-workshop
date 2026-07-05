/**
 * GET /api/portal/barcode-lookup?upc=xxxx — 条码 → 商品名/图/价格(批次 18)。
 * 数据源:UPCitemdb 试用档(无需 key,约 100 次/天);配置 UPCITEMDB_KEY
 * 后自动切正式档。价格取历史最低与报价里的最小非零值,仅作冷静参考。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface UpcItem {
  title?: string;
  brand?: string;
  images?: string[];
  lowest_recorded_price?: number;
  offers?: Array<{ price?: number; merchant?: string }>;
}

export async function GET(req: NextRequest) {
  const guard = await guardAiRoute(req, 'barcode', { limit: 30 });
  if (guard) return guard;

  const upc = new URL(req.url).searchParams.get('upc')?.trim() || '';
  if (!/^\d{8,14}$/.test(upc)) {
    return NextResponse.json({ ok: false, error: 'invalid_upc' }, { status: 400 });
  }

  const key = envValue('UPCITEMDB_KEY');
  const endpoint = key
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${upc}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`;

  try {
    const res = await fetch(endpoint, {
      headers: key ? { user_key: key, key_type: '3scale' } : {},
      cache: 'no-store',
    });
    if (res.status === 429) {
      return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
    }
    const data = await res.json() as { code?: string; items?: UpcItem[] };
    const item = data.items?.[0];
    if (!item) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    const offerPrices = (item.offers ?? [])
      .map((o) => o.price ?? 0)
      .filter((p) => p > 0);
    const price = offerPrices.length
      ? Math.min(...offerPrices)
      : (item.lowest_recorded_price && item.lowest_recorded_price > 0 ? item.lowest_recorded_price : undefined);

    return NextResponse.json({
      ok: true,
      upc,
      title: [item.brand, item.title].filter(Boolean).join(' ').trim() || item.title || '',
      image: item.images?.[0] || '',
      price,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 502 });
  }
}
