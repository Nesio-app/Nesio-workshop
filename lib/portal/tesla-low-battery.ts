/**
 * tesla-low-battery —— 电量低于阈值时提醒充电(2026-08-10)。
 *
 * 车页拉到 charge_state 后调用。壳内走 NesioLocalNotify;Web 只显示横幅。
 * 同一辆车同一天最多弹一次系统通知(cache key),避免刷屏。
 */

import { scheduleLocalAlert } from './native-local-notifications';
import { isNativePlatform } from './platform-capabilities';
import { logDropped } from './storage-health';

export const TESLA_LOW_BATTERY_PCT = 40;
export const TESLA_LOW_BATT_NOTIFIED_KEY = 'nesio-tesla-low-batt-notified-v1';

const CHARGING = new Set(['Charging', 'Starting', 'Complete']);

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadNotified(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(TESLA_LOW_BATT_NOTIFIED_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw as Record<string, string> : {};
  } catch { return {}; }
}

function saveNotified(map: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TESLA_LOW_BATT_NOTIFIED_KEY, JSON.stringify(map));
  } catch (err) {
    logDropped('tesla-low-batt', err);
  }
}

export type LowBatteryRow = {
  vehicleId: string;
  displayName?: string;
  batteryLevel: number;
  chargingState?: string;
};

/** 哪些车此刻需要「该充电了」提示(未在充 / 未充满)。 */
export function listLowBatteryVehicles(rows: readonly LowBatteryRow[]): LowBatteryRow[] {
  return rows.filter((r) => {
    if (!(r.batteryLevel < TESLA_LOW_BATTERY_PCT)) return false;
    const st = r.chargingState || '';
    if (CHARGING.has(st)) return false;
    return true;
  });
}

/**
 * 系统通知(原生壳)。同一车同一天只发一次。
 * 返回发出去的车 id 列表。
 */
export async function notifyTeslaLowBattery(
  rows: readonly LowBatteryRow[],
  opts?: { zh?: boolean },
): Promise<string[]> {
  const low = listLowBatteryVehicles(rows);
  if (!low.length) return [];
  if (!isNativePlatform()) return [];

  const notified = loadNotified();
  const today = dayKey();
  const sent: string[] = [];
  const zh = opts?.zh !== false;

  for (const r of low) {
    if (notified[r.vehicleId] === today) continue;
    const name = r.displayName || 'Tesla';
    const title = zh ? '该充电了' : 'Time to charge';
    const body = zh
      ? `${name} 电量 ${Math.round(r.batteryLevel)}%(低于 ${TESLA_LOW_BATTERY_PCT}%)—— 找个桩补一点更安心。`
      : `${name} is at ${Math.round(r.batteryLevel)}% (under ${TESLA_LOW_BATTERY_PCT}%). A short charge would help.`;
    const res = await scheduleLocalAlert({
      title,
      body,
      afterSec: 2,
      // 稳定 id:同一车每天同一槽,避免堆多条
      id: 740_000 + (Math.abs(hashStr(r.vehicleId)) % 9_000),
    });
    if (res.ok) {
      notified[r.vehicleId] = today;
      sent.push(r.vehicleId);
    }
  }
  if (sent.length) saveNotified(notified);
  return sent;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
