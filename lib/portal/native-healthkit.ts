/**
 * HealthKit 读桥 —— 自研 NesioHealthKit(Xcode 15 可用)。
 * 拉步数/睡眠/心率等 → 写入与导出 XML 同一套 health-store。
 */

import { registerPlugin } from '@capacitor/core';
import { isNativePlatform } from './platform-capabilities';
import type { HealthMetric, HealthMetrics } from './apple-health';
import { saveHealthMetrics } from './health-store';

/** 原生回来的一行,字段名照 Apple 导出的 `<Record …>`。 */
interface HealthSampleRow {
  type: string;
  sourceName: string;
  startDate: string;
  endDate: string;
  unit: string;
  value: string;
}

type NesioHealthKitPlugin = {
  checkPermissions: () => Promise<{ available?: boolean; read?: string }>;
  requestPermissions: () => Promise<{ ok?: boolean; reason?: string; read?: string }>;
  /** 老壳(Nesioshellfix.ipa)的路子:原生自己算好 HealthMetric[]。 */
  fetchMetrics?: (opts?: { days?: number }) => Promise<{
    ok?: boolean;
    reason?: string;
    metrics?: HealthMetric[];
    workouts?: number;
    importedAt?: string;
  }>;
  /** 新壳(2026-07-31)的路子:原样倒出样本,规则留在 JS。见下面那段。 */
  fetchSamples?: (opts?: { days?: number; perTypeCap?: number }) => Promise<{
    ok?: boolean;
    reason?: string;
    rows?: HealthSampleRow[];
    workouts?: number;
    importedAt?: string;
  }>;
};

const NesioHealthKit = registerPlugin<NesioHealthKitPlugin>('NesioHealthKit');

/**
 * ## 两代壳,两条路,同一个出口
 *
 * **老壳** `fetchMetrics` —— 原生侧自己把 33 条指标算好了送过来。
 * 问题是那套规则(单位换算 / iPhone+Watch 去重 / 脏值丢弃 / 睡眠区间合并 /
 * 按月序列 / 「最后一天残缺别当最新」)在原生里再实现一遍就会**和 JS 这份漂移**,
 * 而且每调一次规则都要重出 IPA。
 *
 * **新壳** `fetchSamples` —— 只把样本原样倒出来,字段名和 Apple 自己的
 * `export.xml` 一一对应。JS 这边拼回同样的文本,喂给**同一个**解析器
 * (`parseHealthMetrics`,手动导入 XML 走的也是它)。
 * 一份规则,两个入口,不会有两套逻辑各自漂移的那一天;
 * 而且以后调规则推一次部署就生效。
 *
 * 优先走新的,没有再退老的。两条都没有 → 这版壳没带健康。
 */
function rowsToAppleXml(rows: readonly HealthSampleRow[]): string {
  const esc = (s: string) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = rows.map((r) =>
    `<Record type="${esc(r.type)}" sourceName="${esc(r.sourceName)}" unit="${esc(r.unit)}"`
    + ` startDate="${esc(r.startDate)}" endDate="${esc(r.endDate)}" value="${esc(r.value)}"/>`);
  return `<HealthData>\n${lines.join('\n')}\n</HealthData>`;
}

/**
 * 拉一次并组装成 HealthMetrics。**不写存储、不弹权限** —— 纯取数,
 * 由调用方决定要不要落盘。两代壳都走这里。
 */
async function pullMetrics(days: number): Promise<{ ok: boolean; reason?: string; metrics?: HealthMetrics }> {
  // 新壳优先
  if (typeof NesioHealthKit.fetchSamples === 'function') {
    const res = await NesioHealthKit.fetchSamples({ days });
    if (!res?.ok || !Array.isArray(res.rows)) {
      return { ok: false, reason: res?.reason || 'fetch_failed' };
    }
    if (res.rows.length === 0) return { ok: false, reason: 'no_data' };
    const { parseHealthMetrics } = await import('./providers/apple-health');
    const parsed = parseHealthMetrics(rowsToAppleXml(res.rows));
    return {
      ok: true,
      metrics: {
        ...parsed,
        // 锻炼次数原生数得更准(它能直接查 workoutType,不用从文本里数标签)。
        workouts: typeof res.workouts === 'number' ? res.workouts : parsed.workouts,
        importedAt: res.importedAt || new Date().toISOString(),
      },
    };
  }

  // 老壳兜底
  if (typeof NesioHealthKit.fetchMetrics === 'function') {
    const res = await NesioHealthKit.fetchMetrics({ days });
    if (!res?.ok || !Array.isArray(res.metrics) || res.metrics.length === 0) {
      return { ok: false, reason: res?.reason || 'no_data' };
    }
    return {
      ok: true,
      metrics: {
        metrics: res.metrics,
        workouts: typeof res.workouts === 'number' ? res.workouts : 0,
        importedAt: res.importedAt || new Date().toISOString(),
      },
    };
  }

  return { ok: false, reason: 'plugin_missing' };
}

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
    const res = await pullMetrics(days);
    if (!res.ok || !res.metrics) return { ok: false, reason: res.reason || 'fetch_failed' };
    saveHealthMetrics(res.metrics);
    return { ok: true, metrics: res.metrics };
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

    const res = await pullMetrics(days);
    if (!res.ok || !res.metrics) {
      // 没授权 / 没数据 —— 都不是错误,是「今天这条路没东西可拿」。不写簿记,下次还试。
      return { ok: false, reason: res.reason || 'no_data' };
    }
    saveHealthMetrics(res.metrics);
    try { localStorage.setItem(HEALTHKIT_AUTO_SYNC_KEY, today); } catch { /* 簿记写不上只是会多拉一次 */ }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'sync_failed' };
  }
}
