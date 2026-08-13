/**
 * surface-notifications —— 时间线日程 / 今天焦点到期 / 日报 / 回顾 → 系统通知。
 *
 * 以前只有 schedule-reminders（用户亲手「设成提醒」）和家务/车会排系统通知。
 * 时间线上的会议、焦点卡里的到期、早报就绪、周月回顾，到点都不响。
 * 这一层把它们补上；类目开关在 notify-prefs。
 */
import { getLifeGraph, type LifeNode } from './life-graph';
import { loadProfileSettings } from './profile';
import { scheduleLocalAt, tombstoneScheduled } from './native-local-notifications';
import { logDropped } from './storage-health';
import type { PlannedNotification } from './reminder-notifications';

export const SURFACE_NOTIFY_STATE_KEY = 'nesio-surface-notify-state-v1';

const WINDOW_DAYS = 14;
const MAX_TIMELINE = 20;
const MAX_FOCUS = 15;

function loadKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(SURFACE_NOTIFY_STATE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function saveKeys(keys: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SURFACE_NOTIFY_STATE_KEY, JSON.stringify(keys)); }
  catch (err) { logDropped('surface-notify.state', err); }
}

function wallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseAttrDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length < 10) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : new Date(v);
  if (Number.isNaN(d.getTime()) || d.getFullYear() <= 2020) return null;
  return d;
}

function pickDate(attrs: Record<string, unknown>, keys: string[]): Date | null {
  for (const k of keys) {
    const d = parseAttrDate(attrs[k]);
    if (d) return d;
  }
  return null;
}

function isDone(n: LifeNode): boolean {
  return n.attributes?.done === true || n.attributes?.done === 'true';
}

/** 时间线：日历/会议/带 start 的日程事件。 */
export function planTimelineNotifications(
  nodes: readonly LifeNode[],
  now: Date = new Date(),
  max = MAX_TIMELINE,
): PlannedNotification[] {
  const horizon = now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000;
  const out: PlannedNotification[] = [];
  for (const n of nodes) {
    if (isDone(n)) continue;
    if (n.type !== 'event' && n.type !== 'task') continue;
    const tags = n.tags || [];
    const isCal = n.source === 'calendar' || tags.includes('meeting-notes') || tags.includes('granola')
      || Boolean(n.attributes?.calendarNodeId || n.attributes?.htmlLink);
    if (!isCal && n.type !== 'event') continue;
    const when = pickDate(n.attributes as Record<string, unknown>, ['start', 'date', 'datetime', 'occurredAt']);
    if (!when) continue;
    if (when.getTime() <= now.getTime() || when.getTime() > horizon) continue;
    const title = (n.name || '').trim() || '日程';
    out.push({
      key: `timeline:${n.id}:${wallClock(when)}`,
      title,
      body: '快开始了 —— 打开今天页可看详情。',
      at: when,
    });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, max);
}

/** 今天焦点 / 到期：dueDate 或 focusPinnedOn=今天，且尚未完成。
 *
 * 红线:不要用「now+90s」当 key 的一部分 —— App 每次回前台重排都会换新 afterSec,
 * wallClock(at) 跟着变 → 同一条待办一天被排十几次(真机「到期提醒」刷屏的根因)。
 * key 按「节点 + 到期日」稳定;同一天只补一次 catch-up。
 */
export function planFocusDueNotifications(
  nodes: readonly LifeNode[],
  now: Date = new Date(),
  max = MAX_FOCUS,
): PlannedNotification[] {
  const today = dayKey(now);
  const horizon = now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000;
  const out: PlannedNotification[] = [];
  for (const n of nodes) {
    if (isDone(n)) continue;
    // 用户点过/关掉的到期提醒 —— 当天内不再排。
    if (isFocusDismissed(n.id, today)) continue;
    const pinned = n.attributes?.focusPinnedOn === today;
    const due = pickDate(n.attributes as Record<string, unknown>, ['dueDate', 'deadline', 'due', 'end']);
    if (!pinned && !due) continue;

    // 过期且不是今天 → 不再响(过期的就不该再出现)。
    if (due && dayKey(due) < today && !pinned) continue;

    let at: Date;
    let keyDay = today;
    if (due && due.getTime() > now.getTime() && due.getTime() <= horizon) {
      at = due;
      keyDay = dayKey(due);
    } else if (pinned) {
      at = new Date(`${today}T10:00:00`);
      if (at.getTime() <= now.getTime()) {
        // 已过 10:00:只排一次补响(固定到 10:05,别跟 now 漂移)
        at = new Date(`${today}T10:05:00`);
        if (at.getTime() <= now.getTime()) continue; // 过了补响窗就不再刷
      }
    } else if (due && dayKey(due) === today && due.getTime() <= now.getTime()) {
      // 今天到期但时刻已过:当天 固定补响一次,不跟 now 漂移
      at = new Date(`${today}T10:05:00`);
      if (at.getTime() <= now.getTime()) at = new Date(`${today}T18:00:00`);
      if (at.getTime() <= now.getTime()) continue;
      keyDay = today;
    } else {
      continue;
    }
    const title = (n.name || '').trim() || '今天待办';
    out.push({
      key: `focus:${n.id}:${keyDay}`,
      title,
      body: pinned ? '钉在今天的事 —— 打开看看。' : '到期提醒。',
      at,
      deepLink: { kind: 'memory', id: n.id },
    });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, max);
}

const FOCUS_DISMISS_KEY = 'nesio-focus-notify-dismissed-v1';

function isFocusDismissed(nodeId: string, day: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = JSON.parse(localStorage.getItem(FOCUS_DISMISS_KEY) || '{}') as Record<string, string>;
    return raw[nodeId] === day;
  } catch { return false; }
}

/** 用户点过这条到期提醒 / 打开详情 → 当天不再排。 */
export function dismissFocusNotification(nodeId: string, day = dayKey()): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = JSON.parse(localStorage.getItem(FOCUS_DISMISS_KEY) || '{}') as Record<string, string>;
    raw[nodeId] = day;
    // 只留近 14 天,避免簿记无限涨
    const cut = dayKey(new Date(Date.now() - 14 * 86_400_000));
    for (const [k, d] of Object.entries(raw)) if (d < cut) delete raw[k];
    localStorage.setItem(FOCUS_DISMISS_KEY, JSON.stringify(raw));
  } catch { /* quota */ }
}

/** 日报：当天 08:05 提醒「日报好了」（开关开着才排）。 */
export function planDailyReportNotification(
  enabled: boolean,
  now: Date = new Date(),
): PlannedNotification | null {
  if (!enabled) return null;
  const today = dayKey(now);
  let at = new Date(`${today}T08:05:00`);
  if (at.getTime() <= now.getTime()) {
    // 过了 8:05 且今天还没排过 → 90 秒后补一条（只补一次，靠 key 去重）
    if (now.getHours() < 20) at = new Date(now.getTime() + 90_000);
    else return null;
  }
  return {
    key: `daily-report:${today}`,
    title: '今日日报好了',
    body: '打开今天页就能看 —— 轻轻看一眼就行。',
    at,
  };
}

/** 回顾：周一 09:15 周回顾；每月 1 号 09:15 月回顾。 */
export function planRetrospectNotifications(now: Date = new Date()): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const today = dayKey(now);
  // 周一 = 1
  if (now.getDay() === 1) {
    let at = new Date(`${today}T09:15:00`);
    if (at.getTime() <= now.getTime() && now.getHours() < 20) at = new Date(now.getTime() + 90_000);
    if (at.getTime() > now.getTime()) {
      out.push({
        key: `retrospect-week:${today}`,
        title: '本周回顾',
        body: '上周轻轻过了一遍 —— 今天页顶部可看。',
        at,
      });
    }
  }
  if (now.getDate() === 1) {
    let at = new Date(`${today}T09:15:00`);
    if (at.getTime() <= now.getTime() && now.getHours() < 20) at = new Date(now.getTime() + 120_000);
    if (at.getTime() > now.getTime()) {
      out.push({
        key: `retrospect-month:${today}`,
        title: '本月回顾',
        body: '上个月的样子 —— 今天页顶部可看。',
        at,
      });
    }
  }
  return out;
}

export type SurfaceNotifyKinds = {
  timeline: boolean;
  focusDue: boolean;
  dailyReport: boolean;
  retrospect: boolean;
};

export async function syncSurfaceNotifications(
  kinds: SurfaceNotifyKinds,
  now: Date = new Date(),
): Promise<{ scheduled: number; retired: number }> {
  const nodes = getLifeGraph();
  const planned: PlannedNotification[] = [];
  if (kinds.timeline) planned.push(...planTimelineNotifications(nodes, now));
  if (kinds.focusDue) planned.push(...planFocusDueNotifications(nodes, now));
  if (kinds.dailyReport) {
    const on = loadProfileSettings().dailyReportEnabled !== false;
    const d = planDailyReportNotification(on, now);
    if (d) planned.push(d);
  }
  if (kinds.retrospect) planned.push(...planRetrospectNotifications(now));

  const plannedKeys = new Set(planned.map((p) => p.key));
  const previous = loadKeys();
  let retired = 0;
  let scheduled = 0;
  for (const key of previous) {
    if (plannedKeys.has(key)) continue;
    const r = await tombstoneScheduled(key);
    if (r.ok) retired += 1;
  }
  // 深链登记:点通知 / 回前台启发式打开详情用。
  const { rememberNotifyDeepLinks } = await import('./notify-deep-link');
  rememberNotifyDeepLinks(planned);
  for (const p of planned) {
    const r = await scheduleLocalAt({ key: p.key, title: p.title, body: p.body, at: p.at, now });
    if (r.ok) scheduled += 1;
  }
  saveKeys([...plannedKeys]);
  return { scheduled, retired };
}
