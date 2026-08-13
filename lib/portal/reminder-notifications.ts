/**
 * reminder-notifications —— 把「我设的提醒」变成**到点真的会响**的系统通知。
 *
 * ## 之前是什么样
 *
 * `schedule-reminders` 让你设「每月 15 号早上 9 点交房租」,存得好好的,列表里也看得见 ——
 * 然后到了 15 号早上 9 点,什么都不会发生。你得自己打开 App 才看得到那一行。
 * 一个不会响的提醒不是提醒,是一张便签。
 *
 * 原生通知的桥(`native-local-notifications`)早就写好了,壳里也真有这个插件
 * (`NesioLocalNotify`,从 IPA 里核过),但全仓只有一处在用它 —— 授权定位之后
 * 发一条「通知可用」的自检。也就是说:能力在,一直没接到业务上。
 *
 * ## 这一层做什么
 *
 * 一个函数:`syncReminderNotifications()`。**幂等**,每次调用把该排的排上、
 * 该撤的撤掉。App 每次回前台调一次就够。
 *
 * ### 为什么是「每次重排」而不是「改的时候排一次」
 *
 * 三个理由,每一个单独都成立:
 *
 *   · 壳只认**相对秒数**(afterSec),不认绝对时刻。所以排程天然是「从此刻算」的,
 *     隔一天再看就得重算。
 *   · **时区**。`at` 存的是墙上时钟(`YYYY-MM-DDTHH:mm`,本地无时区)——
 *     「每天早上 9 点」说的是钟面,不是某个 UTC 瞬间。你飞去欧洲,它该在当地 9 点响。
 *     每次回前台按**当前**时区重算,这件事自动就对了;而如果只在创建时算一次并存成
 *     绝对时刻,你落地之后它会在凌晨三点响。
 *   · **重复提醒**是无限序列。只能滚动地排近期的那几次。
 *
 * ### 窗口和上限
 *
 * iOS 每个 App 最多 64 条 pending 通知,超了新的**静默**排不进去。
 * 所以只排 `WINDOW_DAYS` 天内、最多 `MAX_SCHEDULED` 条,按时间从近到远取。
 * 剩下的下次回前台再排 —— 反正那时它们也更近了。
 *
 * 留出的余量给两件事:别处可能也要排通知;以及 tombstone(见下)会占格子。
 */

import { listReminders, parseWallClock, nextOccurrence, type Reminder } from './schedule-reminders';
import {
  ensureLocalNotificationPermission,
  scheduleLocalAt,
  tombstoneScheduled,
  IOS_PENDING_LIMIT,
  checkLocalNotifyDisplay,
} from './native-local-notifications';
import { isNativePlatform } from './platform-capabilities';
import { logDropped } from './storage-health';

/** 只排这么多天以内的。够覆盖月账单(下一次一定在 31 天内)。 */
const WINDOW_DAYS = 35;
/** 排程条数上限。远低于 iOS 的 64 —— 余量留给 tombstone 和别处的通知。 */
const MAX_SCHEDULED = 40;

/**
 * 上次排了哪些 key。**不存这个就撤不掉** ——
 * 用户删了一条提醒,我们得知道「它曾经被排过」才谈得上去撤。
 *
 * 归类 `cache`:换台设备从零开始是**对的**。通知排程是设备本地的东西,
 * 旧手机上排过什么和新手机毫无关系;真相在提醒列表里,这只是它的投影。
 */
export const REMINDER_NOTIFY_STATE_KEY = 'nesio-reminder-notify-state-v1';

function loadScheduledKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(REMINDER_NOTIFY_STATE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function saveScheduledKeys(keys: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(REMINDER_NOTIFY_STATE_KEY, JSON.stringify(keys));
  } catch (err) {
    // 红线:存储写失败不许吞。写不上的后果是下次撤不掉旧通知(会响一条已删的)。
    logDropped('reminder-notify.state', err);
  }
}

/** 通知的 key:提醒 id + 这一次的时刻。时刻变了 = 换一条排程,旧的那条要撤。 */
export function notifyKeyOf(reminderId: string, at: string): string {
  return `reminder:${reminderId}:${at}`;
}

export interface PlannedNotification {
  key: string;
  title: string;
  body: string;
  at: Date;
}

/**
 * 算出「现在该排哪些」。**纯函数,可单测** —— 不碰存储、不碰原生。
 *
 * 一次性提醒:打过勾(doneAt)的不排。
 * 重复提醒:`at` 已经过去就滚到下一次(`nextOccurrence` 会一路推到真的在未来)。
 * 这里**不**改写提醒本身 —— 滚动是显示层和排程层各自算的,写回去会和别处打架。
 */
export function planReminderNotifications(
  reminders: readonly Reminder[],
  now: Date = new Date(),
  windowDays: number = WINDOW_DAYS,
  max: number = MAX_SCHEDULED,
): PlannedNotification[] {
  const horizon = now.getTime() + windowDays * 24 * 3600 * 1000;
  const out: PlannedNotification[] = [];

  for (const r of reminders) {
    const repeats = Boolean(r.everyDays || r.everyMonths);
    // 一次性 + 已完成 → 不排。重复的没有「完成」这回事(做完是往后滚)。
    if (!repeats && r.doneAt) continue;

    let atStr = r.at;
    let when = parseWallClock(atStr);
    if (!when) continue;

    if (when.getTime() <= now.getTime()) {
      if (!repeats) continue;                       // 一次性且已过期:补响没有意义
      const next = nextOccurrence(r.at, r.everyDays, r.everyMonths, now);
      if (!next) continue;
      atStr = next;
      when = parseWallClock(next);
      if (!when) continue;
    }

    if (when.getTime() > horizon) continue;         // 太远,下次回前台再说

    out.push({
      key: notifyKeyOf(r.id, atStr),
      title: r.title,
      // 正文用 note;没有就留一句和标题不重复的 —— 通知里两行一模一样很蠢。
      body: (r.note || '').trim() || KIND_BODY[r.kind] || '',
      at: when,
    });
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, max);
}

const KIND_BODY: Record<string, string> = {
  chore: '到点了 —— 想先做别的也行。',
  bill: '到期提醒。',
  event: '快开始了。',
  other: '你设的提醒到点了。',
};

export interface SyncResult {
  ok: boolean;
  /** 排上了几条。 */
  scheduled: number;
  /** 撤掉了几条(用户删了/改了时间/做完了)。 */
  retired: number;
  /** 没做成的原因。ok=false 时一定有。 */
  reason?: 'not_native' | 'denied' | 'no_permission_ask' | 'failed' | 'plugin_missing';
}

/**
 * 把提醒同步成系统通知。**幂等** —— 想调多少次调多少次。
 *
 * @param opts.askPermission 是否可以弹权限。默认 false ——
 *   开机自动跑的时候不该突然弹一个系统弹窗;用户在提醒页真的设了一条,那时才问。
 */
export async function syncReminderNotifications(
  opts: { askPermission?: boolean; now?: Date } = {},
): Promise<SyncResult> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    // 网页版没有可靠的本地定时通知。不假装排上了。
    return { ok: false, scheduled: 0, retired: 0, reason: 'not_native' };
  }

  const granted = opts.askPermission
    ? await ensureLocalNotificationPermission()
    : await hasPermissionQuietly();
  if (!granted) {
    return { ok: false, scheduled: 0, retired: 0, reason: opts.askPermission ? 'denied' : 'no_permission_ask' };
  }

  const now = opts.now ?? new Date();
  const planned = planReminderNotifications(listReminders(), now);
  const plannedKeys = new Set(planned.map((p) => p.key));
  const previous = loadScheduledKeys();

  let scheduled = 0;
  let retired = 0;

  // ① 撤掉不再需要的。先撤再排 —— 反过来的话,先排到 64 满了,撤的那几条腾出的
  //    格子就用不上了(而且 iOS 排不进去是**静默**的,你根本不会知道少了哪条)。
  for (const key of previous) {
    if (plannedKeys.has(key)) continue;
    const r = await tombstoneScheduled(key);
    if (r.ok) retired += 1;
  }

  // ② 排上该排的。同 key 重排 = 替换,所以重复调用不会翻倍。
  for (const p of planned) {
    const r = await scheduleLocalAt({ key: p.key, title: p.title, body: p.body, at: p.at, now });
    if (r.ok) scheduled += 1;
  }

  saveScheduledKeys([...plannedKeys]);
  return { ok: true, scheduled, retired };
}

/** 已经授权了吗 —— **不弹窗**。开机自动跑的那条路用这个。 */
async function hasPermissionQuietly(): Promise<boolean> {
  // 必须走 registerPlugin 那条桥(checkLocalNotifyDisplay)。
  // 以前读 Capacitor.Plugins.NesioLocalNotify —— 自研插件不在那里,
  // 结果「试一条」能响、真实提醒同步永远 no_permission_ask。
  const d = await checkLocalNotifyDisplay();
  return d === 'granted';
}

/** 给设置/调试页看的:iOS 上限是多少、我们最多排多少。 */
export const NOTIFY_LIMITS = { iosPending: IOS_PENDING_LIMIT, ourMax: MAX_SCHEDULED, windowDays: WINDOW_DAYS };
