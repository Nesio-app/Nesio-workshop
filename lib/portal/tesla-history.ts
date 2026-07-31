'use client';

/**
 * tesla-history —— 车的电量/里程的**本机时间线**(2026-07-30)。
 *
 * 为什么需要它:Tesla 的车辆接口只回「此刻」。用户要的图 4 是一条**随时间变化**的曲线,
 * 而拿一个点重复画成一条线是假的。能源产品那边有真的历史接口(history?kind=energy),
 * 车辆这边没有 —— 所以只能在**看过的时刻**把读数攒起来。
 *
 * 攒的是「你打开过这一页的那些时刻」,不是连续采样。曲线因此是**稀疏**的,
 * UI 必须照实说(「按你查看过的时刻画」),不能让它看起来像全天候记录。
 *
 * 存储类别 `cache`:换台设备从零开始完全正确 —— 它是本机看车的副产物,
 * 不是用户录进来的东西,没有必要进备份、上云。
 * (键必须在 scripts/storage-key-registry.test.mjs 里登记,否则默认 durable 会悄悄进备份。)
 */

import { logDropped } from './storage-health';

export const TESLA_LOG_KEY = 'nesio-tesla-battery-log-v1';

/** 两个采样点至少隔这么久才记新的一条 —— 否则来回切页面会把曲线堆成一堵墙。 */
export const MIN_GAP_MS = 10 * 60_000;
/** 只留最近这么多天。 */
export const KEEP_DAYS = 30;
/** 硬上限,防某天 gap 判定出错把 localStorage 撑爆。 */
export const MAX_POINTS = 600;

export interface TeslaLogPoint {
  /** ISO 时刻 */
  at: string;
  vehicleId: string;
  batteryPct?: number | null;
  odometerMi?: number | null;
  chargingState?: string;
}

export function readTeslaLog(): TeslaLogPoint[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TESLA_LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is TeslaLogPoint => !!p && typeof (p as TeslaLogPoint).at === 'string');
  } catch { return []; }
}

/**
 * 该不该把这一次读数记下来 —— 纯判定,便于单测。
 * 判据是正向的:**有电量**、**这辆车上一条离现在够久**,两条都成立才记。
 */
export function shouldRecord(
  existing: readonly TeslaLogPoint[],
  point: { vehicleId: string; batteryPct?: number | null },
  nowMs: number,
): boolean {
  if (!point.vehicleId) return false;
  if (point.batteryPct == null || !Number.isFinite(point.batteryPct)) return false;
  const last = existing.filter((p) => p.vehicleId === point.vehicleId).at(-1);
  if (!last) return true;
  const t = Date.parse(last.at);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= MIN_GAP_MS;
}

/** 掐掉太老的和超量的(最新在后)。 */
export function prune(points: readonly TeslaLogPoint[], nowMs: number): TeslaLogPoint[] {
  const cutoff = nowMs - KEEP_DAYS * 86_400_000;
  const kept = points.filter((p) => {
    const t = Date.parse(p.at);
    return Number.isFinite(t) && t >= cutoff;
  });
  return kept.length > MAX_POINTS ? kept.slice(kept.length - MAX_POINTS) : kept;
}

/** 把这一次看到的车辆读数攒进本机时间线。返回真正写进去几条。 */
export function recordTeslaReadings(
  readings: ReadonlyArray<{ vehicleId: string; batteryPct?: number | null; odometerMi?: number | null; chargingState?: string }>,
  now: Date = new Date(),
): number {
  if (typeof window === 'undefined') return 0;
  const nowMs = now.getTime();
  const cur = readTeslaLog();
  const next = [...cur];
  let added = 0;
  for (const r of readings) {
    if (!shouldRecord(next, r, nowMs)) continue;
    next.push({
      at: now.toISOString(),
      vehicleId: r.vehicleId,
      batteryPct: r.batteryPct ?? null,
      odometerMi: r.odometerMi ?? null,
      ...(r.chargingState ? { chargingState: r.chargingState } : {}),
    });
    added++;
  }
  if (!added) return 0;
  const pruned = prune(next, nowMs);
  try {
    localStorage.setItem(TESLA_LOG_KEY, JSON.stringify(pruned));
  } catch (err) {
    // 写不进去必须说出来(CLAUDE.md 红线:存储写失败不许静默吞掉)。
    logDropped('tesla.battery_log', err);
    return 0;
  }
  return added;
}
