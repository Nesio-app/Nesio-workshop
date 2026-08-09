import { reportStorageDropped } from '@/lib/portal/storage-health';
import { haversineKm, haversineMeters, isGenericPlaceLabel, placeKey as geoPlaceKey } from '@/lib/portal/geo';
import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { wallDateKey, wallHour, clampEndToWallDay } from '@/lib/portal/place-time.mjs';
import { canonicalCountryKey } from '@/lib/portal/country-normalize';

export { haversineKm } from '@/lib/portal/geo';
export {
  type NamedPlace,
  getNamedPlaces,
  saveNamedPlaces,
  upsertNamedPlace,
  deleteNamedPlace,
  matchNearestPlace,
  formatLocation,
  displayStoredLocation,
} from './named-places';

export interface PlaceVisit {
  /** ISO 时间(到访开始) */
  ts: string;
  /** 结束时间(导入的历史段才有) */
  end?: string;
  label: string;
  lat?: number;
  lon?: number;
  source: 'live' | 'import';
  /** 用户显式「标记当前位置」—— 有 import 的那天也不丢弃 */
  manual?: boolean;
}

/** 有 Google 导入的那天,仍保留最近这么久的 live 点(粗粒度城市 ping 更早的才让位)。 */
const IMPORT_DAY_LIVE_KEEP_MS = 6 * 3_600_000;

const KEY = 'nesio-place-trail-v1';
// 批次 57 迁 IndexedDB 后不再受 localStorage 配额约束;800 会把整段
// Google 时间轴历史静默砍掉(只剩最近 800 条),是「导入了却看不到历史」的根因。
const CAP = 20000;
export const PLACE_TRAIL_UPDATED_EVENT = 'nesio-place-trail-updated';

// 批次 57:地点轨迹(自动采集、会无限长)挪 IndexedDB —— 腾 localStorage 配额;
// 批次 2026-08:地理编码/分类/别名/改名也迁 IDB(durable,进备份与云同步),不再留 localStorage。
const store = createBlobStore<PlaceVisit[]>({
  key: KEY, updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

function loadJsonBlob<T extends Record<string, unknown>>(blob: { load(): T | null }): T {
  if (typeof window === 'undefined') return {} as T;
  return blob.load() ?? ({} as T);
}

function saveJsonBlob<T>(blob: { save(v: T): void }, value: T): void {
  if (typeof window === 'undefined') return;
  blob.save(value);
}

// 批次 75(用户三次实锤 家/Ethans Glen Court 分家):历史数据自愈 ——
// 用户命名的地点(改名目标/手动分类为 home 的)坐标 150m 内的**街道后缀**
// 原名(Court/St/Ave/Rd…,geocode 街名不是用户起的)一次性归并过去。
// 只认"街名 → 人名"方向,绝不把两家真 POI 硬并。
const HEAL_FLAG = 'nesio-place-heal-v1';
const STREET_SUFFIX_RE = /\b(court|ct|street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|blvd|boulevard|circle|cir|place|pl|trail|trl|terrace|ter|parkway|pkwy)\b\.?,?/i;
export function healSplitPlacesOnce(): void {
  if (typeof window === 'undefined') return;
  try { if (localStorage.getItem(HEAL_FLAG)) return; localStorage.setItem(HEAL_FLAG, '1'); } catch { return; }
  const trail = loadPlaceTrail();
  const renames = loadPlaceRenames();
  const cats = loadPlaceCategories();
  // 用户命名集合:改名目标 + 手动标为 home 的标签
  const named = new Set<string>([...Object.values(renames), ...Object.keys(cats).filter((k) => cats[k] === 'home')]);
  if (!named.size) return;
  const coordOf = new Map<string, { lat: number; lon: number }>();
  for (const v of trail) {
    if (v.lat != null && v.lon != null && !coordOf.has(v.label)) coordOf.set(v.label, { lat: v.lat, lon: v.lon });
  }
  let merges = 0;
  for (const [label, c] of coordOf) {
    if (merges >= 20) break;
    if (named.has(label) || !STREET_SUFFIX_RE.test(label)) continue;
    for (const target of named) {
      const tc = coordOf.get(target);
      if (!tc) continue;
      if (haversineKm(c.lat, c.lon, tc.lat, tc.lon) <= 0.15) {
        renamePlaceLabel(label, target);
        merges += 1;
        break;
      }
    }
  }
}

let coordAliasNormalized = false;
/** 批次 62:存量归一 —— 批次 60 只给坐标条目做了显示别名,raw 仍是坐标,
 *  聚合/时间线按 raw 分家(用户实测两行同名不合并)。开机把「坐标 raw + 有别名」
 *  的条目就地改写成别名真名并清掉别名,连续同名停留自此天然合并。 */
function normalizeCoordAliasesOnce(): void {
  if (coordAliasNormalized || typeof window === 'undefined') return;
  coordAliasNormalized = true;
  try {
    const aliases = loadPlaceAliases();
    const coordKeys = Object.keys(aliases).filter((k) => /^-?\d+\.\d+,-?\d+\.\d+$/.test(k));
    for (const k of coordKeys) renamePlaceLabel(k, aliases[k]);
  } catch { /* 归一失败不拦读取 */ }
}

export function loadPlaceTrail(): PlaceVisit[] {
  normalizeCoordAliasesOnce();
  try { healSplitPlacesOnce(); } catch { /* 愈合失败不拦读取 */ }
  const raw = store.load();
  return Array.isArray(raw) ? raw : [];
}

function save(trail: PlaceVisit[]): void {
  // 按时间倒序,封顶
  const sorted = [...trail].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, CAP);
  store.save(sorted);
}

/** 实时记录:同一地点 2 小时内不重复记(定位轮询会反复命中同一地方)。 */
export function recordLiveVisit(
  rawLabel: string,
  lat?: number,
  lon?: number,
  opts?: { manual?: boolean },
): void {
  const label = canonicalPlaceLabel(rawLabel);
  if (!label) return;
  const trail = loadPlaceTrail();
  const now = Date.now();
  // 手动标记不受 2h 同地去重挡住(用户要当场验证定位);自动 ping 仍去重。
  if (!opts?.manual) {
    const recentSame = trail.find(
      (v) => v.label === label && now - new Date(v.ts).getTime() < 2 * 3_600_000,
    );
    if (recentSame) return;
  }
  save([{
    ts: new Date().toISOString(),
    label,
    lat,
    lon,
    source: 'live',
    ...(opts?.manual ? { manual: true } : {}),
  }, ...trail]);
}

/**
 * 记录一次「发生在特定时间」的到访 —— 连接器给的历史事件(如 Tesla 充电会话)。
 * 与 recordLiveVisit 的区别:ts 用事件真实时间,不是「现在」。按 label|ts 去重,
 * 反复同步同一会话不会重复堆。source 记 'live'(不触发 import 那天让位粗粒度打点的逻辑)。
 */
export function recordVisitAt(rawLabel: string, tsISO: string, lat?: number, lon?: number): void {
  const label = canonicalPlaceLabel(rawLabel);
  if (!label || !tsISO) return;
  const ts = new Date(tsISO).toISOString();
  if (Number.isNaN(new Date(ts).getTime())) return;
  const trail = loadPlaceTrail();
  if (trail.some((v) => v.label === label && v.ts === ts)) return;
  save([{ ts, label, lat, lon, source: 'live' }, ...trail]);
}

/** 批量并入导入的历史段(按 ts+label 去重)。返回新增条数。 */
export function mergeImportedVisits(visits: PlaceVisit[]): number {
  const trail = loadPlaceTrail();
  const seen = new Set(trail.map((v) => `${v.ts}|${v.label}`));
  const fresh = visits.filter((v) => v.label && v.ts && !seen.has(`${v.ts}|${v.label}`));
  if (fresh.length) save([...fresh, ...trail]);
  return fresh.length;
}

// ── Google 地图时间轴导出解析 ────────────────────────────────────────────────
// 支持两种格式:
//  A. 新版手机端导出(2024+):{ semanticSegments: [{ startTime, endTime,
//     visit: { topCandidate: { placeLocation: 'geo:lat,lng', semanticType, label? } } }] }
//  B. 旧版 Takeout Semantic Location History:{ timelineObjects: [{ placeVisit:
//     { location: { name, latitudeE7, longitudeE7 }, duration: { startTimestamp, endTimestamp } } }] }

export function parseGoogleTimeline(json: unknown): PlaceVisit[] {
  const out: PlaceVisit[] = [];
  const root = json as Record<string, unknown>;

  // 段列表可能在:semanticSegments / timelineObjects / 顶层就是数组 /
  // 手机新版导出 { semanticSegments: [...] } 或直接 [ {...} ](批次 25 兼容)
  const segments: Array<Record<string, unknown>> = Array.isArray(json)
    ? (json as Array<Record<string, unknown>>)
    : ([
        ...(Array.isArray(root.semanticSegments) ? root.semanticSegments : []),
        ...(Array.isArray(root.timelineObjects) ? root.timelineObjects : []),
        ...(Array.isArray(root.timelineEdits) ? root.timelineEdits : []),
      ] as Array<Record<string, unknown>>);

  const parseGeo = (s: unknown): { lat?: number; lon?: number } => {
    const m = /(-?\d+\.\d+)°?,\s*(-?\d+\.\d+)°?/.exec(String(s ?? '')) || /geo:(-?[\d.]+),(-?[\d.]+)/.exec(String(s ?? ''));
    return m ? { lat: Number(m[1]), lon: Number(m[2]) } : {};
  };

  for (const seg of segments) {
    // 三种到访结构:visit.topCandidate(新)/ placeVisit.location(旧 Takeout)/
    // visit.place(部分导出)
    const startTime = String(seg.startTime ?? (seg.duration as Record<string, unknown>)?.startTimestamp ?? '');
    const endTime = String(seg.endTime ?? (seg.duration as Record<string, unknown>)?.endTimestamp ?? '') || undefined;

    // A. 新版 visit.topCandidate
    const visit = seg.visit as { topCandidate?: { placeLocation?: unknown; semanticType?: string; label?: string } } | undefined;
    if (visit?.topCandidate) {
      const tc = visit.topCandidate;
      const geo = parseGeo(typeof tc.placeLocation === 'string' ? tc.placeLocation : (tc.placeLocation as Record<string, unknown>)?.latLng);
      const label = tc.label || tc.semanticType || (geo.lat != null ? `${geo.lat.toFixed(4)},${geo.lon?.toFixed(4)}` : '');
      if (label && startTime) { out.push({ ts: startTime, end: endTime, label: humanizeSemanticType(label), lat: geo.lat, lon: geo.lon, source: 'import' }); continue; }
    }

    // B. 旧 Takeout placeVisit.location
    const pv = seg.placeVisit as { location?: { name?: string; address?: string; latitudeE7?: number; longitudeE7?: number }; duration?: { startTimestamp?: string; endTimestamp?: string } } | undefined;
    if (pv?.location) {
      const loc = pv.location;
      const ts = pv.duration?.startTimestamp || startTime;
      const label = loc.name || loc.address || (loc.latitudeE7 != null ? `${(loc.latitudeE7 / 1e7).toFixed(4)},${((loc.longitudeE7 ?? 0) / 1e7).toFixed(4)}` : '');
      if (label && ts) { out.push({ ts, end: pv.duration?.endTimestamp || endTime, label, lat: loc.latitudeE7 != null ? loc.latitudeE7 / 1e7 : undefined, lon: loc.longitudeE7 != null ? loc.longitudeE7 / 1e7 : undefined, source: 'import' }); continue; }
    }

    // C. visit.place / 顶层 place 字段兜底
    const place = (seg.place ?? (seg.visit as Record<string, unknown>)?.place) as { name?: string; location?: unknown } | undefined;
    if (place?.name && startTime) {
      const geo = parseGeo(place.location);
      out.push({ ts: startTime, end: endTime, label: place.name, lat: geo.lat, lon: geo.lon, source: 'import' });
    }
  }

  return out;
}

// ── 批次 27:Google 时间线式聚合 ─────────────────────────────────────────────
// 原始足迹是一条条打点(同一地方反复命中 Home/Unknown),不好看。
// 这里把连续同地点的点合并成「访问段」,算出停留时长,再按天分组,
// 供 Google 时间线样式的 UI 消费。

export type PlaceCategory = 'home' | 'work' | 'grocery' | 'shopping' | 'food' | 'cafe' | 'fitness' | 'park' | 'culture' | 'education' | 'entertainment' | 'health' | 'lodging' | 'transit' | 'unknown' | 'place';

/** 从地点名推断类别(决定图标/配色)。中英文关键词都认。
 *  分类尽量贴"地点本来的类":沃尔玛是超市、星巴克是咖啡、公园是公园,
 *  不再一股脑归"购物/餐饮/运动"。顺序敏感:细类在前(超市先于购物,咖啡先于餐饮,公园先于运动)。 */
export function categoryOf(label: string): PlaceCategory {
  const s = (label || '').toLowerCase();
  if (!s || /unknown|未知/.test(s)) return 'unknown';
  if (/home|家|住宅/.test(s)) return 'home';
  if (/work|office|公司|办公/.test(s)) return 'work';
  if (/walmart|costco|kroger|\baldi\b|harris teeter|wegmans|trader joe|whole foods|\blidl\b|publix|food lion|supermarket|grocer|超市|菜市场|生鲜|便利店|7-eleven/.test(s)) return 'grocery';
  if (/cafe|caf\u00e9|coffee|starbucks|dunkin|咖啡|奶茶|boba|\btea\b|茶饮/.test(s)) return 'cafe';
  if (/\bpark\b|公园|\btrail\b|greenway|botanical|植物园|湖畔|绿道/.test(s)) return 'park';
  if (/school|university|college|campus|kindergarten|学校|大学|中学|小学|幼儿园/.test(s)) return 'education';
  // 短英文词一律加前后 \b 边界(否则 "Las Vegas" 含 gas、"Kmart"/"Stuttgart" 含 art 会误命中)。
  if (/gym|fitness|健身|运动|yoga|瑜伽|sport|stadium|(?:tennis|basketball|badminton|pickleball|volleyball)[ -]?court|球场/.test(s)) return 'fitness';
  if (/restaurant|mcdonald|餐|饭|\bfood\b|dining|bakery|\bbar\b|grill|pizza|kitchen|饮/.test(s)) return 'food';
  if (/shop|mall|store|market|商场|购物|target|michaels|ulta|beauty|ikea|outlet|amazon/.test(s)) return 'shopping';
  if (/museum|library|图书馆|博物馆|gallery|theat(er|re)|剧院|cinema|movie|电影|\bart\b|church|temple|寺|教堂/.test(s)) return 'culture';
  if (/hotel|\binn\b|motel|resort|airbnb|酒店|旅馆|民宿/.test(s)) return 'lodging';
  if (/hospital|clinic|医院|诊所|pharmacy|药|dentist|doctor|urgent care/.test(s)) return 'health';
  if (/airport|station|机场|车站|transit|地铁|subway|terminal|\bgas\b|加油/.test(s)) return 'transit';
  if (/club|entertainment|游乐|amusement|zoo|aquarium|bowling|arcade|casino/.test(s)) return 'entertainment';
  return 'place';
}

export const PLACE_CATEGORY_META: Record<PlaceCategory, { zh: string; en: string; sym: string }> = {
  grocery: { zh: '超市', en: 'Grocery', sym: '🛒' },
  cafe: { zh: '咖啡', en: 'Café', sym: '☕' },
  park: { zh: '公园', en: 'Park', sym: '🌳' },
  education: { zh: '学校', en: 'School', sym: '🎓' },
  shopping: { zh: '购物', en: 'Shopping', sym: '🛍' },
  food: { zh: '餐饮', en: 'Food & drink', sym: '🍽' },
  fitness: { zh: '运动', en: 'Sports', sym: '🏃' },
  culture: { zh: '文化', en: 'Culture', sym: '🏛' },
  entertainment: { zh: '娱乐', en: 'Entertainment', sym: '🎡' },
  health: { zh: '医疗', en: 'Health', sym: '🏥' },
  lodging: { zh: '住宿', en: 'Lodging', sym: '🏨' },
  transit: { zh: '交通', en: 'Transit', sym: '✈' },
  work: { zh: '工作', en: 'Work', sym: '💼' },
  home: { zh: '家', en: 'Home', sym: '🏠' },
  place: { zh: '其他地点', en: 'Other places', sym: '📍' },
  unknown: { zh: '未命名', en: 'Unnamed', sym: '📍' },
};

export interface CategoryGroup { category: PlaceCategory; count: number; visits: number; places: PlaceCluster[] }

// 批次 40:反向地理编码结果 —— label → { name, city, country }。供 World tab(国家/城市)。
const PLACE_GEO_KEY = 'nesio-place-geo-v1';
export interface PlaceGeo { name?: string; city?: string; country?: string; resolved?: boolean; kind?: PlaceCategory }
const geoStore = createBlobStore<Record<string, PlaceGeo>>({
  key: PLACE_GEO_KEY,
  updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});
export function loadPlaceGeo(): Record<string, PlaceGeo> {
  return loadJsonBlob(geoStore);
}
export function setPlaceGeo(rawLabel: string, geo: PlaceGeo): void {
  const all = loadPlaceGeo();
  all[rawLabel] = { ...all[rawLabel], ...geo };
  saveJsonBlob(geoStore, all);
}

// 批次 40:手动类别覆盖 —— 自动识别不了(未命名)时,用户自己挑类别,记住。
const PLACE_CAT_KEY = 'nesio-place-cat-v1';
const catStore = createBlobStore<Record<string, PlaceCategory>>({
  key: PLACE_CAT_KEY,
  updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});
export function loadPlaceCategories(): Record<string, PlaceCategory> {
  return loadJsonBlob(catStore);
}
export function setPlaceCategory(raw: string, cat: PlaceCategory | ''): void {
  const all = loadPlaceCategories();
  if (cat) all[raw] = cat; else delete all[raw];
  saveJsonBlob(catStore, all);
}

/** 地点类别:手动指定 > geocode 拿到的地点本来的类(沃尔玛=超市)> 名字推断(未命名 → unknown)。 */
export function categoryOfPlace(rawLabel: string, generic?: boolean, overrides = loadPlaceCategories(), geo = loadPlaceGeo()): PlaceCategory {
  if (overrides[rawLabel]) return overrides[rawLabel];
  const kind = geo[rawLabel]?.kind;
  if (kind) return kind;
  return generic ? 'unknown' : categoryOf(displayLabel(rawLabel));
}

/** 按类别归组所有去过的地点(Google Timeline 的 Places 分类视图)。 */
export function placesByCategory(visits: PlaceVisit[]): CategoryGroup[] {
  const clusters = clusterPlaces(visits, 99999);
  const overrides = loadPlaceCategories();
  const byCat = new Map<PlaceCategory, PlaceCluster[]>();
  for (const c of clusters) {
    const cat = categoryOfPlace(c.label, c.generic, overrides);
    const list = byCat.get(cat) || [];
    list.push(c);
    byCat.set(cat, list);
  }
  const out: CategoryGroup[] = [];
  for (const [category, places] of byCat) {
    places.sort((a, b) => b.visits - a.visits);
    out.push({ category, count: places.length, visits: places.reduce((s, p) => s + p.visits, 0), places });
  }
  // 有意义的类别在前,未命名/其他垫底;同权按地点数
  const rank = (c: PlaceCategory) => (c === 'unknown' ? 2 : c === 'place' ? 1 : 0);
  return out.sort((a, b) => rank(a.category) - rank(b.category) || b.count - a.count);
}

// 批次 40:World tab —— 按国家聚合(需先跑 geocode 拿到 country/city)。国家 → 城市子分类。
// countryKey = 归一化 canonical key(ISO2/降级串),按它分组去重 —— 反查回来的
// 「美国/United States/US」是同一个国家,不再各占一行(用户实锤:国别识别错误)。
// country = 首见原串,仅作显示回退;渲染优先用 countryDisplayName(countryKey, locale)。
export interface CountryGroup { country: string; countryKey: string; cities: Array<{ city: string; count: number }>; placeCount: number; visits: number }
export function worldByCountry(visits: PlaceVisit[]): CountryGroup[] {
  const clusters = clusterPlaces(visits, 99999);
  const geo = loadPlaceGeo();
  const byCountry = new Map<string, { country: string; cities: Map<string, number>; placeCount: number; visits: number }>();
  for (const c of clusters) {
    const g = geo[c.label];
    if (!g?.country) continue;
    const key = canonicalCountryKey(g.country);
    if (!key) continue;
    const b = byCountry.get(key) || { country: g.country, cities: new Map<string, number>(), placeCount: 0, visits: 0 };
    b.placeCount += 1;
    b.visits += c.visits;
    if (g.city) b.cities.set(g.city, (b.cities.get(g.city) || 0) + 1);
    byCountry.set(key, b);
  }
  return [...byCountry.entries()]
    .map(([countryKey, b]) => ({
      country: b.country,
      countryKey,
      placeCount: b.placeCount,
      visits: b.visits,
      cities: [...b.cities.entries()].map(([city, count]) => ({ city, count })).sort((x, y) => y.count - x.count),
    }))
    .sort((a, b) => b.placeCount - a.placeCount);
}

// ── 批次 30:地点别名(手动纠正 Unknown/机器名 → 记住,以后都用对的名字)──────
const PLACE_ALIAS_KEY = 'nesio-place-alias-v1';
const aliasStore = createBlobStore<Record<string, string>>({
  key: PLACE_ALIAS_KEY,
  updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadPlaceAliases(): Record<string, string> {
  return loadJsonBlob(aliasStore);
}

/** 原始名 → 显示名(用户纠正过就用纠正后的)。 */
export function displayLabel(raw: string): string {
  const a = loadPlaceAliases()[raw];
  return a && a.trim() ? a : raw;
}

// ── 批次 69:改名的持久记忆 —— 此前 renamePlaceLabel 只改历史本体,改完之后
// **新**打点带着原始 geocode 名回来又分了家(用户实锤:家 与 Ethans Glen Court
// 两行并存)。这里把 old→new 永久记住,recordLiveVisit/recordVisitAt 写入前先归一。
const PLACE_RENAME_KEY = 'nesio-place-renames-v1';
const renameStore = createBlobStore<Record<string, string>>({
  key: PLACE_RENAME_KEY,
  updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});
function loadPlaceRenames(): Record<string, string> {
  return loadJsonBlob(renameStore);
}
function rememberRename(oldLabel: string, newLabel: string): void {
  const map = loadPlaceRenames();
  map[oldLabel] = newLabel;
  const base = oldLabel.split(',')[0].trim();
  if (base && base !== oldLabel) map[base] = newLabel;
  for (const k of Object.keys(map)) if (map[k] === oldLabel) map[k] = newLabel;
  saveJsonBlob(renameStore, map);
}
/** 写入前归一:改过名的地址(含「, 城市, 国家」后缀变体)一律用真名落库。 */
export function canonicalPlaceLabel(label: string): string {
  const map = loadPlaceRenames();
  if (map[label]) return map[label];
  const base = label.split(',')[0].trim();
  if (base && base !== label && map[base]) return map[base];
  return label;
}

/** 批次 61:把 raw label 就地改写成真名 —— 与别名不同,这里改的是存储本体,
 *  常去地点聚合/时间线合并/次数与停留统计全部天然归一(坐标名→真名认亲用)。 */
export function renamePlaceLabel(oldLabel: string, newLabel: string): void {
  if (typeof window === 'undefined' || !oldLabel || !newLabel || oldLabel === newLabel) return;
  rememberRename(oldLabel, newLabel);
  const trail = loadPlaceTrail();
  const oldBase = oldLabel.split(',')[0].trim();
  let touched = false;
  const next = trail.map((v) => {
    // 后缀变体(「Ethans Glen Court, Cary, United States」)也一并认亲改写
    const vBase = v.label.split(',')[0].trim();
    if (v.label !== oldLabel && vBase !== oldLabel && vBase !== oldBase) return v;
    touched = true;
    return { ...v, label: newLabel };
  });
  if (touched) save(next);
  // 旧别名指向该 raw 的一并清掉(本体已是真名)
  const aliases = loadPlaceAliases();
  if (aliases[oldLabel]) setPlaceAlias(oldLabel, '');
  // 批次 63:全链归一 —— 城市/国家(World tab 数据源)与手动分类跟着新名走,
  // 否则改名后世界页/类别统计瞬间"没数据"(用户实测)。
  try {
    const geo = loadPlaceGeo();
    if (geo[oldLabel]) {
      const merged = { ...geo[oldLabel], ...(geo[newLabel] || {}), name: newLabel };
      const all = { ...geo, [newLabel]: merged };
      delete all[oldLabel];
      saveJsonBlob(geoStore, all);
    }
    const cats = loadPlaceCategories();
    if (cats[oldLabel] && !cats[newLabel]) setPlaceCategory(newLabel, cats[oldLabel]);
  } catch { /* 迁移失败不拦改名 */ }
  // 记忆节点上的位置戳反向同步(记忆页与足迹用同一套地址库,用户定案)
  void import('@/lib/portal/life-graph').then(({ getLifeGraph, updateLifeNode }) => {
    for (const n of getLifeGraph()) {
      if (n.attributes?.capturedPlace === oldLabel) {
        updateLifeNode(n.id, { attributes: { ...n.attributes, capturedPlace: newLabel } });
      }
    }
  }).catch(() => {});
}

export function setPlaceAlias(raw: string, name: string): void {
  if (typeof window === 'undefined') return;
  const map = loadPlaceAliases();
  const trimmed = name.trim();
  if (trimmed && trimmed !== raw) map[raw] = trimmed; else delete map[raw];
  saveJsonBlob(aliasStore, map);
}

export interface TimelineSegment {
  label: string;
  category: PlaceCategory;
  start: string;
  end: string;
  durationMin: number;
  source: 'live' | 'import';
  lat?: number;
  lon?: number;
}

export interface TimelineDay {
  /** 'YYYY-MM-DD'(本地) */
  dateKey: string;
  segments: TimelineSegment[];
}

// 时区还原:导入时间戳带原时区偏移(旅行数据)按事发地钟点取日/时,
// 否则按设备本地 —— 修「国外行程时间/日期全错」。纯逻辑在 place-time.mjs(有单测)。
const localDateKey = wallDateKey;
const clampEndToDay = clampEndToWallDay;

/**
 * 把打点流水聚合成按天分组的访问段。
 * - 连续同名点(间隔 < 3h)合并成一段;段结束时间取显式 end,否则取下一个点的开始。
 * - 段停留时长 = end − start。
 * 天从新到旧,天内按时间正序(时间线读感:早 → 晚)。
 */
export function buildPlaceTimeline(visits: PlaceVisit[], maxDays = 14): TimelineDay[] {
  let sorted = [...visits].filter((v) => v.ts).sort((a, b) => a.ts.localeCompare(b.ts));

  // 数据分辨率:实时打点是城市级(天气反查只到「Cary, NC」),导入是地点级。
  // 同一天两种混排会出现互相矛盾的重叠段 —— 有导入段的那天,更早的粗粒度城市 ping 让位;
  // 但保留手动标记,以及最近 6h 的 live(否则「标记当前位置」会被当天 import 整段吃掉)。
  const importDays = new Set(sorted.filter((v) => v.source === 'import').map((v) => localDateKey(v.ts)));
  if (importDays.size) {
    const nowMs = Date.now();
    sorted = sorted.filter((v) => {
      if (v.source === 'import') return true;
      if (!importDays.has(localDateKey(v.ts))) return true;
      if (v.manual) return true;
      if (v.source === 'live' && nowMs - new Date(v.ts).getTime() <= IMPORT_DAY_LIVE_KEEP_MS) return true;
      return false;
    });
  }

  const segs: TimelineSegment[] = [];
  // 批次 30:别名一次读入 —— 类别按纠正后的名字推断(Unknown 改成「健身房」就归 fitness)。
  // 类别优先级与 categoryOfPlace 一致:手动 > geocode 真类 > 名字推断(一次读入,避免每段查 localStorage)。
  const aliases = loadPlaceAliases();
  const catOverrides = loadPlaceCategories();
  const geoKinds = loadPlaceGeo();
  const disp = (raw: string) => aliases[raw]?.trim() || raw;
  const catFor = (raw: string) => catOverrides[raw] || geoKinds[raw]?.kind || categoryOf(disp(raw));

  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const next = sorted[i + 1];
    // 无显式 end 的实时打点:旧逻辑「到下一个点为止」会把中间几小时的空档
    // 全记成停留(咖啡店一 ping、5 小时后到家一 ping → "咖啡店停留 5h")。
    // 封顶 2h(与同地去重窗一致:真待更久会有下一个同地 ping 来续段)。
    let rawEnd = v.end || next?.ts || v.ts;
    if (!v.end && v.source === 'live') {
      const cap = new Date(new Date(v.ts).getTime() + 2 * 3_600_000).toISOString();
      if (rawEnd > cap) rawEnd = cap;
    }
    const end = clampEndToDay(v.ts, rawEnd);
    const last = segs[segs.length - 1];
    const sameDay = last && localDateKey(v.ts) === localDateKey(last.start);
    // 同名还要同地:两家同名店(都叫 Starbucks)相邻到访不能并成一段。
    // 批次 69:按基名比(「X, Cary, United States」后缀变体认亲);间隔不设上限 ——
    // 用户定案:中间没有出现别的地点,就是一直在这个地方,合成一段。
    const sameName = last && (last.label === v.label
      || last.label.split(',')[0].trim() === v.label.split(',')[0].trim());
    // #31(2026-07-30 真机):同一时刻 15:38 的两条坐标 35.7982,-78.8431 和
    // 35.7983,-78.8432 —— 相距约 10 米,被记成两次独立到访。
    // 根因是「同名才合」:这两条都还没认出名字(占位符),而**没有名字的点,
    // 名字就不是它的身份,坐标才是**。所以分两种口径:
    //   · 两边都有名字且同名 → 500 米内算一段(两家同名店不会挨这么近);
    //   · 有一边还没认出名字 → 只看距离,150 米内就是同一个地方。
    // 两个**不同的真地名**永远不合 —— 那是真的去了两个地方。
    const dist = last && last.lat != null && v.lat != null
      ? haversineKm(last.lat, last.lon ?? 0, v.lat, v.lon ?? 0)
      : null;
    const eitherUnnamed = !!last && (isGenericPlaceLabel(last.label) || isGenericPlaceLabel(v.label));
    const nearSame = sameName
      ? (dist == null || dist < 0.5)
      : (eitherUnnamed && dist != null && dist < 0.15);
    if (last && sameDay && nearSame) {
      if (end > last.end) last.end = end;
      // 2026-07-30 自查发现:上面放开了「无名点按坐标合并」之后,这一行就有了新后果 ——
      // 「Unknown」只有 7 个字符,合并 `Starbucks Reserve`(17)时会**把真地名顶掉**。
      // 短基名优先这条规则本来是给「同名的后缀变体」用的(「X, Cary, US」→「X」),
      // 前提是两边都是真名字。所以先分一层:**认出来的名字永远赢占位符**。
      const lastGeneric = isGenericPlaceLabel(last.label);
      const vGeneric = isGenericPlaceLabel(v.label);
      if (lastGeneric && !vGeneric) last.label = v.label;
      else if (!lastGeneric && !vGeneric && v.label.length < last.label.length) last.label = v.label;
      if (last.lat == null && v.lat != null) { last.lat = v.lat; last.lon = v.lon; }
    } else {
      segs.push({ label: v.label, category: catFor(v.label), start: v.ts, end, durationMin: 0, source: v.source, lat: v.lat, lon: v.lon });
    }
  }

  for (const s of segs) {
    s.durationMin = Math.max(0, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000));
  }

  const byDay = new Map<string, TimelineSegment[]>();
  for (const s of segs) {
    const key = localDateKey(s.start);
    const arr = byDay.get(key) || [];
    arr.push(s);
    byDay.set(key, arr);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, maxDays)
    .map(([dateKey, list]) => ({ dateKey, segments: list.sort((a, b) => a.start.localeCompare(b.start)) }));
}

// ── 批次 28:Google 时间线 tab 用的 —— 行程/统计/聚类 ─────────────────────────

export type TransitMode = 'walk' | 'drive' | 'move';

export type JourneyItem =
  | { kind: 'visit'; seg: TimelineSegment }
  | { kind: 'move'; fromLabel: string; toLabel: string; start: string; end: string; durationMin: number; km: number; mode: TransitMode };

/** 某一天的行程:访问段 + 段之间推断的移动(直线距离 + 时长 + 速度猜通勤方式)。 */
export function buildDayJourney(visits: PlaceVisit[], dateKey: string): JourneyItem[] {
  const day = buildPlaceTimeline(visits, 3650).find((d) => d.dateKey === dateKey);
  if (!day) return [];
  const segs = day.segments;
  const items: JourneyItem[] = [];
  for (let i = 0; i < segs.length; i++) {
    items.push({ kind: 'visit', seg: segs[i] });
    const next = segs[i + 1];
    if (next && segs[i].lat != null && segs[i].lon != null && next.lat != null && next.lon != null) {
      const km = haversineKm(segs[i].lat!, segs[i].lon!, next.lat!, next.lon!);
      if (km >= 0.05) {
        const durationMin = Math.max(0, Math.round((new Date(next.start).getTime() - new Date(segs[i].end).getTime()) / 60000));
        const speed = durationMin > 0 ? km / (durationMin / 60) : 0; // km/h
        // 通勤方式只在速度"像那么回事"时才叫出口:步行 2-7km/h 且起点段有真实
        // 结束时间(导入);<2km/h 是大段未记录的空档、>150 是数据毛刺,都只说"移动"。
        const fromReliable = segs[i].source === 'import';
        const mode: TransitMode = speed >= 7 && speed <= 150 ? 'drive'
          : speed >= 2 && speed < 7 && fromReliable ? 'walk'
          : 'move';
        items.push({ kind: 'move', fromLabel: segs[i].label, toLabel: next.label, start: segs[i].end, end: next.start, durationMin, km: Math.round(km * 100) / 100, mode });
      }
    }
  }
  return items;
}

export interface DayStats { visits: number; dwellMin: number; moveKm: number; moveMin: number }

export function dayStats(journey: JourneyItem[]): DayStats {
  let visits = 0, dwellMin = 0, moveKm = 0, moveMin = 0;
  for (const it of journey) {
    if (it.kind === 'visit') { visits += 1; dwellMin += it.seg.durationMin; }
    else { moveKm += it.km; moveMin += it.durationMin; }
  }
  return { visits, dwellMin, moveKm: Math.round(moveKm * 100) / 100, moveMin };
}

/** 有访问记录的日期(YYYY-MM-DD),从新到旧。 */
export function timelineDays(visits: PlaceVisit[]): string[] {
  return buildPlaceTimeline(visits, 3650).map((d) => d.dateKey);
}

export interface PlaceCluster { label: string; category: PlaceCategory; totalMin: number; visits: number; lastTs: string; lat?: number; lon?: number; generic?: boolean }

export function isGenericPlace(label: string): boolean {
  return isGenericPlaceLabel(label);
}

/** 无名占位 + 有坐标 → 按 ~1km 粗坐标分桶(实现见 geo.ts)。 */
export function placeKey(label: string, lat?: number, lon?: number): string {
  return geoPlaceKey(label, lat, lon);
}
function bucketKey(label: string, lat?: number, lon?: number): string {
  return geoPlaceKey(label, lat, lon);
}

/** 常去地点聚类:跨全部数据按地点名聚合;无名占位按粗坐标拆开。 */
export function clusterPlaces(visits: PlaceVisit[], topN = 8): PlaceCluster[] {
  const segs = buildPlaceTimeline(visits, 3650).flatMap((d) => d.segments);
  const m = new Map<string, PlaceCluster>();
  for (const s of segs) {
    const key = bucketKey(s.label, s.lat, s.lon);
    const c = m.get(key) || { label: key, category: s.category, totalMin: 0, visits: 0, lastTs: s.start, lat: s.lat, lon: s.lon, generic: isGenericPlace(s.label) };
    c.totalMin += s.durationMin;
    c.visits += 1;
    if (s.start > c.lastTs) c.lastTs = s.start;
    if (c.lat == null && s.lat != null) { c.lat = s.lat; c.lon = s.lon; }
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => b.totalMin - a.totalMin || b.visits - a.visits).slice(0, topN);
}

/* ---------- 批次 33:反向地理编码开关(默认关)---------- */
const GEOCODE_FLAG_KEY = 'nesio-place-geocode-enabled';
export function loadGeocodeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(GEOCODE_FLAG_KEY) === '1'; } catch { return false; }
}
export function setGeocodeEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(GEOCODE_FLAG_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

/** 环游:去过的「外面」地点(排除家/未知),按最近去过排序 —— 给旅行/城市卡用。 */
export function travelPlaces(visits: PlaceVisit[], topN = 60): PlaceCluster[] {
  return clusterPlaces(visits, 99999)
    .filter((c) => c.category !== 'home' && c.category !== 'unknown')
    .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
    .slice(0, topN);
}

export interface CategoryShare { category: PlaceCategory; totalMin: number; pct: number }

export function categoryTimeShare(visits: PlaceVisit[]): CategoryShare[] {
  const segs = buildPlaceTimeline(visits, 3650).flatMap((d) => d.segments);
  const m = new Map<PlaceCategory, number>();
  for (const s of segs) m.set(s.category, (m.get(s.category) || 0) + s.durationMin);
  const grand = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()]
    .map(([category, totalMin]) => ({ category, totalMin, pct: Math.round((totalMin / grand) * 100) }))
    .sort((a, b) => b.totalMin - a.totalMin);
}

export type TimeBucket = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

export interface BucketShare { bucket: TimeBucket; min: number }

/** 时段分布:各访问按开始小时归入 清晨/上午/下午/傍晚/夜,累计停留分钟。 */
export function timeOfDayBuckets(visits: PlaceVisit[]): BucketShare[] {
  const order: TimeBucket[] = ['dawn', 'morning', 'afternoon', 'evening', 'night'];
  const m = new Map<TimeBucket, number>(order.map((b) => [b, 0]));
  const segs = buildPlaceTimeline(visits, 3650).flatMap((d) => d.segments);
  for (const s of segs) {
    const h = wallHour(s.start);
    const b: TimeBucket = h < 5 ? 'night' : h < 8 ? 'dawn' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    m.set(b, (m.get(b) || 0) + s.durationMin);
  }
  return order.map((bucket) => ({ bucket, min: m.get(bucket) || 0 }));
}

function humanizeSemanticType(label: string): string {
  const map: Record<string, string> = {
    INFERRED_HOME: '家', HOME: '家',
    INFERRED_WORK: '公司', WORK: '公司',
    SEARCHED_ADDRESS: '地址', UNKNOWN: '未知地点',
  };
  return map[label] ?? label;
}

// ── 反查回填:给「无名占位/纯坐标 + 有坐标」的到访补真实地名 ──────────────
// Google 新版时间轴导出大多数段只有坐标 + semanticType(UNKNOWN → 「未知地点」),
// 地名要自己反查(用户实测:导入后满屏未知地点)。按 ~110m 坐标格去重 —— 同一
// 地点的反复到访只查一次;结果缓存本机,跨次导入/打开不重查;每轮限量,防一次
// 导入几百个格子把免费反查服务打爆(查不完的下轮继续,常去的先有名字)。
const REVGEO_CACHE_KEY = 'nesio-revgeo-cache-v1';
/** 缓存命中须在锚点这么近(米)内;toFixed(3) 格约 110m,旧缓存常把隔壁店贴到整格。 */
const REVGEO_CACHE_MAX_M = 50;
const REVGEO_CACHE_MAX_AGE_MS = 30 * 24 * 3_600_000;
type RevGeoCell = {
  label: string; city?: string; country?: string; kind?: string;
  /** 反查时的锚点坐标 —— 无则旧缓存,仅按格心粗校验 */
  lat?: number; lon?: number; distM?: number; ts?: number;
};
const revgeoStore = createBlobStore<Record<string, RevGeoCell>>({
  key: REVGEO_CACHE_KEY,
  updateEvent: PLACE_TRAIL_UPDATED_EVENT,
  validate: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});
const COORD_LABEL_RE = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

function needsRealName(v: PlaceVisit): boolean {
  return v.lat != null && v.lon != null &&
    (isGenericPlace(v.label) || COORD_LABEL_RE.test((v.label || '').trim()));
}

function cellKeyOf(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function revgeoCacheUsable(hit: RevGeoCell, lat: number, lon: number): boolean {
  if (!hit?.label) return false;
  if (hit.ts != null && Date.now() - hit.ts > REVGEO_CACHE_MAX_AGE_MS) return false;
  // 旧缓存无锚点坐标 → 一律作废重查(曾把隔壁店名粘满 ~110m 格)。
  if (hit.lat == null || hit.lon == null) return false;
  return haversineMeters(hit.lat, hit.lon, lat, lon) <= REVGEO_CACHE_MAX_M;
}

/**
 * 忘掉错贴的店名(足迹「不是这里」)。
 * 清 revgeo 格缓存 + 改名映射,并把轨迹里同名条目打回「未知地点」以便重新反查。
 */
export function forgetStickyPlaceLabel(label: string): number {
  if (typeof window === 'undefined' || !label.trim()) return 0;
  const base = label.split(',')[0].trim();
  const match = (s: string) => {
    const t = (s || '').trim();
    return t === label || t === base || t.split(',')[0].trim() === base;
  };

  const cache = loadJsonBlob(revgeoStore) as Record<string, RevGeoCell>;
  let cacheTouched = false;
  for (const k of Object.keys(cache)) {
    if (match(cache[k]?.label || '')) { delete cache[k]; cacheTouched = true; }
  }
  if (cacheTouched) saveJsonBlob(revgeoStore, cache);

  const renames = loadPlaceRenames();
  let renameTouched = false;
  for (const k of Object.keys(renames)) {
    if (match(k) || match(renames[k])) { delete renames[k]; renameTouched = true; }
  }
  if (renameTouched) saveJsonBlob(renameStore, renames);

  const trail = loadPlaceTrail();
  let n = 0;
  const next = trail.map((v) => {
    if (!match(v.label)) return v;
    n++;
    return { ...v, label: '未知地点' };
  });
  if (n) save(next);
  return n;
}

export async function backfillGenericPlaceLabels(maxLookups = 40): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const trail = loadPlaceTrail();
  const needs = trail.filter(needsRealName);
  if (!needs.length) return 0;

  let cache: Record<string, RevGeoCell> = loadJsonBlob(revgeoStore);

  const cellOf = (v: PlaceVisit) => cellKeyOf(v.lat as number, v.lon as number);
  const byCell = new Map<string, number>();
  for (const v of needs) byCell.set(cellOf(v), (byCell.get(cellOf(v)) || 0) + 1);
  // 到访多的格子先查 —— 常去的地方先有名字
  const cells = [...byCell.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const { reverseGeocodeRobust } = await import('./capture-location');
  // 有 Foursquare key 时服务端 geocode 出「店名 + 类别」(POI 级,认店最准),
  // 优先走它;被限流(429)后本轮不再打服务端,余下格子回落免费链(街道级)。
  let serverBlocked = false;
  const lookupOnce = async (lat: number, lon: number): Promise<RevGeoCell | null> => {
    if (!serverBlocked) {
      try {
        const res = await fetch('/api/portal/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lon }),
        });
        if (res.status === 429) { serverBlocked = true; } else {
          const d = await res.json() as { ok?: boolean; name?: string; city?: string; country?: string; kind?: string; distanceM?: number };
          if (d.ok && d.name) {
            const label = [d.name, d.city && d.city !== d.name ? d.city : '', d.country].filter(Boolean).join(', ');
            return { label, city: d.city, country: d.country, kind: d.kind, lat, lon, distM: d.distanceM, ts: Date.now() };
          }
        }
      } catch { /* 服务端不可达 → 回落免费链 */ }
    }
    try {
      const g = await reverseGeocodeRobust(lat, lon);
      if (g.label) return { label: g.label, city: g.city, country: g.country, lat, lon, ts: Date.now() };
    } catch { /* 免费链也没查到 */ }
    return null;
  };

  let lookups = 0;
  const resolved = new Map<string, RevGeoCell>();
  for (const key of cells) {
    const [lat, lon] = key.split(',').map(Number);
    let hit: RevGeoCell | undefined = cache[key];
    if (hit && !revgeoCacheUsable(hit, lat, lon)) {
      delete cache[key];
      hit = undefined;
    }
    if (!hit) {
      if (lookups >= maxLookups) continue;
      lookups++;
      const g = await lookupOnce(lat, lon);
      if (!g) continue; // 本轮查不到:跳过,下轮再试(不缓存失败)
      hit = g;
      cache[key] = hit;
    }
    resolved.set(key, hit);
  }
  saveJsonBlob(revgeoStore, cache);
  if (!resolved.size) return 0;

  let touched = 0;
  const next = trail.map((v) => {
    if (!needsRealName(v)) return v;
    const hit = resolved.get(cellOf(v));
    if (!hit) return v;
    // 逐条再验距离:同格内另一侧可能仍超阈值
    if (v.lat != null && v.lon != null && !revgeoCacheUsable(hit, v.lat, v.lon)) return v;
    touched++;
    const name = canonicalPlaceLabel(hit.label) || hit.label;
    return { ...v, label: name };
  });
  if (!touched) return 0;
  save(next); // store 自带 PLACE_TRAIL_UPDATED_EVENT 广播,地图/时间线就地刷新
  // World tab / 分类链路:城市、国家、类别元数据跟着新名字走。
  // Foursquare 给的 kind(超市/咖啡/公园…)写进分类 —— 但用户手动改过的不覆盖。
  const geoAll = loadPlaceGeo();
  const catOverrides = loadPlaceCategories();
  for (const { label, city, country, kind } of resolved.values()) {
    const name = canonicalPlaceLabel(label) || label;
    try {
      setPlaceGeo(name, { ...(geoAll[name] || {}), name, city, country, resolved: true, ...(kind ? { kind: kind as PlaceCategory } : {}) });
      if (kind && !catOverrides[name]) setPlaceCategory(name, kind as PlaceCategory);
    } catch { /* 元数据可缺 */ }
  }
  return touched;
}
