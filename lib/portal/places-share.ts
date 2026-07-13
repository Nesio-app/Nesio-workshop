/**
 * 足迹分享卡数据(原创成就卡「WHERE I'VE BEEN」)—— 纯本机推导,不含实时定位。
 *
 * 分享的是**过去 · 聚合**的成就(去过 N 国 / N 洲 / 最远 / 连续天数),
 * 绝不带此刻坐标(隐私红线)。点阵世界地图按「到过的洲」高亮:visited=brand/deep 陶棕,
 * 其余=muted 灰。颜色一律走官方 token,由 resolveShareTokens 在运行时读出具体值
 *(canvas/序列化 SVG 不认 var(),必须先 getComputedStyle 取值)。
 */
import type { PlaceVisit } from './place-trail';

export type Continent = 'NA' | 'SA' | 'EU' | 'AF' | 'AS' | 'OC';

export interface PlacesShareStats {
  year: number;
  countries: number;
  continents: number;
  /** 覆盖世界的百分比(以 195 国为分母,至少 1)。 */
  worldPct: number;
  /** 最长连续到访天数。 */
  dayStreak: number;
  /** 离家最远的地方(名称 + 公里)。数据不足则 null。 */
  furthest: { name: string; km: number } | null;
  /** 到过的洲(点阵地图高亮用)。 */
  visitedContinents: Continent[];
}

// ── 国家 → 洲(常见国名,中英双份;够分类到过的国家即可,未知则不高亮但仍计入国家数)──
const COUNTRY_CONTINENT: Record<string, Continent> = {
  // 北美
  '美国': 'NA', 'United States': 'NA', 'USA': 'NA', '加拿大': 'NA', 'Canada': 'NA',
  '墨西哥': 'NA', 'Mexico': 'NA', '古巴': 'NA', 'Cuba': 'NA', '冰岛': 'EU', 'Iceland': 'EU',
  // 南美
  '巴西': 'SA', 'Brazil': 'SA', '阿根廷': 'SA', 'Argentina': 'SA', '智利': 'SA', 'Chile': 'SA',
  '秘鲁': 'SA', 'Peru': 'SA', '哥伦比亚': 'SA', 'Colombia': 'SA', '玻利维亚': 'SA', 'Bolivia': 'SA',
  // 欧洲
  '英国': 'EU', 'United Kingdom': 'EU', 'UK': 'EU', '法国': 'EU', 'France': 'EU',
  '德国': 'EU', 'Germany': 'EU', '意大利': 'EU', 'Italy': 'EU', '西班牙': 'EU', 'Spain': 'EU',
  '葡萄牙': 'EU', 'Portugal': 'EU', '荷兰': 'EU', 'Netherlands': 'EU', '瑞士': 'EU', 'Switzerland': 'EU',
  '瑞典': 'EU', 'Sweden': 'EU', '挪威': 'EU', 'Norway': 'EU', '芬兰': 'EU', 'Finland': 'EU',
  '丹麦': 'EU', 'Denmark': 'EU', '希腊': 'EU', 'Greece': 'EU', '奥地利': 'EU', 'Austria': 'EU',
  '爱尔兰': 'EU', 'Ireland': 'EU', '比利时': 'EU', 'Belgium': 'EU', '波兰': 'EU', 'Poland': 'EU',
  '捷克': 'EU', 'Czechia': 'EU', '俄罗斯': 'EU', 'Russia': 'EU',
  // 非洲
  '埃及': 'AF', 'Egypt': 'AF', '摩洛哥': 'AF', 'Morocco': 'AF', '南非': 'AF', 'South Africa': 'AF',
  '肯尼亚': 'AF', 'Kenya': 'AF', '坦桑尼亚': 'AF', 'Tanzania': 'AF', '尼日利亚': 'AF', 'Nigeria': 'AF',
  // 亚洲
  '中国': 'AS', 'China': 'AS', '日本': 'AS', 'Japan': 'AS', '韩国': 'AS', 'South Korea': 'AS', 'Korea': 'AS',
  '泰国': 'AS', 'Thailand': 'AS', '越南': 'AS', 'Vietnam': 'AS', '新加坡': 'AS', 'Singapore': 'AS',
  '马来西亚': 'AS', 'Malaysia': 'AS', '印度尼西亚': 'AS', 'Indonesia': 'AS', '印度': 'AS', 'India': 'AS',
  '菲律宾': 'AS', 'Philippines': 'AS', '阿联酋': 'AS', 'United Arab Emirates': 'AS', 'UAE': 'AS',
  '土耳其': 'AS', 'Turkey': 'AS', '以色列': 'AS', 'Israel': 'AS', '尼泊尔': 'AS', 'Nepal': 'AS',
  '柬埔寨': 'AS', 'Cambodia': 'AS', '斯里兰卡': 'AS', 'Sri Lanka': 'AS',
  // 大洋洲
  '澳大利亚': 'OC', 'Australia': 'OC', '新西兰': 'OC', 'New Zealand': 'OC', '斐济': 'OC', 'Fiji': 'OC',
};

export function countryContinent(country: string): Continent | null {
  return COUNTRY_CONTINENT[country.trim()] ?? null;
}

// ── 点阵世界地图:32×15 陆地掩码,每格标洲。用矩形跨度构造,避免手写字符串错位。──
const GRID_W = 32;
const GRID_H = 15;
type Span = [row: number, c0: number, c1: number];
const CONTINENT_SPANS: Record<Continent, Span[]> = {
  NA: [[0, 3, 7], [1, 2, 8], [2, 2, 8], [3, 3, 8], [4, 4, 8], [5, 5, 8], [6, 6, 7]],
  SA: [[7, 8, 10], [8, 8, 11], [9, 8, 11], [10, 9, 11], [11, 9, 10], [12, 9, 9]],
  EU: [[1, 15, 16], [2, 14, 17], [3, 14, 17], [4, 15, 17]],
  AF: [[5, 16, 19], [6, 16, 20], [7, 16, 20], [8, 16, 20], [9, 16, 19], [10, 16, 18], [11, 17, 17]],
  AS: [[1, 18, 27], [2, 18, 28], [3, 19, 28], [4, 19, 27], [5, 21, 26], [6, 22, 24]],
  OC: [[8, 27, 28], [9, 27, 30], [10, 27, 30], [11, 28, 29]],
};

export interface DotCell { row: number; col: number; continent: Continent }
/** 点阵地图全部陆地格(供分享卡渲染)。 */
export function worldDotCells(): DotCell[] {
  const cells: DotCell[] = [];
  (Object.keys(CONTINENT_SPANS) as Continent[]).forEach((cont) => {
    for (const [row, c0, c1] of CONTINENT_SPANS[cont]) {
      for (let col = c0; col <= c1; col++) cells.push({ row, col, continent: cont });
    }
  });
  return cells;
}
export const WORLD_GRID = { w: GRID_W, h: GRID_H };

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function localDayKey(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 最长连续到访天数(按日历相邻日连)。 */
function longestDayStreak(visits: PlaceVisit[]): number {
  const days = [...new Set(visits.map((v) => localDayKey(v.ts)))].sort();
  let max = 0, run = 0, prev = 0;
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    const time = new Date(y, m - 1, d).getTime();
    run = prev && time - prev === 86_400_000 ? run + 1 : 1;
    if (run > max) max = run;
    prev = time;
  }
  return max;
}

/** 离家最远的地方:home=打点最密的粗网格中心,furthest=离它最远的一次到访。 */
function furthestFromHome(visits: PlaceVisit[]): { name: string; km: number } | null {
  const geo = visits.filter((v) => typeof v.lat === 'number' && typeof v.lon === 'number');
  if (geo.length < 2) return null;
  // home = 出现最多的 1° 粗格
  const bins = new Map<string, { lat: number; lon: number; n: number }>();
  for (const v of geo) {
    const key = `${Math.round(v.lat!)},${Math.round(v.lon!)}`;
    const b = bins.get(key) || { lat: v.lat!, lon: v.lon!, n: 0 };
    b.n += 1;
    bins.set(key, b);
  }
  const home = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  let best: { name: string; km: number } | null = null;
  for (const v of geo) {
    const km = haversineKm(home.lat, home.lon, v.lat!, v.lon!);
    if (!best || km > best.km) best = { name: cleanLabel(v.label), km: Math.round(km / 10) * 10 };
  }
  return best && best.km >= 50 ? best : null;
}

function cleanLabel(label: string): string {
  // 取第一段(逗号/顿号前),截断过长
  const first = label.split(/[，,·]/)[0].trim();
  return first.length > 18 ? `${first.slice(0, 17)}…` : first || label.slice(0, 18);
}

/** 纯函数:从到访 + 国家名单推导成就统计(便于测试)。 */
export function computePlacesShareStats(
  visits: PlaceVisit[],
  countryNames: string[],
  now: Date = new Date(),
): PlacesShareStats {
  const countries = new Set(countryNames.map((c) => c.trim()).filter(Boolean));
  const conts = new Set<Continent>();
  for (const c of countries) { const k = countryContinent(c); if (k) conts.add(k); }

  let year = now.getFullYear();
  for (const v of visits) {
    const y = new Date(v.ts).getFullYear();
    if (Number.isFinite(y) && y < year) year = y;
  }

  return {
    year,
    countries: countries.size,
    continents: conts.size,
    worldPct: countries.size > 0 ? Math.max(1, Math.round((countries.size / 195) * 100)) : 0,
    dayStreak: longestDayStreak(visits),
    furthest: furthestFromHome(visits),
    visitedContinents: [...conts],
  };
}

// ── token 解析:从主题探针读出分享卡要用的具体色值(序列化 SVG 需要真实值而非 var())──
export interface ShareCardColors {
  accent: string;   // brand/deep 陶棕(visited 点 + 强调)
  ink: string;      // 大数字
  sub: string;      // 次级标签
  mutedDot: string; // 未到访点(灰)
  line: string;     // 分割线
  cardBg: string;   // 卡底
  onAccent: string; // 陶棕上的文字(白)
}

const SHARE_TOKEN_PROPS: Array<[keyof ShareCardColors, string, string]> = [
  ['accent', '--portal-blue-deep', '#b06f68'],
  ['ink', '--portal-ink', '#1e2a3a'],
  ['sub', '--portal-muted', '#5a6d82'],
  ['line', '--portal-line', 'rgba(120,120,120,0.18)'],
  ['cardBg', '--share-card-surface', '#faf7f6'],
];

/**
 * 浏览器内:读出目标主题下分享卡要用的 token 具体值(序列化 SVG 需要真实值而非 var())。
 * 夜间 token 挂在 html[data-portal-theme="night"] 上,离屏 div 探针读不到 —— 故短暂把
 * html 的主题属性切到目标值,同步 getComputedStyle(强制回流但不触发绘制,无闪烁),读完还原。
 * 同时保留当前 data-palette(皮肤),这样灰粉皮肤下强调色自然是陶棕。SSR/无 DOM 返回兜底。
 */
export function resolveShareTokens(theme: 'day' | 'night'): ShareCardColors {
  const fallback: ShareCardColors = {
    accent: '#b06f68', ink: theme === 'night' ? '#efe8e7' : '#3a3c43',
    sub: theme === 'night' ? 'rgba(239,232,231,0.56)' : '#6b7280',
    mutedDot: theme === 'night' ? 'rgba(239,232,231,0.56)' : '#6b7280',
    line: theme === 'night' ? 'rgba(212,154,148,0.15)' : 'rgba(120,125,135,0.14)',
    cardBg: theme === 'night' ? '#1a1a1e' : '#faf7f6', onAccent: '#ffffff',
  };
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const html = document.documentElement;
  const prevTheme = html.getAttribute('data-portal-theme');
  let probe: HTMLDivElement | null = null;
  try {
    html.setAttribute('data-portal-theme', theme);
    probe = document.createElement('div');
    probe.className = 'portal-root';
    probe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;pointer-events:none';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const read = (prop: string, fb: string) => (cs.getPropertyValue(prop).trim() || fb);
    const out: ShareCardColors = { ...fallback };
    for (const [key, prop, fb] of SHARE_TOKEN_PROPS) out[key] = read(prop, fb);
    out.mutedDot = out.sub; // 未到访点 = 次级色的淡描(渲染时再压低不透明度)
    return out;
  } catch {
    return fallback;
  } finally {
    if (prevTheme === null) html.removeAttribute('data-portal-theme');
    else html.setAttribute('data-portal-theme', prevTheme);
    if (probe) document.body.removeChild(probe);
  }
}
