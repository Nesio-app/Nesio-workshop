/**
 * travel-poi — 离线世界景点库(随包发布,不依赖网络)。
 *
 * 数据来源:public/data/travel-poi/*.json
 * (SightsMap / Wikidata sample: japan-attractions + tokyo 粗筛)。
 * 行程目的地匹配城市中心后,按距离推荐;也可关键词搜索。
 */

import { haversineKm } from '@/lib/portal/geo';

export type TravelPoiType = 'attraction' | 'museum' | 'unesco' | 'monument' | string;

export interface TravelPoi {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  wikidata?: string;
  type?: TravelPoiType;
}

interface PoiFile {
  source?: string;
  schema?: string;
  note?: string;
  count?: number;
  items: TravelPoi[];
}

type CityKey = 'tokyo' | 'osaka' | 'kyoto' | 'yokohama' | 'nagoya' | 'sapporo' | 'fukuoka' | 'kobe' | 'nara' | 'hiroshima';

const CITY_CENTERS: Record<CityKey, { lat: number; lon: number; radiusKm: number; aliases: string[] }> = {
  tokyo: { lat: 35.6812, lon: 139.7671, radiusKm: 55, aliases: ['tokyo', '东京', '東京', 'toukyou', 'edo'] },
  osaka: { lat: 34.6937, lon: 135.5023, radiusKm: 35, aliases: ['osaka', '大阪', 'おおさか'] },
  kyoto: { lat: 35.0116, lon: 135.7681, radiusKm: 30, aliases: ['kyoto', '京都', 'きょうと'] },
  yokohama: { lat: 35.4437, lon: 139.6380, radiusKm: 25, aliases: ['yokohama', '横滨', '横浜'] },
  nagoya: { lat: 35.1815, lon: 136.9066, radiusKm: 30, aliases: ['nagoya', '名古屋'] },
  sapporo: { lat: 43.0618, lon: 141.3545, radiusKm: 30, aliases: ['sapporo', '札幌'] },
  fukuoka: { lat: 33.5904, lon: 130.4017, radiusKm: 30, aliases: ['fukuoka', '福冈', '福岡'] },
  kobe: { lat: 34.6901, lon: 135.1956, radiusKm: 25, aliases: ['kobe', '神户', '神戸'] },
  nara: { lat: 34.6851, lon: 135.8048, radiusKm: 25, aliases: ['nara', '奈良'] },
  hiroshima: { lat: 34.3853, lon: 132.4553, radiusKm: 30, aliases: ['hiroshima', '广岛', '広島'] },
};

let japanCache: TravelPoi[] | null = null;
let tokyoCache: TravelPoi[] | null = null;
let loadPromise: Promise<void> | null = null;

function normalizeDest(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '');
}

export function matchCityKey(destination: string): CityKey | null {
  const n = normalizeDest(destination);
  if (!n) return null;
  for (const [key, meta] of Object.entries(CITY_CENTERS) as Array<[CityKey, (typeof CITY_CENTERS)[CityKey]]>) {
    if (meta.aliases.some((a) => n.includes(a.toLowerCase()) || a.toLowerCase().includes(n))) return key;
  }
  // 日本笼统目的地 → 东京圈作默认推荐起点
  if (/japan|日本|nihon|nippon/.test(n)) return 'tokyo';
  return null;
}

async function fetchPoiFile(path: string): Promise<TravelPoi[]> {
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`poi_load_failed:${path}:${res.status}`);
  const data = (await res.json()) as PoiFile;
  return (data.items || []).filter((i) => i && typeof i.name === 'string' && Number.isFinite(i.lat) && Number.isFinite(i.lon));
}

/** 预热离线库(打开计划/时间线时调用)。失败不抛——无降级为空列表。 */
export async function ensureTravelPoiLoaded(): Promise<{ japan: number; tokyo: number; error?: string }> {
  if (japanCache && tokyoCache) return { japan: japanCache.length, tokyo: tokyoCache.length };
  if (!loadPromise) {
    loadPromise = (async () => {
      const [japan, tokyo] = await Promise.all([
        fetchPoiFile('/data/travel-poi/japan-attractions.json'),
        fetchPoiFile('/data/travel-poi/tokyo-attractions.json'),
      ]);
      japanCache = japan;
      tokyoCache = tokyo;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  try {
    await loadPromise;
    return { japan: japanCache?.length || 0, tokyo: tokyoCache?.length || 0 };
  } catch (err) {
    return { japan: 0, tokyo: 0, error: err instanceof Error ? err.message : 'poi_load_failed' };
  }
}

export function isTravelPoiReady(): boolean {
  return Boolean(japanCache && tokyoCache);
}

export function listAllTravelPois(): TravelPoi[] {
  return japanCache ? [...japanCache] : [];
}

/** 按目的地推荐离线景点(距离近优先;东京走专用粗筛包)。 */
export function suggestPoisForDestination(destination: string, opts?: {
  limit?: number;
  type?: TravelPoiType | 'all';
  query?: string;
}): TravelPoi[] {
  const limit = opts?.limit ?? 24;
  const type = opts?.type || 'all';
  const q = (opts?.query || '').trim().toLowerCase();
  const city = matchCityKey(destination);
  const pool: TravelPoi[] =
    city === 'tokyo' && tokyoCache?.length
      ? tokyoCache
      : (japanCache || []);

  let scored = pool.map((p) => {
    let score = 0;
    if (city) {
      const c = CITY_CENTERS[city];
      const d = haversineKm(c.lat, c.lon, p.lat, p.lon);
      score = d <= c.radiusKm ? c.radiusKm - d : 1000 + d;
    } else {
      score = 500;
    }
    if (type !== 'all' && p.type !== type) score += 5000;
    if (q) {
      const hay = `${p.name} ${p.type || ''} ${p.country || ''}`.toLowerCase();
      if (!hay.includes(q)) score += 8000;
      else score -= 50;
    }
    // 联合国教科文/名所略抬
    if (p.type === 'unesco') score -= 8;
    if (p.type === 'attraction') score -= 2;
    return { p, score };
  });

  scored = scored.filter((x) => x.score < 7000).sort((a, b) => a.score - b.score);
  // 去重同名
  const seen = new Set<string>();
  const out: TravelPoi[] = [];
  for (const { p } of scored) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export function searchTravelPois(query: string, limit = 30): TravelPoi[] {
  return suggestPoisForDestination('', { limit, query });
}

export function poiTypeLabel(type: string | undefined, zh: boolean): string {
  switch (type) {
    case 'museum': return zh ? '博物馆' : 'Museum';
    case 'unesco': return zh ? '世界遗产' : 'UNESCO';
    case 'monument': return zh ? '纪念碑' : 'Monument';
    case 'attraction': return zh ? '景点' : 'Attraction';
    default: return type || (zh ? '地点' : 'Place');
  }
}
