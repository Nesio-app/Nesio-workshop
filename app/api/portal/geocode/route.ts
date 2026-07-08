/**
 * POST /api/portal/geocode — 反向地理编码(批次 33,默认关,用户在足迹里手动开)。
 *
 * 把「未命名地点」的经纬度换成真实地名。双后端:
 *  · 配了 GOOGLE_MAPS_API_KEY(在 Cloud Console Enable「Geocoding API」并配到 Vercel)→ 用 Google,
 *    名字质量更好(常给店名/POI)。
 *  · 没配 → 回落 OpenStreetMap Nominatim(免费、无需 key)。
 * 隐私提示:坐标会经 Nesio 服务器发给外部地图 —— 所以这是用户显式开启的可选功能,不默认。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

interface GoogleComponent { long_name?: string; types?: string[] }
interface GoogleResult { formatted_address?: string; address_components?: GoogleComponent[]; types?: string[] }
// 批次 40:除了地名,也返回城市/国家 —— 供足迹 World tab(去过的国家 → 城市)。
// 真分类批:再返回地点本来的类别 kind(OSM category/type、Google types 映射)——
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

/** Google result.types → 足迹类别。 */
function kindFromGoogle(types: string[]): string | undefined {
  const has = (...ts: string[]) => ts.some((x) => types.includes(x));
  if (has('supermarket', 'grocery_or_supermarket', 'convenience_store')) return 'grocery';
  if (has('cafe', 'bakery')) return 'cafe';
  if (has('restaurant', 'meal_takeaway', 'meal_delivery', 'bar', 'food')) return 'food';
  if (has('park', 'campground')) return 'park';
  if (has('school', 'university', 'primary_school', 'secondary_school', 'library')) return 'education';
  if (has('gym', 'stadium')) return 'fitness';
  if (has('hospital', 'doctor', 'dentist', 'pharmacy', 'drugstore', 'physiotherapist', 'veterinary_care')) return 'health';
  if (has('lodging')) return 'lodging';
  if (has('museum', 'art_gallery', 'movie_theater', 'church', 'place_of_worship', 'hindu_temple', 'mosque', 'synagogue')) return 'culture';
  if (has('airport', 'train_station', 'transit_station', 'bus_station', 'subway_station', 'gas_station', 'parking')) return 'transit';
  if (has('amusement_park', 'zoo', 'aquarium', 'casino', 'night_club', 'bowling_alley')) return 'entertainment';
  if (has('shopping_mall', 'department_store', 'clothing_store', 'store', 'furniture_store', 'electronics_store', 'home_goods_store')) return 'shopping';
  return undefined;
}

function pickGoogleComp(comps: GoogleComponent[], types: string[]): string {
  const c = comps.find((x) => (x.types || []).some((t) => types.includes(t)));
  return c?.long_name || '';
}

async function googleReverse(lat: number, lon: number, key: string): Promise<GeoResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${key}&language=en`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { status?: string; results?: GoogleResult[] };
  if (data.status !== 'OK' || !data.results?.length) return null;
  const POI = ['point_of_interest', 'establishment', 'premise'];
  const best = data.results.find((r) => (r.types || []).some((t) => POI.includes(t))) || data.results[0];
  const comps = best.address_components || [];
  const name = (pickGoogleComp(comps, [...POI, 'neighborhood']) || best.formatted_address?.split(',')[0] || '').slice(0, 40);
  const city = (pickGoogleComp(comps, ['locality', 'postal_town', 'sublocality', 'administrative_area_level_2'])).slice(0, 40);
  const country = pickGoogleComp(comps, ['country']).slice(0, 40);
  return { name, city, country, kind: kindFromGoogle(best.types || []) };
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

  const body = await req.json().catch(() => ({})) as { lat?: number; lon?: number };
  const { lat, lon } = body;
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'bad_coords' }, { status: 400 });
  }

  const googleKey = envValue('GOOGLE_MAPS_API_KEY');
  try {
    if (googleKey) {
      const g = await googleReverse(lat, lon, googleKey);
      if (g && (g.name || g.city || g.country)) return NextResponse.json({ ok: true, ...g, source: 'google' });
      // Google 没给结果就回落 OSM
    }
    const osm = await osmReverse(lat, lon);
    if (osm) return NextResponse.json({ ok: true, ...osm, source: 'osm' });
    return NextResponse.json({ ok: false, error: 'no_result' }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: 'geocode_unreachable' }, { status: 502 });
  }
}
