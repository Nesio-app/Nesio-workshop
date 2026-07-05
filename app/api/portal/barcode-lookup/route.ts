/**
 * GET /api/portal/barcode-lookup?upc=xxxx — 条码 → 商品名/图/价格。
 *
 * 多源回退链(第一个命中且有商品名者胜),覆盖各国 + 尽量带商品图:
 *   1. UPCitemdb —— 零售广、常带价格(美国为主;配 UPCITEMDB_KEY 切正式档)
 *   2. Open Food Facts —— 全球食品/饮料社区库,含中国 69 条码,带图
 *   3. Open Beauty Facts —— 全球美妆/个护
 *   4. Open Products Facts —— 全球通用商品
 * OFF 家族无 key、全球覆盖、基本都带 image_url —— 补 UPCitemdb 对非美商品的缺口。
 *
 * 诚实边界:没有任何免费源能覆盖所有国家的所有商品(尤其随机电子/百货)。
 * 查不到时返回 ok:false,让前端引导「拍照片让 AI 认」。价格仅作冷静参考。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface Hit { title: string; image?: string; price?: number; source: string }

const UA = 'Nesio/1.0 (personal impulse-guard; contact hanbing6228@gmail.com)';

interface UpcItem {
  title?: string;
  brand?: string;
  images?: string[];
  lowest_recorded_price?: number;
  offers?: Array<{ price?: number; merchant?: string }>;
}

async function lookupUpcItemDb(upc: string): Promise<Hit | null> {
  const key = envValue('UPCITEMDB_KEY');
  const endpoint = key
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${upc}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`;
  try {
    const res = await fetch(endpoint, {
      headers: key ? { user_key: key, key_type: '3scale' } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null; // 429/4xx/5xx → 交给下一源
    const data = await res.json() as { items?: UpcItem[] };
    const item = data.items?.[0];
    if (!item) return null;
    const title = [item.brand, item.title].filter(Boolean).join(' ').trim() || item.title || '';
    if (!title) return null;
    const offerPrices = (item.offers ?? []).map((o) => o.price ?? 0).filter((p) => p > 0);
    const price = offerPrices.length
      ? Math.min(...offerPrices)
      : (item.lowest_recorded_price && item.lowest_recorded_price > 0 ? item.lowest_recorded_price : undefined);
    return { title, image: item.images?.[0] || undefined, price, source: 'upcitemdb' };
  } catch {
    return null;
  }
}

interface OffProduct {
  product_name?: string;
  product_name_zh?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  image_url?: string;
  image_front_url?: string;
  image_front_small_url?: string;
}

/** Open Food/Beauty/Products Facts 同构 v2 API。 */
async function lookupOpenFacts(upc: string, host: string, source: string): Promise<Hit | null> {
  try {
    const url = `https://${host}/api/v2/product/${upc}.json?fields=product_name,product_name_zh,product_name_en,generic_name,brands,image_url,image_front_url,image_front_small_url`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json() as { status?: number; product?: OffProduct };
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name = (p.product_name_zh || p.product_name || p.product_name_en || p.generic_name || '').trim();
    const title = [p.brands?.split(',')[0]?.trim(), name].filter(Boolean).join(' ').trim() || name;
    if (!title) return null;
    const image = p.image_front_url || p.image_url || p.image_front_small_url || undefined;
    return { title, image, source };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardAiRoute(req, 'barcode', { limit: 30 });
  if (guard) return guard;

  const upc = new URL(req.url).searchParams.get('upc')?.trim() || '';
  if (!/^\d{8,14}$/.test(upc)) {
    return NextResponse.json({ ok: false, error: 'invalid_upc' }, { status: 400 });
  }

  // 回退链:第一个有商品名者胜。若命中但没图,继续找带图的源补图。
  const sources: Array<() => Promise<Hit | null>> = [
    () => lookupUpcItemDb(upc),
    () => lookupOpenFacts(upc, 'world.openfoodfacts.org', 'openfoodfacts'),
    () => lookupOpenFacts(upc, 'world.openbeautyfacts.org', 'openbeautyfacts'),
    () => lookupOpenFacts(upc, 'world.openproductsfacts.org', 'openproductsfacts'),
  ];

  let best: Hit | null = null;
  for (const run of sources) {
    const hit = await run();
    if (!hit) continue;
    if (!best) best = hit;
    else if (!best.image && hit.image) best.image = hit.image; // 补图
    if (best.image) break; // 有名有图,够了
  }

  if (!best) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, upc, title: best.title, image: best.image || '', price: best.price, source: best.source });
}
