/**
 * travel-hotels — 离线酒店库(bug3:「最好增加离线酒店…数据包」)。
 * 数据:public/data/travel-hotels/hotels.json。加酒店时搜索候选并回填坐标。
 */

export interface TravelHotel {
  name: string;
  nameZh?: string;
  city: string;
  cityZh?: string;
  country: string;
  lat: number;
  lon: number;
  chain?: string;
}

interface HotelFile { note?: string; count?: number; items: TravelHotel[] }

let cache: TravelHotel[] | null = null;
let loadPromise: Promise<void> | null = null;

function hotels(): TravelHotel[] { return cache ?? []; }

export async function ensureTravelHotelsLoaded(): Promise<{ count: number; error?: string }> {
  if (cache) return { count: cache.length };
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch('/data/travel-hotels/hotels.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error(`hotels_load_failed:${res.status}`);
      const data = (await res.json()) as HotelFile;
      cache = (data.items || []).filter((h) => h && typeof h.name === 'string' && Number.isFinite(h.lat) && Number.isFinite(h.lon));
    })().catch((err) => { loadPromise = null; throw err; });
  }
  try {
    await loadPromise;
    return { count: hotels().length };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'hotels_load_failed' };
  }
}

export function isTravelHotelsReady(): boolean { return Boolean(cache); }

export function hotelLabel(h: TravelHotel, zh: boolean): string {
  const name = zh && h.nameZh ? h.nameZh : h.name;
  const city = zh ? (h.cityZh || h.city) : h.city;
  return `${name} · ${city}`;
}

/** 空串不铺列表;按中英名/城市/连锁包含匹配。 */
export function searchTravelHotels(query: string, limit = 8): TravelHotel[] {
  const q = query.trim().toLowerCase();
  const all = hotels();
  if (!q || all.length === 0) return [];
  const scored: Array<{ h: TravelHotel; s: number }> = [];
  for (const h of all) {
    const name = h.name.toLowerCase();
    const nameZh = (h.nameZh || '').toLowerCase();
    const city = h.city.toLowerCase();
    const cityZh = (h.cityZh || '').toLowerCase();
    const chain = (h.chain || '').toLowerCase();
    let s = -1;
    if (nameZh && nameZh.startsWith(q)) s = 95;
    else if (name.startsWith(q)) s = 90;
    else if (cityZh && cityZh.startsWith(q)) s = 80;
    else if (city.startsWith(q)) s = 78;
    else if (nameZh && nameZh.includes(q)) s = 70;
    else if (name.includes(q)) s = 65;
    else if (cityZh && cityZh.includes(q)) s = 55;
    else if (city.includes(q)) s = 50;
    else if (chain && chain.includes(q)) s = 40;
    if (s < 0) continue;
    scored.push({ h, s });
  }
  scored.sort((a, b) => b.s - a.s || a.h.name.localeCompare(b.h.name));
  return scored.slice(0, limit).map((x) => x.h);
}
