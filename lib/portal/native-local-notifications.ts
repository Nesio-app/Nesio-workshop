/**
 * 本地通知 —— 自研 NesioLocalNotify。壳内走原生 UNUserNotificationCenter。
 * 纯本地:不经服务器、不走 APNs、不需要推送证书。
 *
 * ## 壳这一版能做什么(2026-07-31 从 Nesioshellfix.ipa 里核过)
 *
 * 原生侧只有三个方法:`checkPermissions` / `requestPermissions` / `schedule`。
 * `schedule` 收的是 **afterSec(相对秒数)** 和一个 `id`。就这些。
 *
 * 由此来的两条约束,别绕过去,也别假装没有:
 *
 * ① **没有绝对时刻,只有「多少秒之后」。** 所以每次要排程都得用「目标时刻 − 此刻」
 *    现算。好处反而对了一半:App 每次回前台重排一遍,你飞去另一个时区,
 *    「每天早上 9 点」自然就跟着当地的 9 点走 —— 因为 `at` 存的是墙上时钟
 *    (见 schedule-reminders.ts 顶部那段),`new Date()` 按设备当前时区解释它。
 *
 * ② **cancel 分两代壳。**(2026-07-31 更新)
 *    新壳有 `cancel(id)` / `cancelAll()` / `listPending()`,撤就是真的撤。
 *    老壳(手机上那个 Nesioshellfix.ipa)没有,只能退回 workaround:
 *    用同一个 id 重排到很远的将来 —— iOS 对相同 identifier 是**替换**而不是新增,
 *    所以那条就永远不会响了。代价是系统里留下一条永不触发的排程,
 *    占着 64 条配额里的一格。
 *    `tombstoneScheduled()` 会**先探新壳的 cancel**,探不到才写墓碑。
 *    调用方不用关心走的是哪条。
 *
 * ③ iOS 每个 App 最多 **64 条** pending 通知。超了以后新的排不进去(静默失败)。
 *    所以排程方只排一个近期窗口,见 reminder-notifications.ts。
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
  /** ↓ 新壳才有。老壳上这些是 undefined —— 每个调用点都要先探再用。 */
  cancel?: (opts: { id: number }) => Promise<{ ok?: boolean }>;
  cancelAll?: () => Promise<{ ok?: boolean }>;
  listPending?: () => Promise<{ items?: Array<{ id: number; title: string; at: number | null }>; count?: number; limit?: number }>;
};

/** iOS 每个 App 的 pending 通知上限。超了新的静默排不进去。 */
export const IOS_PENDING_LIMIT = 64;

/**
 * 稳定地把一个字符串 id 折成正整数 —— 原生侧的 id 是数字。
 *
 * 必须**稳定**:同一条提醒每次算出来必须是同一个数,否则「改时间」会变成
 * 「多排一条」,而旧的那条照样会响。用 FNV-1a,同串同值、分布够散。
 */
export function notifyIdOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 取正,并留在 int32 内 —— Swift 侧按 Int 收
  return (h >>> 0) % 2_000_000_000;
}

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

/**
 * 排一条到**某个时刻**的通知。
 *
 * 内部折成 afterSec —— 壳只认相对秒数(见文件头 ①)。
 * 已经过去的时刻不排:补一条「本该昨天响」的通知只会吓人一跳。
 */
export async function scheduleLocalAt(opts: {
  /** 业务侧的稳定 key(例如 reminder id)。同 key 重排 = 替换,不是新增。 */
  key: string;
  title: string;
  body: string;
  at: Date;
  now?: Date;
}): Promise<{ ok: boolean; reason?: string }> {
  const afterSec = Math.round((opts.at.getTime() - (opts.now ?? new Date()).getTime()) / 1000);
  if (afterSec < 1) return { ok: false, reason: 'in_past' };
  return scheduleLocalAlert({
    title: opts.title,
    body: opts.body,
    afterSec,
    id: notifyIdOf(opts.key),
  });
}

/**
 * 撤掉一条已排的通知。
 *
 * ## 两条路,先走真的那条
 *
 * **新壳**(2026-07-31 起,带 `NesioLocalNotifyPlugin.cancel`)直接撤,干净利落。
 *
 * **老壳**没有 cancel,只能退回原来那个 workaround:用同一个 id 重排到十年后 ——
 * iOS 对相同 identifier 是**替换**,于是原来那条到点就不会响了。
 * 代价是系统里留下一条永不触发的排程,占着 64 条配额里的一格。
 *
 * 名字保留 `tombstoneScheduled` 是因为调用方不该关心走的是哪条 ——
 * 它要的只是「这条别响了」。等确认没人还在用老壳,再把下面那半段删掉。
 */
export async function tombstoneScheduled(key: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePlatform()) return { ok: false, reason: 'web_unsupported' };
  const id = notifyIdOf(key);
  try {
    if (typeof NesioLocalNotify.cancel === 'function') {
      const r = await NesioLocalNotify.cancel({ id });
      if (r?.ok) return { ok: true };
      // 新壳的 cancel 说没成 —— 别掉头去写墓碑,那会掩盖一个真问题。
      return { ok: false, reason: 'cancel_failed' };
    }
  } catch {
    // 插件里没这个方法时 Capacitor 会抛。落到下面的 workaround。
  }
  const TEN_YEARS_SEC = 10 * 365 * 24 * 3600;
  return scheduleLocalAlert({
    title: ' ',
    body: ' ',
    afterSec: TEN_YEARS_SEC,
    id,
  });
}

/**
 * 系统里现在排着哪些 —— **真相在系统那边**。
 *
 * 有了它,`reminder-notifications` 那份 `nesio-reminder-notify-state-v1` 簿记
 * 就不再是唯一依据:簿记会有记错的一天(写失败、换设备、手动清缓存),
 * 系统不会。老壳上返回 null,调用方继续用簿记。
 */
export async function listPendingNotifications(): Promise<
  null | { ids: number[]; count: number; limit: number }
> {
  if (!isNativePlatform()) return null;
  try {
    if (typeof NesioLocalNotify.listPending !== 'function') return null;
    const r = await NesioLocalNotify.listPending();
    const items = Array.isArray(r?.items) ? r.items : [];
    return {
      ids: items.map((it) => it.id).filter((n) => Number.isFinite(n)),
      count: r?.count ?? items.length,
      limit: r?.limit ?? IOS_PENDING_LIMIT,
    };
  } catch {
    return null;
  }
}

/** 这版壳带没带真的 cancel。UI 想解释「为什么删了还占一格」时用得上。 */
export function hasNativeCancel(): boolean {
  return typeof NesioLocalNotify.cancel === 'function';
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
