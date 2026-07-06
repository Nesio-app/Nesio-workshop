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
export interface GeoResult { name: string; city: string; country: string }

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
  return { name, city, country };
}

async function osmReverse(lat: number, lon: number): Promise<GeoResult | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Nesio/1.0 (personal life kit; on-device reverse geocode)', 'Accept-Language': 'en' } });
  if (!res.ok) return null;
  const data = await res.json() as { name?: string; display_name?: string; address?: Record<string, string> };
  const a = data.address || {};
  const name = (data.name
    || a.shop || a.amenity || a.building || a.office || a.leisure || a.tourism
    || a.road || a.neighbourhood || a.suburb || a.city || a.town || a.village
    || (data.display_name ? data.display_name.split(',')[0] : '')).slice(0, 40);
  const city = (a.city || a.town || a.village || a.municipality || a.county || '').slice(0, 40);
  const country = (a.country || '').slice(0, 40);
  return { name, city, country };
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
