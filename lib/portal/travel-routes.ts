/**
 * travel-routes — 离线常见航线包(bug3:「飞机航线数据包」)。
 * 数据:public/data/travel-routes/routes.json。填出发/到达时提示对向城市与航司。
 */

export interface TravelRoute {
  from: string;
  to: string;
  airlines?: string[];
}

interface RouteFile { note?: string; count?: number; items: TravelRoute[] }

let cache: TravelRoute[] | null = null;
let loadPromise: Promise<void> | null = null;

function routes(): TravelRoute[] { return cache ?? []; }

export async function ensureTravelRoutesLoaded(): Promise<{ count: number; error?: string }> {
  if (cache) return { count: cache.length };
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch('/data/travel-routes/routes.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error(`routes_load_failed:${res.status}`);
      const data = (await res.json()) as RouteFile;
      cache = (data.items || []).filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string');
    })().catch((err) => { loadPromise = null; throw err; });
  }
  try {
    await loadPromise;
    return { count: routes().length };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'routes_load_failed' };
  }
}

export function isTravelRoutesReady(): boolean { return Boolean(cache); }

/** 已知出发码 → 常见到达候选(支持 2–3 字 IATA 前缀)。 */
export function suggestRouteDestinations(fromCode: string, limit = 8): TravelRoute[] {
  const from = fromCode.trim().toUpperCase();
  if (!from || from.length < 2) return [];
  if (from.length === 3) return routes().filter((r) => r.from === from).slice(0, limit);
  return routes().filter((r) => r.from.startsWith(from)).slice(0, limit);
}

/** 已知到达码 → 常见出发候选(支持 2–3 字 IATA 前缀)。 */
export function suggestRouteOrigins(toCode: string, limit = 8): TravelRoute[] {
  const to = toCode.trim().toUpperCase();
  if (!to || to.length < 2) return [];
  if (to.length === 3) return routes().filter((r) => r.to === to).slice(0, limit);
  return routes().filter((r) => r.to.startsWith(to)).slice(0, limit);
}

export function findRoute(fromCode: string, toCode: string): TravelRoute | null {
  const from = fromCode.trim().toUpperCase();
  const to = toCode.trim().toUpperCase();
  if (!from || !to) return null;
  return routes().find((r) => r.from === from && r.to === to) ?? null;
}
