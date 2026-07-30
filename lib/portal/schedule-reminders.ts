/**
 * schedule-reminders —— 我自己设的、有明确时间的提醒(2026-07-30 用户要求:
 * 「日程里面可以增加我明确设置时间的提醒项目么,比如家务活,比如账单 due 等」)。
 *
 * 这件事和 2026-07-28 那条「周期提醒、还款、缴费、课程、家务项目不显示」不矛盾,
 * 两者的分界线是**谁设的**:
 *   · 从待办 App 当日历同步进来的循环任务 —— 那是一张 checklist,混在日程里会把
 *     真正要赴的约会淹掉,继续挡在门外(SchedulePanel 的 CHORE_RE);
 *   · **用户自己在这一页敲进去的** —— 他亲手写了时间,那就是他要看见的东西,
 *     一个字都不许被关键词过滤吃掉。
 * 所以这些提醒**不走** life-graph、不走 CHORE_RE,单独一处存储、单独一段列表。
 *
 * 时间存的是**墙上时钟**(YYYY-MM-DDTHH:mm,本地,不带时区),不是 UTC ISO。
 * 「每月 15 号早上 9 点交房租」是一件关于钟面的事 —— 折成 UTC 再折回来,
 * 换个时区或碰上夏令时就会漂成 8 点。<input type="datetime-local"> 给的正是这个格式。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const SCHEDULE_REMINDERS_KEY = 'nesio-schedule-reminders-v1';
export const SCHEDULE_REMINDERS_EVENT = 'nesio-schedule-reminders-updated';

export type ReminderKind = 'chore' | 'bill' | 'other';
export const REMINDER_KINDS: ReminderKind[] = ['chore', 'bill', 'other'];

export interface Reminder {
  id: string;
  title: string;
  /** 墙上时钟:`YYYY-MM-DDTHH:mm`(本地时间,无时区)。 */
  at: string;
  kind: ReminderKind;
  note?: string;
  /** 每 N 天重复(和 everyMonths 二选一;都不填 = 只此一次)。 */
  everyDays?: number;
  /** 每 N 个月重复。月末对齐:1/31 + 1 月 = 2/28,不是 3/3。 */
  everyMonths?: number;
  /** 只此一次的那种,做完打个勾。重复的那种做完是往后滚,不留勾。 */
  doneAt?: string;
  createdAt: string;
}

const store = createBlobStore<Reminder[]>({
  key: SCHEDULE_REMINDERS_KEY,
  updateEvent: SCHEDULE_REMINDERS_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function scheduleRemindersReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

/* ── 纯时间计算(可单测,不碰存储)──────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` → Date(按本地时间解释)。解析不出来返回 null。 */
export function parseWallClock(at: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((at || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatWallClock(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 往后推一个周期。月推按**月末对齐**(1/31 + 1 月 = 2/28)。 */
function advanceOnce(d: Date, everyDays?: number, everyMonths?: number): Date | null {
  if (everyMonths && everyMonths > 0) {
    const target = new Date(d.getFullYear(), d.getMonth() + everyMonths, 1, d.getHours(), d.getMinutes());
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), lastDay));
    return target;
  }
  if (everyDays && everyDays > 0) {
    const target = new Date(d);
    target.setDate(target.getDate() + everyDays);
    return target;
  }
  return null;
}

/**
 * 下一次是什么时候。
 *
 * 关键:一路推到**真的在 now 之后**为止,不是简单地 +1 个周期。
 * 一张月账单落下三个月才想起来点「做好了」,推一次还是过去的时刻 —— 那条提醒
 * 会立刻又显示成「还没处理」,点几次才能追上。空转封顶 400 次,防脏数据死循环。
 */
export function nextOccurrence(at: string, everyDays?: number, everyMonths?: number, now = new Date()): string | null {
  const base = parseWallClock(at);
  if (!base) return null;
  let cur = advanceOnce(base, everyDays, everyMonths);
  if (!cur) return null;
  for (let i = 0; i < 400 && cur.getTime() <= now.getTime(); i += 1) {
    const next = advanceOnce(cur, everyDays, everyMonths);
    if (!next) break;
    cur = next;
  }
  return formatWallClock(cur);
}

/* ── 存储 ──────────────────────────────────────────────────────────── */

function sanitize(r: unknown): Reminder | null {
  const x = r as Partial<Reminder> | null;
  if (!x || typeof x.id !== 'string' || typeof x.title !== 'string' || !parseWallClock(String(x.at))) return null;
  return {
    id: x.id,
    title: x.title,
    at: String(x.at),
    kind: REMINDER_KINDS.includes(x.kind as ReminderKind) ? (x.kind as ReminderKind) : 'other',
    ...(x.note ? { note: String(x.note) } : {}),
    ...(x.everyDays ? { everyDays: Number(x.everyDays) } : {}),
    ...(x.everyMonths ? { everyMonths: Number(x.everyMonths) } : {}),
    ...(x.doneAt ? { doneAt: String(x.doneAt) } : {}),
    createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
  };
}

/** 全部提醒,按时间由近到远。做完的一次性提醒排在最后。 */
export function listReminders(): Reminder[] {
  const raw = store.load();
  const all = (Array.isArray(raw) ? raw : []).map(sanitize).filter((r): r is Reminder => r !== null);
  return all.sort((a, b) => {
    if (Boolean(a.doneAt) !== Boolean(b.doneAt)) return a.doneAt ? 1 : -1;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
}

export function addReminder(input: {
  title: string; at: string; kind?: ReminderKind; note?: string;
  everyDays?: number; everyMonths?: number;
}): Reminder | null {
  const title = input.title.trim();
  if (!title || !parseWallClock(input.at)) return null;
  const r: Reminder = {
    id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    at: input.at,
    kind: input.kind && REMINDER_KINDS.includes(input.kind) ? input.kind : 'other',
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.everyDays && input.everyDays > 0 ? { everyDays: input.everyDays } : {}),
    ...(input.everyMonths && input.everyMonths > 0 ? { everyMonths: input.everyMonths } : {}),
    createdAt: new Date().toISOString(),
  };
  store.save([...listReminders(), r].slice(0, 500));
  return r;
}

export function removeReminder(id: string): void {
  store.save(listReminders().filter((r) => r.id !== id));
}

/**
 * 「做好了」。重复的往后滚到下一次(不留痕);一次性的打勾留在列表末尾 ——
 * 立刻消失会让人怀疑自己有没有点到,而且没有反悔的余地。
 */
export function completeReminder(id: string, now = new Date()): Reminder | null {
  const all = listReminders();
  const hit = all.find((r) => r.id === id);
  if (!hit) return null;
  const next = nextOccurrence(hit.at, hit.everyDays, hit.everyMonths, now);
  const updated: Reminder = next
    ? { ...hit, at: next, doneAt: undefined }
    : { ...hit, doneAt: now.toISOString() };
  store.save(all.map((r) => (r.id === id ? updated : r)));
  return updated;
}

/** 取消打勾(一次性提醒点错了)。 */
export function reopenReminder(id: string): void {
  store.save(listReminders().map((r) => (r.id === id ? { ...r, doneAt: undefined } : r)));
}
