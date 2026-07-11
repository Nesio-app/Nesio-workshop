/**
 * POST /api/portal/geocode — 反向地理编码(批次 33,默认关,用户在足迹里手动开)。
 *
 * 把「未命名地点」的经纬度换成真实地名。双后端(地图批:Google→Foursquare):
 *  · 配了 FOURSQUARE_SERVICE_TOKEN → 用 Foursquare Places(全球 1 亿 POI,认店最准,
 *    「这个坐标是哪家店」比 Google 更强;每月有免费额度)。
 *  · 没配 → 回落 OpenStreetMap Nominatim(免费、无需 key)。
 * 隐私提示:坐标会经 Nesio 服务器发给外部地图 —— 所以这是用户显式开启的可选功能,不默认。
 *
 * Foursquare 现行 API(2025 改版):base=places-api.foursquare.com、
 * Authorization: Bearer <service token>、X-Places-Api-Version 日期头。字段解析防御式
 * (fsq_place_id/fsq_id、location.locality/dma 都兼容),契约测试锁死映射。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

// 批次 40:除了地名,也返回城市/国家 —— 供足迹 World tab(去过的国家 → 城市)。
// 真分类批:再返回地点本来的类别 kind(OSM category/type、Foursquare 分类名映射)——
// 沃尔玛就是超市,不再靠名字猜。
export interface GeoResult { name: string; city: string; country: string; kind?: string }

/** OSM jsonv2 的 category/type → 足迹类别。 */
function kindFromOsm(category?: string, type?: string): string | undefined {
  const c = category || '';
  const ty = type || '';
  if (c === 'shop') {
    if (/supermarket|grocery|convenience|greengrocer/.test(ty)) return 'grocery';
    return 'shopping';
  }
  if (c === 'amenity') {
    if (/cafe|bubble_tea|ice_cream/.test(ty)) return 'cafe';
    if (/restaurant|fast_food|food_court|bar|pub|biergarten/.test(ty)) return 'food';
    if (/hospital|clinic|pharmacy|dentist|doctors|veterinary/.test(ty)) return 'health';
    if (/school|university|college|kindergarten|library/.test(ty)) return 'education';
    if (/gym|sports/.test(ty)) return 'fitness';
    if (/theatre|cinema|arts_centre|place_of_worship/.test(ty)) return 'culture';
    if (/fuel|bus_station|ferry_terminal|parking/.test(ty)) return 'transit';
    if (/casino|nightclub/.test(ty)) return 'entertainment';
  }
  if (c === 'leisure') {
    if (/park|garden|nature_reserve|playground/.test(ty)) return 'park';
    if (/fitness|sports|pitch|stadium|swimming/.test(ty)) return 'fitness';
    if (/amusement|water_park|bowling/.test(ty)) return 'entertainment';
  }
  if (c === 'tourism') {
    if (/hotel|motel|guest_house|hostel|apartment/.test(ty)) return 'lodging';
    if (/museum|gallery|attraction|artwork/.test(ty)) return 'culture';
    if (/zoo|theme_park|aquarium/.test(ty)) return 'entertainment';
  }
  if (c === 'aeroway' || c === 'railway') return 'transit';
  if (c === 'office') return 'work';
  return undefined;
}

/** Foursquare 分类名(如 "Grocery Store" / "Café" / "Pharmacy")→ 足迹类别。按关键词匹配。 */
function kindFromFoursquare(categoryNames: string[]): string | undefined {
  const s = categoryNames.join(' | ').toLowerCase();
  if (/grocery|supermarket|convenience|market\b|deli/.test(s)) return 'grocery';
  if (/café|cafe|coffee|tea room|bubble tea|bakery|dessert|ice cream/.test(s)) return 'cafe';
  if (/restaurant|food|diner|steakhouse|pizzeria|bar\b|pub|brewery|bbq|noodle|sushi|taco|burger/.test(s)) return 'food';
  if (/park|garden|playground|trail|campground/.test(s)) return 'park';
  if (/school|university|college|library|education/.test(s)) return 'education';
  if (/gym|fitness|yoga|pilates|studio|stadium|sports/.test(s)) return 'fitness';
  if (/hospital|clinic|pharmacy|drugstore|dentist|doctor|medical|health|veterinar/.test(s)) return 'health';
  if (/hotel|motel|hostel|lodging|inn\b|resort|bed & breakfast/.test(s)) return 'lodging';
  if (/museum|gallery|theater|theatre|cinema|movie|church|temple|mosque|synagogue|worship|art/.test(s)) return 'culture';
  if (/airport|train|transit|bus station|subway|metro|gas station|fuel|parking|ferry/.test(s)) return 'transit';
  if (/amusement|zoo|aquarium|casino|night club|nightclub|bowling|arcade/.test(s)) return 'entertainment';
  if (/mall|department store|clothing|store|shop|boutique|electronics|furniture|hardware/.test(s)) return 'shopping';
  if (/office|coworking|corporate/.test(s)) return 'work';
  return undefined;
}

interface FsqCategory { name?: string; short_name?: string }
interface FsqLocation {
  formatted_address?: string; address?: string;
  locality?: string; dma?: string; region?: string; country?: string; admin_region?: string;
}
interface FsqPlace { fsq_place_id?: string; fsq_id?: string; name?: string; distance?: number; categories?: FsqCategory[]; location?: FsqLocation }

// Foursquare location.country 有时是 ISO-2 代码(如 "US")。补一张常见国家小表,
// 让足迹 World tab 显示全名而非代码;查不到就原样透传(仍能按值分组)。
const ISO2_COUNTRY: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', CN: 'China', JP: 'Japan',
  KR: 'South Korea', AU: 'Australia', DE: 'Germany', FR: 'France', IT: 'Italy',
  ES: 'Spain', NL: 'Netherlands', SG: 'Singapore', HK: 'Hong Kong', TW: 'Taiwan',
  MX: 'Mexico', BR: 'Brazil', IN: 'India', TH: 'Thailand', MY: 'Malaysia',
};
function countryName(raw: string): string {
  const v = (raw || '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return ISO2_COUNTRY[v.toUpperCase()] || v.toUpperCase();
  return v.slice(0, 40);
}

async function foursquareReverse(lat: number, lon: number, token: string): Promise<GeoResult | null> {
  // 取最近一个 POI:sort=DISTANCE + limit=1。radius 收窄防抓到几百米外的店。
  const url = `https://places-api.foursquare.com/places/search?ll=${lat},${lon}&sort=DISTANCE&radius=120&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Places-Api-Version': '2025-02-05', Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json() as { results?: FsqPlace[] };
  const p = data.results?.[0];
  if (!p) return null;
  const loc = p.location || {};
  const cats = (p.categories || []).map((c) => c.name || c.short_name || '').filter(Boolean);
  const name = (p.name || loc.formatted_address?.split(',')[0] || loc.address || '').slice(0, 40);
  const city = (loc.locality || loc.dma || loc.region || loc.admin_region || '').slice(0, 40);
  const country = countryName(loc.country || '');
  if (!name && !city && !country) return null;
  return { name, city, country, kind: kindFromFoursquare(cats) };
}

/** 批次 62:附近 POI 候选(地点纠正选择器)—— Foursquare 搜最近 8 个,
 *  城市里楼挨楼分不清时由用户从列表里选;OSM reverse 作兜底候选。 */
async function foursquareNearby(lat: number, lon: number, token: string): Promise<Array<{ name: string; distanceM?: number; kind?: string; city?: string; country?: string }>> {
  const url = `https://places-api.foursquare.com/places/search?ll=${lat},${lon}&sort=DISTANCE&radius=300&limit=8`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Places-Api-Version': '2025-02-05', Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { results?: FsqPlace[] };
  return (data.results || []).map((p) => {
    const loc = p.location || {};
    const cats = (p.categories || []).map((c) => c.name || c.short_name || '').filter(Boolean);
    return {
      name: (p.name || '').slice(0, 48),
      distanceM: typeof p.distance === 'number' ? p.distance : undefined,
      kind: kindFromFoursquare(cats),
      city: (loc.locality || loc.region || '').slice(0, 40),
      country: countryName(loc.country || ''),
    };
  }).filter((c) => c.name);
}

/** 批次 82/92(用户实锤:附近只出街道名):没配 Foursquare 时用 OSM Overpass
 *  免费查 400m 内带名字的实体(商铺/餐饮/休闲/景点/办公/手作/医疗)。
 *  批次 92 根因修:批次 82 用 5 个独立标签子句 + 服务端 timeout:4 + 客户端
 *  4.5s abort,处理不完被掐死,只剩街道兜底(实测该位置 OSM 有 17 个真门店)。
 *  改单条正则键子句(一次扫描,实测 1s)+ 服务端 timeout:12 + 客户端 12s。 */
async function overpassNearby(lat: number, lon: number): Promise<Array<{ name: string; distanceM?: number; kind?: string }>> {
  const q = `[out:json][timeout:12];nwr(around:400,${lat},${lon})[name][~"^(shop|amenity|leisure|tourism|office|craft|healthcare)$"~"."];out center 30;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
    const toRad = (v: number) => (v * Math.PI) / 180;
    const dist = (la: number, lo: number) => {
      const dLa = toRad(la - lat); const dLo = toRad(lo - lon);
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(la)) * Math.sin(dLo / 2) ** 2;
      return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
    };
    const seen = new Set<string>();
    const out: Array<{ name: string; distanceM: number; kind?: string }> = [];
    for (const e of data.elements || []) {
      const name = (e.tags?.name || '').slice(0, 48);
      const la = e.lat ?? e.center?.lat; const lo = e.lon ?? e.center?.lon;
      if (!name || la == null || lo == null || seen.has(name)) continue;
      seen.add(name);
      const t = e.tags || {};
      out.push({
        name,
        distanceM: dist(la, lo),
        kind: kindFromOsm(
          t.shop ? 'shop' : t.amenity ? 'amenity' : t.leisure ? 'leisure' : t.tourism ? 'tourism' : t.office ? 'office' : t.healthcare ? 'amenity' : t.craft ? 'shop' : undefined,
          t.shop || t.amenity || t.leisure || t.tourism || t.office || t.healthcare || t.craft,
        ),
      });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, 10);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function osmReverse(lat: number, lon: number): Promise<GeoResult | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Nesio/1.0 (personal life kit; on-device reverse geocode)', 'Accept-Language': 'en' } });
  if (!res.ok) return null;
  const data = await res.json() as { name?: string; display_name?: string; address?: Record<string, string>; category?: string; type?: string };
  const a = data.address || {};
  const name = (data.name
    || a.shop || a.amenity || a.building || a.office || a.leisure || a.tourism
    || a.road || a.neighbourhood || a.suburb || a.city || a.town || a.village
    || (data.display_name ? data.display_name.split(',')[0] : '')).slice(0, 40);
  const city = (a.city || a.town || a.village || a.municipality || a.county || '').slice(0, 40);
  const country = (a.country || '').slice(0, 40);
  return { name, city, country, kind: kindFromOsm(data.category, data.type) };
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'geocode', { limit: 30 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { lat?: number; lon?: number; nearby?: boolean };
  const { lat, lon } = body;
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'bad_coords' }, { status: 400 });
  }

  const fsqToken = envValue('FOURSQUARE_SERVICE_TOKEN');
  try {
    if (body.nearby) {
      const candidates: Array<{ name: string; distanceM?: number; kind?: string; city?: string; country?: string }> =
        fsqToken ? await foursquareNearby(lat, lon, fsqToken) : [];
      // 批次 82:Foursquare 缺席/结果太薄时,Overpass 免费补足附近实体名
      if (candidates.length < 3) {
        const extra = await overpassNearby(lat, lon).catch(() => []);
        for (const e of extra) {
          if (!candidates.some((c) => c.name === e.name)) candidates.push(e);
        }
      }
      const osm = await osmReverse(lat, lon).catch(() => null);
      if (osm?.name && !candidates.some((c) => c.name === osm.name)) {
        candidates.push({ name: osm.name, kind: osm.kind, city: osm.city, country: osm.country });
      }
      return NextResponse.json({ ok: true, candidates });
    }
    if (fsqToken) {
      const f = await foursquareReverse(lat, lon, fsqToken);
      if (f && (f.name || f.city || f.country)) return NextResponse.json({ ok: true, ...f, source: 'foursquare' });
      // Foursquare 没给结果(如纯住宅坐标附近无 POI)就回落 OSM 取地址/区域名
    }
    const osm = await osmReverse(lat, lon);
    if (osm) return NextResponse.json({ ok: true, ...osm, source: 'osm' });
    return NextResponse.json({ ok: false, error: 'no_result' }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: 'geocode_unreachable' }, { status: 502 });
  }
}
