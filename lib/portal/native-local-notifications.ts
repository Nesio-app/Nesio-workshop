/**
 * 本地通知 —— 自研 NesioLocalNotify(Xcode 15 可用)。
 * PWA 无可靠本地推送;壳内走原生 UNUserNotificationCenter。
 */

import { registerPlugin } from '@capacitor/core';
import { isNativePlatform } from './platform-capabilities';

type NesioLocalNotifyPlugin = {
  checkPermissions: () => Promise<{ display?: string }>;
  requestPermissions: () => Promise<{ display?: string }>;
  schedule: (opts: {
    title: string;
    body: string;
    afterSec?: number;
    id?: number;
  }) => Promise<{ ok?: boolean; reason?: string; id?: number }>;
};

const NesioLocalNotify = registerPlugin<NesioLocalNotifyPlugin>('NesioLocalNotify');

export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !isNativePlatform()) return false;
  try {
    const cur = await NesioLocalNotify.checkPermissions();
    if (cur.display === 'granted') return true;
    const next = await NesioLocalNotify.requestPermissions();
    return next.display === 'granted';
  } catch {
    return false;
  }
}

/** 立刻弹出一条本地通知(调试/自用提醒)。需已授权。 */
export async function scheduleLocalAlert(opts: {
  title: string;
  body: string;
  /** 几秒后弹出;默认 1 */
  afterSec?: number;
  id?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePlatform()) {
    return { ok: false, reason: 'web_unsupported' };
  }
  const allowed = await ensureLocalNotificationPermission();
  if (!allowed) return { ok: false, reason: 'denied' };
  try {
    const id = opts.id ?? (Math.floor(Date.now() % 1_000_000_000) + 1);
    const res = await NesioLocalNotify.schedule({
      title: opts.title,
      body: opts.body,
      afterSec: Math.max(1, opts.afterSec ?? 1),
      id,
    });
    return res?.ok ? { ok: true } : { ok: false, reason: res?.reason || 'schedule_failed' };
  } catch {
    return { ok: false, reason: 'schedule_failed' };
  }
}
