/**
 * Place Trail — 地点流水(批次 21)。
 *
 * b 主线:天气连接器每次拿到定位就顺手记一笔,自然积累成自己的
 * 地点足迹(隐私完全本机);a 补历史:Google 地图时间轴导出的 JSON
 * 可整段导入并入同一条流水。洞察 → 分析 → 「地点足迹」消费。
 */

export interface PlaceVisit {
  /** ISO 时间(到访开始) */
  ts: string;
  /** 结束时间(导入的历史段才有) */
  end?: string;
  label: string;
  lat?: number;
  lon?: number;
  source: 'live' | 'import';
}

const KEY = 'nesio-place-trail-v1';
const CAP = 800;
export const PLACE_TRAIL_UPDATED_EVENT = 'nesio-place-trail-updated';

export function loadPlaceTrail(): PlaceVisit[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as PlaceVisit[]; } catch { return []; }
}

function save(trail: PlaceVisit[]): void {
  // 按时间倒序,封顶
  const sorted = [...trail].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, CAP);
  try { localStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(PLACE_TRAIL_UPDATED_EVENT));
}

/** 实时记录:同一地点 2 小时内不重复记(定位轮询会反复命中同一地方)。 */
export function recordLiveVisit(label: string, lat?: number, lon?: number): void {
  if (!label) return;
  const trail = loadPlaceTrail();
  const now = Date.now();
  const recentSame = trail.find(
    (v) => v.label === label && now - new Date(v.ts).getTime() < 2 * 3_600_000,
  );
  if (recentSame) return;
  save([{ ts: new Date().toISOString(), label, lat, lon, source: 'live' }, ...trail]);
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

export type PlaceCategory = 'home' | 'work' | 'shopping' | 'food' | 'fitness' | 'transit' | 'unknown' | 'place';

/** 从地点名推断类别(决定图标/配色)。中英文关键词都认。 */
export function categoryOf(label: string): PlaceCategory {
  const s = (label || '').toLowerCase();
  if (!s || /unknown|未知/.test(s)) return 'unknown';
  if (/home|家|住/.test(s)) return 'home';
  if (/work|office|公司|办公/.test(s)) return 'work';
  if (/gym|fitness|健身|运动|yoga|瑜伽/.test(s)) return 'fitness';
  if (/restaurant|cafe|coffee|starbucks|mcdonald|餐|饭|food|dining|bakery|bar/.test(s)) return 'food';
  if (/shop|mall|store|market|超市|商场|购物|target|walmart|costco|michaels|ulta|beauty|ikea/.test(s)) return 'shopping';
  if (/airport|station|机场|车站|transit|地铁|subway/.test(s)) return 'transit';
  return 'place';
}

export interface TimelineSegment {
  label: string;
  category: PlaceCategory;
  start: string;
  end: string;
  durationMin: number;
  source: 'live' | 'import';
}

export interface TimelineDay {
  /** 'YYYY-MM-DD'(本地) */
  dateKey: string;
  segments: TimelineSegment[];
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 段结束若跨到次日,截到当天 23:59 —— 避免「在家过夜」吞掉第二天、时长显示成 24h。 */
function clampEndToDay(startIso: string, endIso: string): string {
  if (localDateKey(endIso) === localDateKey(startIso)) return endIso;
  const d = new Date(startIso);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

/**
 * 把打点流水聚合成按天分组的访问段。
 * - 连续同名点(间隔 < 3h)合并成一段;段结束时间取显式 end,否则取下一个点的开始。
 * - 段停留时长 = end − start。
 * 天从新到旧,天内按时间正序(时间线读感:早 → 晚)。
 */
export function buildPlaceTimeline(visits: PlaceVisit[], maxDays = 14): TimelineDay[] {
  const sorted = [...visits].filter((v) => v.ts).sort((a, b) => a.ts.localeCompare(b.ts));
  const segs: TimelineSegment[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const next = sorted[i + 1];
    const end = clampEndToDay(v.ts, v.end || next?.ts || v.ts);
    const last = segs[segs.length - 1];
    const gapMs = last ? new Date(v.ts).getTime() - new Date(last.end).getTime() : Infinity;
    const sameDay = last && localDateKey(v.ts) === localDateKey(last.start);
    if (last && sameDay && last.label === v.label && gapMs < 3 * 3_600_000) {
      if (end > last.end) last.end = end;
    } else {
      segs.push({ label: v.label, category: categoryOf(v.label), start: v.ts, end, durationMin: 0, source: v.source });
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

function humanizeSemanticType(label: string): string {
  const map: Record<string, string> = {
    INFERRED_HOME: '家', HOME: '家',
    INFERRED_WORK: '公司', WORK: '公司',
    SEARCHED_ADDRESS: '地址', UNKNOWN: '未知地点',
  };
  return map[label] ?? label;
}
