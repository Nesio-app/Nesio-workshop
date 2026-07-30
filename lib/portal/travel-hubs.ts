/**
 * travel-hubs — 离线交通枢纽库(bug3:「需要离线机场等交通枢纽数据包」)。
 *
 * 数据来源:public/data/travel-hubs/hubs.json —— 机场(IATA 码)+ 主要高铁/城际车站,
 * 随包发布,无网可用。用途:行程里加航班时,「出发 / 到达」两个框给下拉候选并自动填码。
 *
 * 与 travel-poi 同一套约定:预热失败不抛,退化成空列表(输入框仍可手填,不许因为
 * 数据包没到就变成死输入)。
 */

export type HubKind = 'airport' | 'rail';

export interface TravelHub {
  /** IATA 三字码;车站用自造的短码(唯一即可) */
  code: string;
  name: string;
  city: string;
  /** 中文城市名(界面中文时优先显示) */
  cityZh?: string;
  country: string;
  lat: number;
  lon: number;
  kind: HubKind;
}

interface HubFile { note?: string; count?: number; items: TravelHub[] }

let cache: TravelHub[] | null = null;
let loadPromise: Promise<void> | null = null;
/** 取当前缓存(总是数组)。用函数读,免得被同函数里的 `if (cache) return` 窄成 never。 */
function hubs(): TravelHub[] { return cache ?? []; }

/** 预热(打开行程时调用)。返回条数;失败返回 0 + error。 */
export async function ensureTravelHubsLoaded(): Promise<{ count: number; error?: string }> {
  if (cache) return { count: cache.length };
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch('/data/travel-hubs/hubs.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error(`hubs_load_failed:${res.status}`);
      const data = (await res.json()) as HubFile;
      cache = (data.items || []).filter((h) => h && typeof h.code === 'string' && Number.isFinite(h.lat) && Number.isFinite(h.lon));
    })().catch((err) => { loadPromise = null; throw err; });
  }
  try {
    await loadPromise;
    // 走函数取:直接读 cache 会被上面 `if (cache) return` 的控制流窄成 never。
    return { count: hubs().length };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'hubs_load_failed' };
  }
}

export function isTravelHubsReady(): boolean { return Boolean(cache); }

/** 一行显示文本:「PVG · 上海浦东国际机场」→ 交给 UI 拼,这里只给零件。 */
export function hubLabel(h: TravelHub, zh: boolean): string {
  const city = zh ? (h.cityZh || h.city) : h.city;
  return `${h.code} · ${city}${h.kind === 'rail' ? (zh ? ' 车站' : ' station') : ''}`;
}

/**
 * 搜索枢纽:三字码前缀 > 城市名(中/英)前缀 > 名字包含。
 * 空串返回空(不要在没输入时铺 160 条候选)。
 */
export function searchTravelHubs(query: string, limit = 8): TravelHub[] {
  const q = query.trim().toLowerCase();
  const all = hubs();
  if (!q || all.length === 0) return [];
  const scored: Array<{ h: TravelHub; s: number }> = [];
  for (const h of all) {
    const code = h.code.toLowerCase();
    const city = h.city.toLowerCase();
    const cityZh = (h.cityZh || '').toLowerCase();
    const name = h.name.toLowerCase();
    let s = -1;
    if (code === q) s = 100;
    else if (code.startsWith(q)) s = 90;
    else if (cityZh && cityZh.startsWith(q)) s = 80;
    else if (city.startsWith(q)) s = 78;
    else if (cityZh && cityZh.includes(q)) s = 60;
    else if (city.includes(q)) s = 58;
    else if (name.includes(q)) s = 40;
    if (s < 0) continue;
    // 同分时机场排前面(航班场景机场更常用)
    scored.push({ h, s: s + (h.kind === 'airport' ? 1 : 0) });
  }
  scored.sort((a, b) => b.s - a.s || a.h.code.localeCompare(b.h.code));
  return scored.slice(0, limit).map((x) => x.h);
}

/** 精确按码取一个枢纽(把「PVG」补成城市/坐标时用)。 */
export function hubByCode(code: string): TravelHub | null {
  const c = code.trim().toUpperCase();
  const all = hubs();
  if (!c || all.length === 0) return null;
  return all.find((h) => h.code.toUpperCase() === c) ?? null;
}
