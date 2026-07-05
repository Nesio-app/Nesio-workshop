/**
 * POST /api/portal/geocode — 反向地理编码(批次 33,默认关,用户在足迹里手动开)。
 *
 * 把「未命名地点」的经纬度换成真实地名。用 OpenStreetMap Nominatim(免费、无需 key)。
 * 隐私提示:坐标会经 Nesio 服务器发给 OSM —— 所以这是用户显式开启的可选功能,不默认。
 * 服务端代理:避开浏览器 CORS,并带上 Nominatim 要求的 User-Agent。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'geocode', { limit: 30 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { lat?: number; lon?: number };
  const { lat, lon } = body;
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'bad_coords' }, { status: 400 });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Nesio/1.0 (personal life kit; on-device reverse geocode)', 'Accept-Language': 'en' },
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `nominatim_${res.status}` }, { status: 502 });
    const data = await res.json() as { name?: string; display_name?: string; address?: Record<string, string> };
    const a = data.address || {};
    // 优先具体地名(店/建筑),否则退到 街道 / 社区 / 城市
    const name = data.name
      || a.shop || a.amenity || a.building || a.office || a.leisure || a.tourism
      || a.road || a.neighbourhood || a.suburb || a.city || a.town || a.village
      || (data.display_name ? data.display_name.split(',')[0] : '');
    return NextResponse.json({ ok: true, name: (name || '').slice(0, 40) });
  } catch {
    return NextResponse.json({ ok: false, error: 'geocode_unreachable' }, { status: 502 });
  }
}
