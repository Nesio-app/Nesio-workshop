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
  const root = json as {
    semanticSegments?: Array<Record<string, unknown>>;
    timelineObjects?: Array<Record<string, unknown>>;
  };

  for (const seg of root.semanticSegments ?? []) {
    const visit = seg.visit as {
      topCandidate?: { placeLocation?: string; semanticType?: string; label?: string; placeId?: string };
    } | undefined;
    if (!visit?.topCandidate) continue;
    const tc = visit.topCandidate;
    const geo = /geo:(-?[\d.]+),(-?[\d.]+)/.exec(String(tc.placeLocation ?? ''));
    const label = tc.label || tc.semanticType || (geo ? `${geo[1]},${geo[2]}` : '');
    const ts = String(seg.startTime ?? '');
    if (!label || !ts) continue;
    out.push({
      ts,
      end: seg.endTime ? String(seg.endTime) : undefined,
      label: humanizeSemanticType(label),
      lat: geo ? Number(geo[1]) : undefined,
      lon: geo ? Number(geo[2]) : undefined,
      source: 'import',
    });
  }

  for (const obj of root.timelineObjects ?? []) {
    const pv = obj.placeVisit as {
      location?: { name?: string; latitudeE7?: number; longitudeE7?: number };
      duration?: { startTimestamp?: string; endTimestamp?: string };
    } | undefined;
    if (!pv?.location || !pv.duration?.startTimestamp) continue;
    out.push({
      ts: pv.duration.startTimestamp,
      end: pv.duration.endTimestamp,
      label: pv.location.name || `${(pv.location.latitudeE7 ?? 0) / 1e7},${(pv.location.longitudeE7 ?? 0) / 1e7}`,
      lat: pv.location.latitudeE7 != null ? pv.location.latitudeE7 / 1e7 : undefined,
      lon: pv.location.longitudeE7 != null ? pv.location.longitudeE7 / 1e7 : undefined,
      source: 'import',
    });
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
