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

/**
 * 开机/回前台**静默**拉一次健康数据。
 *
 * ## 和上面那个的区别只有一处,但很关键
 *
 * `syncHealthKitToStore` 第一句是 `requestHealthKitAccess()` —— 那会**弹系统权限框**。
 * 放到开机路径上就是:每次打开 App 都可能被 HealthKit 授权页糊一脸。
 * 所以这条**跳过 request,直接 fetch**:没授权的话 `fetchMetrics` 只会拿不到数据,
 * 不会弹任何东西。授权是用户在连接中心点「同步」时给的,那时弹才对得上他正在做的事。
 *
 * (HealthKit 还有个坑值得记一笔:读权限的 `authorizationStatus` **永远**返回
 * notDetermined —— Apple 故意的,防止 App 靠权限状态反推「这人有没有某种病的数据」。
 * 所以「先查一下授权了没」在 HealthKit 上根本不可靠,只能直接试。)
 *
 * ## 节流
 *
 * 一天一次。健康数据是按天聚的,一天里拉十遍拿到的是同一份;
 * 而每次 fetch 都要跨进程查 HealthKit 库,不便宜。
 */
export const HEALTHKIT_AUTO_SYNC_KEY = 'nesio-healthkit-auto-sync-v1';

export async function syncHealthKitQuietly(days = 30): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === 'undefined' || !isNativePlatform()) return { ok: false, reason: 'web_unsupported' };
  try {
    const last = localStorage.getItem(HEALTHKIT_AUTO_SYNC_KEY) || '';
    // 同一天不重复拉。用本地日期(YYYY-MM-DD)—— 这是件按天算的事,跟着钟面走。
    const today = new Date().toLocaleDateString('en-CA');
    if (last === today) return { ok: false, reason: 'already_today' };

    const res = await NesioHealthKit.fetchMetrics({ days });
    if (!res?.ok || !Array.isArray(res.metrics) || res.metrics.length === 0) {
      // 没授权 / 没数据 —— 都不是错误,是「今天这条路没东西可拿」。不写簿记,下次还试。
      return { ok: false, reason: res?.reason || 'no_data' };
    }
    saveHealthMetrics({
      metrics: res.metrics,
      workouts: typeof res.workouts === 'number' ? res.workouts : 0,
      importedAt: res.importedAt || new Date().toISOString(),
    });
    try { localStorage.setItem(HEALTHKIT_AUTO_SYNC_KEY, today); } catch { /* 簿记写不上只是会多拉一次 */ }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'sync_failed' };
  }
}
