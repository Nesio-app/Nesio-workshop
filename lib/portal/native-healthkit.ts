/**
 * HealthKit 读桥 —— 自研 NesioHealthKit(Xcode 15 可用)。
 * 拉步数/睡眠/心率等 → 写入与导出 XML 同一套 health-store。
 */

import { registerPlugin } from '@capacitor/core';
import { isNativePlatform } from './platform-capabilities';
import type { HealthMetric, HealthMetrics } from './apple-health';
import { saveHealthMetrics } from './health-store';

type NesioHealthKitPlugin = {
  checkPermissions: () => Promise<{ available?: boolean; read?: string }>;
  requestPermissions: () => Promise<{ ok?: boolean; reason?: string; read?: string }>;
  fetchMetrics: (opts?: { days?: number }) => Promise<{
    ok?: boolean;
    reason?: string;
    metrics?: HealthMetric[];
    workouts?: number;
    importedAt?: string;
  }>;
};

const NesioHealthKit = registerPlugin<NesioHealthKitPlugin>('NesioHealthKit');

export function isHealthKitAvailable(): boolean {
  return isNativePlatform();
}

export async function requestHealthKitAccess(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const check = await NesioHealthKit.checkPermissions();
    if (check.available === false) return false;
    const next = await NesioHealthKit.requestPermissions();
    return !!next.ok;
  } catch {
    return false;
  }
}

/** 授权并拉取指标,成功则写入 health-store。 */
export async function syncHealthKitToStore(days = 30): Promise<{
  ok: boolean;
  reason?: string;
  metrics?: HealthMetrics;
}> {
  if (!isNativePlatform()) {
    return { ok: false, reason: 'web_unsupported' };
  }
  try {
    const allowed = await requestHealthKitAccess();
    if (!allowed) return { ok: false, reason: 'denied' };
    const res = await NesioHealthKit.fetchMetrics({ days });
    if (!res?.ok || !Array.isArray(res.metrics)) {
      return { ok: false, reason: res?.reason || 'fetch_failed' };
    }
    const metrics: HealthMetrics = {
      metrics: res.metrics,
      workouts: typeof res.workouts === 'number' ? res.workouts : 0,
      importedAt: res.importedAt || new Date().toISOString(),
    };
    saveHealthMetrics(metrics);
    return { ok: true, metrics };
  } catch {
    return { ok: false, reason: 'sync_failed' };
  }
}
