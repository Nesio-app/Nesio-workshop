'use client';

/**
 * tesla-history —— 车的电量/里程时间线(2026-07-30)。
 *
 * Tesla 车辆接口只回「此刻」;打开车页时把读数攒成稀疏曲线。
 * 2026-08-10:迁出 LS cache → IDB durable,随 module-sync 换端可见
 * (用户明确要求「没上云的全部上云」;采样仍稀疏,UI 须照实说)。
 */

import { createBlobStore } from './idb-blob-store';
import { logDropped } from './storage-health';

export const TESLA_LOG_KEY = 'nesio-tesla-battery-log-v1';
export const TESLA_LOG_UPDATED = 'nesio-tesla-battery-log-updated';

/** 两个采样点至少隔这么久才记新的一条 —— 否则来回切页面会把曲线堆成一堵墙。 */
export const MIN_GAP_MS = 10 * 60_000;
/** 只留最近这么多天。 */
export const KEEP_DAYS = 30;
/** 硬上限,防某天 gap 判定出错把存储撑爆。 */
export const MAX_POINTS = 600;

export interface TeslaLogPoint {
  at: string;
  vehicleId: string;
  batteryPct?: number | null;
  odometerMi?: number | null;
  chargingState?: string;
  latitude?: number | null;
  longitude?: number | null;
}

const store = createBlobStore<TeslaLogPoint[]>({
  key: TESLA_LOG_KEY,
  updateEvent: TESLA_LOG_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: () => logDropped('tesla.battery_log', new Error('write failed')),
});

export function readTeslaLog(): TeslaLogPoint[] {
  const arr = store.load() ?? [];
  return arr.filter((p): p is TeslaLogPoint => !!p && typeof p.at === 'string');
}

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

export function prune(points: readonly TeslaLogPoint[], nowMs: number): TeslaLogPoint[] {
  const cutoff = nowMs - KEEP_DAYS * 86_400_000;
  const kept = points.filter((p) => {
    const t = Date.parse(p.at);
    return Number.isFinite(t) && t >= cutoff;
  });
  return kept.length > MAX_POINTS ? kept.slice(kept.length - MAX_POINTS) : kept;
}

export function recordTeslaReadings(
  readings: ReadonlyArray<{
    vehicleId: string;
    batteryPct?: number | null;
    odometerMi?: number | null;
    chargingState?: string;
    latitude?: number | null;
    longitude?: number | null;
  }>,
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
      ...(r.latitude != null ? { latitude: r.latitude } : {}),
      ...(r.longitude != null ? { longitude: r.longitude } : {}),
    });
    added++;
  }
  if (!added) return 0;
  store.save(prune(next, nowMs));
  return added;
}
