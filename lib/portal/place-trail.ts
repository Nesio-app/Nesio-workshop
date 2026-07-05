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

function humanizeSemanticType(label: string): string {
  const map: Record<string, string> = {
    INFERRED_HOME: '家', HOME: '家',
    INFERRED_WORK: '公司', WORK: '公司',
    SEARCHED_ADDRESS: '地址', UNKNOWN: '未知地点',
  };
  return map[label] ?? label;
}
