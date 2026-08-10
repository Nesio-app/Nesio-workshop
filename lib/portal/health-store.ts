/**
 * Health metrics store — Apple Health 导入的指标存本机,供健康 Dashboard 读。
 * 批次 57:从 localStorage 挪到 IndexedDB(体量最大,腾出 5MB localStorage 配额;
 * 老用户数据水合时透明迁移)。读取仍同步(内存缓存),写落 IDB。
 *
 * 默认 merge:再导入不会整表盖掉旧指标;按 metric.key 合并,较新的点覆盖较旧。
 */
import type { DailyFact, HealthMetric, HealthMetrics } from './apple-health';
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const HEALTH_KEY = 'nesio-health-v1';

const store = createBlobStore<HealthMetrics>({
  key: HEALTH_KEY,
  updateEvent: 'nesio-health-updated',
  validate: (v) => !!v && Array.isArray((v as HealthMetrics).metrics),
  onWriteError: reportStorageDropped,
});

/** 合并两条同 key 的指标:series 按 ym 并集(同月取较新侧),latest 取日期更新的一侧。 */
function mergeOneMetric(a: HealthMetric, b: HealthMetric): HealthMetric {
  const aNewer = (a.latestDate || '') >= (b.latestDate || '');
  const newer = aNewer ? a : b;
  const older = aNewer ? b : a;
  const byYm = new Map<string, number>();
  for (const p of older.series || []) {
    if (p?.ym) byYm.set(p.ym, p.v);
  }
  // 较新侧同月覆盖较旧
  for (const p of newer.series || []) {
    if (p?.ym) byYm.set(p.ym, p.v);
  }
  const series = [...byYm.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([ym, v]) => ({ ym, v }));
  return { ...older, ...newer, series };
}

/** 每日事实按 date 并集;同日字段以较新导入侧为准(后者覆盖前者已有键)。 */
function mergeDaily(a: DailyFact[] | undefined, b: DailyFact[] | undefined, bWins: boolean): DailyFact[] | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  const map = new Map<string, DailyFact>();
  const first = bWins ? a : b;
  const second = bWins ? b : a;
  for (const d of first) if (d?.date) map.set(d.date, { ...d });
  for (const d of second) {
    if (!d?.date) continue;
    map.set(d.date, { ...(map.get(d.date) || { date: d.date }), ...d });
  }
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
}

/**
 * 按 metric 身份合并两份健康数据。较新(importedAt / latestDate)覆盖较旧;
 * 不会因一次短窗口导入冲掉此前更长历史。
 */
export function mergeHealthMetrics(existing: HealthMetrics | null | undefined, incoming: HealthMetrics): HealthMetrics {
  if (!existing || !Array.isArray(existing.metrics)) return incoming;
  const byKey = new Map<string, HealthMetric>();
  for (const m of existing.metrics) {
    if (m?.key) byKey.set(m.key, m);
  }
  for (const m of incoming.metrics) {
    if (!m?.key) continue;
    const prev = byKey.get(m.key);
    byKey.set(m.key, prev ? mergeOneMetric(prev, m) : m);
  }
  const incomingNewer = (incoming.importedAt || '') >= (existing.importedAt || '');
  const prefer = <T,>(a: T | undefined, b: T | undefined): T | undefined => {
    if (a == null) return b;
    if (b == null) return a;
    return incomingNewer ? b : a;
  };
  return {
    metrics: [...byKey.values()],
    workouts: Math.max(existing.workouts || 0, incoming.workouts || 0),
    importedAt: incomingNewer ? (incoming.importedAt || existing.importedAt) : (existing.importedAt || incoming.importedAt),
    glucose: prefer(existing.glucose, incoming.glucose),
    daily: mergeDaily(existing.daily, incoming.daily, incomingNewer),
    sleepStages: prefer(existing.sleepStages, incoming.sleepStages),
    activityRings: prefer(existing.activityRings, incoming.activityRings),
    mood: prefer(existing.mood, incoming.mood),
    profile: (() => {
      const a = existing.profile;
      const b = incoming.profile;
      if (!a) return b;
      if (!b) return a;
      return incomingNewer ? { ...a, ...b } : { ...b, ...a };
    })(),
  };
}

export type SaveHealthMode = 'merge' | 'replace';

/** 默认 merge —— 再导入不整表盖掉。显式 `replace` 才整份覆盖(极少用)。 */
export function saveHealthMetrics(m: HealthMetrics, mode: SaveHealthMode = 'merge'): void {
  if (mode === 'replace') {
    store.save(m);
    return;
  }
  const existing = store.load();
  store.save(mergeHealthMetrics(existing, m));
}

export function loadHealthMetrics(): HealthMetrics | null {
  return store.load();
}

/** 是否已有健康数据(供 personalization 的 has-data 门,避免直读已迁走的 localStorage key)。 */
export function hasHealthData(): boolean {
  return store.load() != null;
}
