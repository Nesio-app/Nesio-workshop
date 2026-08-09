/**
 * travel-poi — 离线世界景点库(随包发布,不依赖网络)。
 *
 * 数据来源:public/data/travel-poi/*.json
 * (japan/tokyo 细筛 + world 全球精选)。行程目的地匹配城市中心后,按距离推荐;也可关键词搜索。
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
  /** 中文短简介(~40–120字) */
  summary?: string;
  /** 英文短简介(可选) */
  summaryEn?: string;
  ticketPrice?: string;
  hours?: string;
  tips?: string;
  imageUrl?: string;
}

interface PoiFile {
  source?: string;
  schema?: string;
  note?: string;
  count?: number;
  items: TravelPoi[];
}

type CityKey =
  | 'tokyo' | 'osaka' | 'kyoto' | 'yokohama' | 'nagoya' | 'sapporo' | 'fukuoka' | 'kobe' | 'nara' | 'hiroshima'
  | 'newyork' | 'losangeles' | 'sanfrancisco' | 'chicago' | 'washington' | 'lasvegas' | 'seattle' | 'boston' | 'miami'
  | 'london' | 'paris' | 'rome' | 'barcelona' | 'madrid' | 'berlin' | 'amsterdam' | 'istanbul' | 'prague' | 'vienna'
  | 'beijing' | 'shanghai' | 'hongkong' | 'guangzhou' | 'shenzhen' | 'chengdu' | 'xian' | 'hangzhou' | 'macau'
  | 'seoul' | 'bangkok' | 'singapore' | 'sydney' | 'melbourne' | 'taipei' | 'dubai' | 'mumbai' | 'delhi' | 'cairo';

const CITY_CENTERS: Record<CityKey, { lat: number; lon: number; radiusKm: number; aliases: string[] }> = {
  // Japan
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
  // USA
  newyork: { lat: 40.7128, lon: -74.0060, radiusKm: 45, aliases: ['new york', 'newyork', 'nyc', '纽约', '紐約', 'manhattan'] },
  losangeles: { lat: 34.0522, lon: -118.2437, radiusKm: 50, aliases: ['los angeles', 'losangeles', 'la', '洛杉矶', '洛杉磯', 'hollywood'] },
  sanfrancisco: { lat: 37.7749, lon: -122.4194, radiusKm: 35, aliases: ['san francisco', 'sanfrancisco', 'sf', '旧金山', '舊金山'] },
  chicago: { lat: 41.8781, lon: -87.6298, radiusKm: 40, aliases: ['chicago', '芝加哥'] },
  washington: { lat: 38.9072, lon: -77.0369, radiusKm: 35, aliases: ['washington', 'washington dc', 'dc', '华盛顿', '華盛頓'] },
  lasvegas: { lat: 36.1699, lon: -115.1398, radiusKm: 30, aliases: ['las vegas', 'lasvegas', 'vegas', '拉斯维加斯', '拉斯維加斯'] },
  seattle: { lat: 47.6062, lon: -122.3321, radiusKm: 35, aliases: ['seattle', '西雅图', '西雅圖'] },
  boston: { lat: 42.3601, lon: -71.0589, radiusKm: 30, aliases: ['boston', '波士顿', '波士頓'] },
  miami: { lat: 25.7617, lon: -80.1918, radiusKm: 35, aliases: ['miami', '迈阿密', '邁阿密'] },
  // Europe
  london: { lat: 51.5074, lon: -0.1278, radiusKm: 45, aliases: ['london', '伦敦', '倫敦'] },
  paris: { lat: 48.8566, lon: 2.3522, radiusKm: 40, aliases: ['paris', '巴黎'] },
  rome: { lat: 41.9028, lon: 12.4964, radiusKm: 35, aliases: ['rome', 'roma', '罗马', '羅馬'] },
  barcelona: { lat: 41.3874, lon: 2.1686, radiusKm: 30, aliases: ['barcelona', '巴塞罗那', '巴塞隆納', '巴萨'] },
  madrid: { lat: 40.4168, lon: -3.7038, radiusKm: 35, aliases: ['madrid', '马德里', '馬德里'] },
  berlin: { lat: 52.5200, lon: 13.4050, radiusKm: 35, aliases: ['berlin', '柏林'] },
  amsterdam: { lat: 52.3676, lon: 4.9041, radiusKm: 30, aliases: ['amsterdam', '阿姆斯特丹'] },
  istanbul: { lat: 41.0082, lon: 28.9784, radiusKm: 40, aliases: ['istanbul', '伊斯坦布尔', '伊斯坦堡'] },
  prague: { lat: 50.0755, lon: 14.4378, radiusKm: 25, aliases: ['prague', 'praha', '布拉格'] },
  vienna: { lat: 48.2082, lon: 16.3738, radiusKm: 30, aliases: ['vienna', 'wien', '维也纳', '維也納'] },
  // China & Greater China
  beijing: { lat: 39.9042, lon: 116.4074, radiusKm: 50, aliases: ['beijing', 'peking', '北京', '帝都'] },
  shanghai: { lat: 31.2304, lon: 121.4737, radiusKm: 45, aliases: ['shanghai', '上海', '沪'] },
  hongkong: { lat: 22.3193, lon: 114.1694, radiusKm: 35, aliases: ['hong kong', 'hongkong', 'hk', '香港', '港'] },
  guangzhou: { lat: 23.1291, lon: 113.2644, radiusKm: 40, aliases: ['guangzhou', 'canton', '广州', '廣州'] },
  shenzhen: { lat: 22.5431, lon: 114.0579, radiusKm: 35, aliases: ['shenzhen', '深圳', '深'] },
  chengdu: { lat: 30.5728, lon: 104.0668, radiusKm: 35, aliases: ['chengdu', '成都', '蓉'] },
  xian: { lat: 34.3416, lon: 108.9398, radiusKm: 35, aliases: ["xi'an", 'xian', '西安', '长安'] },
  hangzhou: { lat: 30.2741, lon: 120.1551, radiusKm: 30, aliases: ['hangzhou', '杭州'] },
  macau: { lat: 22.1987, lon: 113.5439, radiusKm: 20, aliases: ['macau', 'macao', '澳门', '澳門'] },
  // Asia-Pacific
  seoul: { lat: 37.5665, lon: 126.9780, radiusKm: 40, aliases: ['seoul', '首尔', '首爾', '汉城'] },
  bangkok: { lat: 13.7563, lon: 100.5018, radiusKm: 40, aliases: ['bangkok', '曼谷'] },
  singapore: { lat: 1.3521, lon: 103.8198, radiusKm: 30, aliases: ['singapore', '新加坡', '狮城'] },
  sydney: { lat: -33.8688, lon: 151.2093, radiusKm: 45, aliases: ['sydney', '悉尼', '雪梨'] },
  melbourne: { lat: -37.8136, lon: 144.9631, radiusKm: 40, aliases: ['melbourne', '墨尔本', '墨爾本'] },
  taipei: { lat: 25.0330, lon: 121.5654, radiusKm: 35, aliases: ['taipei', 'taiwan', '台北', '臺北', '台湾', '台灣'] },
  dubai: { lat: 25.2048, lon: 55.2708, radiusKm: 40, aliases: ['dubai', '迪拜', '杜拜', 'uae', '阿联酋'] },
  mumbai: { lat: 19.0760, lon: 72.8777, radiusKm: 40, aliases: ['mumbai', 'bombay', '孟买', '孟買'] },
  delhi: { lat: 28.7041, lon: 77.1025, radiusKm: 45, aliases: ['delhi', 'new delhi', '德里', '新德里'] },
  cairo: { lat: 30.0444, lon: 31.2357, radiusKm: 40, aliases: ['cairo', '开罗', '開羅', 'egypt', '埃及'] },
};

let japanCache: TravelPoi[] | null = null;
let tokyoCache: TravelPoi[] | null = null;
let worldCache: TravelPoi[] | null = null;
let allPoisCache: TravelPoi[] | null = null;
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

function dedupePois(items: TravelPoi[]): TravelPoi[] {
  const seen = new Set<string>();
  const out: TravelPoi[] = [];
  for (const p of items) {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function fetchPoiFile(path: string): Promise<TravelPoi[]> {
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`poi_load_failed:${path}:${res.status}`);
  const data = (await res.json()) as PoiFile;
  return (data.items || []).filter((i) => i && typeof i.name === 'string' && Number.isFinite(i.lat) && Number.isFinite(i.lon));
}

/** 预热离线库(打开计划/时间线时调用)。失败不抛——无降级为空列表。 */
export async function ensureTravelPoiLoaded(): Promise<{ japan: number; tokyo: number; world: number; total: number; error?: string }> {
  const snapshot = () => ({
    japan: japanCache?.length ?? 0,
    tokyo: tokyoCache?.length ?? 0,
    world: worldCache?.length ?? 0,
    total: allPoisCache?.length ?? 0,
  });
  if (allPoisCache) return snapshot();
  if (!loadPromise) {
    loadPromise = (async () => {
      const [japan, tokyo, world] = await Promise.all([
        fetchPoiFile('/data/travel-poi/japan-attractions.json'),
        fetchPoiFile('/data/travel-poi/tokyo-attractions.json'),
        fetchPoiFile('/data/travel-poi/world-attractions.json'),
      ]);
      japanCache = japan;
      tokyoCache = tokyo;
      worldCache = world;
      allPoisCache = dedupePois([...world, ...japan, ...tokyo]);
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  try {
    await loadPromise;
    return snapshot();
  } catch (err) {
    return { japan: 0, tokyo: 0, world: 0, total: 0, error: err instanceof Error ? err.message : 'poi_load_failed' };
  }
}

export function isTravelPoiReady(): boolean {
  return Boolean(allPoisCache);
}

export function listAllTravelPois(): TravelPoi[] {
  return allPoisCache ? [...allPoisCache] : [];
}

/** 按目的地推荐离线景点(距离近优先;东京走专用粗筛包)。 */
export function suggestPoisForDestination(destination: string, opts?: {
  limit?: number;
  type?: TravelPoiType | 'all';
  query?: string;
}): TravelPoi[] {
  const limit = opts?.limit ?? 24;
  const type = opts?.type || 'all';
  const rawQ = (opts?.query || '').trim();
  const q = rawQ.toLowerCase();
  /**
   * bug3「无下拉框选项,我们已经有本地景点数据」的根因:
   * 离线包里的景点名是英文/罗马字(「Kiyomizu-dera」),用户搜的是中文(「京都」)——
   * 名字里当然一个都不包含,于是一条都出不来,看着像「没有下拉选项」。
   * 修法:先把搜索词当**城市**认(matchCityKey 认中文/日文/罗马字别名)。认出来就按那座城市
   * 的圈子给候选,不再要求名字包含搜索词;认不出来才退回按名字包含。
   */
  const queryCity = rawQ ? matchCityKey(rawQ) : null;
  const city = queryCity || matchCityKey(destination);
  // 搜索词命中城市时,名字匹配这一条不再生效(否则「京都」还是把 Kyoto 的景点全滤掉)
  const nameQuery = queryCity ? '' : q;
  const pool: TravelPoi[] =
    city === 'tokyo' && tokyoCache?.length
      ? tokyoCache
      : (allPoisCache || worldCache || japanCache || tokyoCache || []);

  let scored = pool.map((p) => {
    let score = 0;
    if (city) {
      const c = CITY_CENTERS[city];
      const d = haversineKm(c.lat, c.lon, p.lat, p.lon);
      score = d <= c.radiusKm ? c.radiusKm - d : 1000 + d;
    } else if (nameQuery) {
      // 无目的地时按名字/global 搜索 —— 别默认 500 把全世界都筛掉
      score = 200;
    } else {
      score = 500;
    }
    if (type !== 'all' && p.type !== type) score += 5000;
    if (nameQuery) {
      const hay = `${p.name} ${p.type || ''} ${p.country || ''} ${p.summary || ''} ${p.summaryEn || ''}`.toLowerCase();
      if (!hay.includes(nameQuery)) score += 8000;
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
