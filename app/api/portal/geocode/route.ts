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

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

interface GoogleComponent { long_name?: string; types?: string[] }
interface GoogleResult { formatted_address?: string; address_components?: GoogleComponent[]; types?: string[] }

async function googleReverse(lat: number, lon: number, key: string): Promise<string> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${key}&language=en`;
  const res = await fetch(url);
  if (!res.ok) return '';
  const data = await res.json() as { status?: string; results?: GoogleResult[] };
  if (data.status !== 'OK' || !data.results?.length) return '';
  const POI = ['point_of_interest', 'establishment', 'premise'];
  const best = data.results.find((r) => (r.types || []).some((t) => POI.includes(t))) || data.results[0];
  const comp = (best.address_components || []).find((c) => (c.types || []).some((t) => [...POI, 'neighborhood'].includes(t)));
  return (comp?.long_name || best.formatted_address?.split(',')[0] || '').slice(0, 40);
}

async function osmReverse(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Nesio/1.0 (personal life kit; on-device reverse geocode)', 'Accept-Language': 'en' } });
  if (!res.ok) return '';
  const data = await res.json() as { name?: string; display_name?: string; address?: Record<string, string> };
  const a = data.address || {};
  const name = data.name
    || a.shop || a.amenity || a.building || a.office || a.leisure || a.tourism
    || a.road || a.neighbourhood || a.suburb || a.city || a.town || a.village
    || (data.display_name ? data.display_name.split(',')[0] : '');
  return (name || '').slice(0, 40);
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
      const name = await googleReverse(lat, lon, googleKey);
      if (name) return NextResponse.json({ ok: true, name, source: 'google' });
      // Google 没给结果就回落 OSM
    }
    const osm = await osmReverse(lat, lon);
    return NextResponse.json({ ok: true, name: osm, source: 'osm' });
  } catch {
    return NextResponse.json({ ok: false, error: 'geocode_unreachable' }, { status: 502 });
  }
}
