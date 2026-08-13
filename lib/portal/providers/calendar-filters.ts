import type { CalendarEvent } from '../types';
import { USER_TIME_ZONE } from '../user-timezone';

const LUNAR_CALENDAR_RE =
  /农历|阴历|lunar|chinese\s*lunar|节气和节日|传统节日|chinese\s*holiday|huang\s*li|黄历/i;

/** True when the whole feed is a lunar/huangli calendar. */
export function isLunarCalendarName(calendarName = ''): boolean {
  return LUNAR_CALENDAR_RE.test(calendarName.trim());
}

/** True for per-day lunar markers, not real user events. */
export function isLunarEventTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/农历|阴历|\bLunar\b/i.test(t)) return true;
  if (/^(今日)?农历/.test(t)) return true;

  // Pure lunar date only — e.g. 五月初五、腊月廿三
  if (
    /^(闰)?[正一二三四五六七八九十冬腊]{1,2}月(初[一二三四五六七八九十]|十[一二三四五六七八九]|廿[一二三四五六七八九十]|二十[一二三四五六七八九]?|三十)$/.test(
      t,
    )
  ) {
    return true;
  }

  // Solar-term-only rows sometimes synced from lunar feeds
  if (
    /^(立春|雨水|惊蛰|春分|清明|谷雨|立夏|小满|芒种|夏至|小暑|大暑|立秋|处暑|白露|秋分|寒露|霜降|立冬|小雪|大雪|冬至|小寒|大寒)$/.test(
      t,
    )
  ) {
    return true;
  }

  // Standalone lunar day markers from Google lunar feeds — e.g. 廿六、初十
  if (
    /^(初[一二三四五六七八九十]|十[一二三四五六七八九]|廿[一二三四五六七八九十]|二十[一二三四五六七八九]?|三十)$/.test(
      t,
    )
  ) {
    return true;
  }

  // Lunar day + festival/term — e.g. 初五 端午、廿三 小暑
  if (
    /^(闰)?(初[一二三四五六七八九十]|十[一二三四五六七八九]|廿[一二三四五六七八九十]|二十[一二三四五六七八九]?|三十)\s+\S/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** UID patterns from embedded Chinese lunar calendar feeds. */
export function isLunarEventId(id = ''): boolean {
  const s = id.trim();
  if (!s) return false;
  return /lc@infinet\.github\.io|@lunar\.|huangli|chinese.?lunar/i.test(s);
}

export function isLunarEvent(
  title: string,
  calendarName = '',
  id = '',
): boolean {
  if (isLunarCalendarName(calendarName)) return true;
  if (isLunarEventId(id)) return true;
  return isLunarEventTitle(title);
}

// 个人版固定纽约:日历事件按纽约的「天」归组,避免 +12h 时区把事件分到错误日期。
const DEFAULT_CALENDAR_TZ = USER_TIME_ZONE;

/** YYYY-MM-DD in the given IANA timezone. */
export function calendarDayKey(date: Date, timeZone = DEFAULT_CALENDAR_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Calendar date for an event (all-day uses ICS date, not TZ-shifted instant). */
export function eventStartDayKey(
  event: CalendarEvent,
  timeZone = DEFAULT_CALENDAR_TZ,
): string {
  if (event.allDay && event.start.length >= 10) {
    return event.start.slice(0, 10);
  }
  return calendarDayKey(new Date(event.start), timeZone);
}

function eventEndMs(event: CalendarEvent, timeZone = DEFAULT_CALENDAR_TZ): number {
  if (event.end) return new Date(event.end).getTime();
  if (event.allDay) {
    const dayKey = eventStartDayKey(event, timeZone);
    const [y, m, d] = dayKey.split('-').map(Number);
    return Date.UTC(y, m - 1, d + 1) - 1;
  }
  return new Date(event.start).getTime() + 3_600_000;
}

/** Keep only events on today or tomorrow that have not ended yet. */
export function filterTodayAndTomorrowEvents(
  events: CalendarEvent[],
  at = new Date(),
  timeZone = DEFAULT_CALENDAR_TZ,
): CalendarEvent[] {
  const todayKey = calendarDayKey(at, timeZone);
  const tomorrowKey = addCalendarDays(todayKey, 1);
  const nowMs = at.getTime();

  return events
    .filter((event) => {
      const startKey = eventStartDayKey(event, timeZone);
      if (startKey !== todayKey && startKey !== tomorrowKey) return false;
      return eventEndMs(event, timeZone) > nowMs;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function formatEventDayLabel(
  event: CalendarEvent,
  at = new Date(),
  timeZone = DEFAULT_CALENDAR_TZ,
): string {
  const startKey = eventStartDayKey(event, timeZone);
  const todayKey = calendarDayKey(at, timeZone);
  const tomorrowKey = addCalendarDays(todayKey, 1);
  if (startKey === todayKey) return '今天';
  if (startKey === tomorrowKey) return '明天';
  return new Date(event.start).toLocaleDateString('zh-CN', {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export function mergeCalendarEvents(
  lists: CalendarEvent[][],
  limit = 5,
): CalendarEvent[] {
  const seen = new Set<string>();
  const merged: CalendarEvent[] = [];

  for (const list of lists) {
    for (const ev of list) {
      if (isLunarEvent(ev.title, ev.calendarName, ev.id)) continue;
      const key = `${ev.title}|${ev.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(ev);
    }
  }

  return merged
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, limit);
}

/** 拉日历给会议挂档:过去 35 天(Granola last_30_days)+ 未来仍按 80 条。 */
const DAY_MS = 86_400_000;
export const CAL_PAST_MS = 35 * DAY_MS;
export const CAL_FUTURE_LIMIT = 80;
export const CAL_PAST_LIMIT = 150;

/**
 * 合并去重之后再切窗口。不能对「过去+未来」整表 slice(80):
 * 按开始时间排序的话 80 条会全是过去,今天页的即将开始会被挤掉。
 */
export function windowCalendarEvents(
  events: readonly CalendarEvent[],
  now = Date.now(),
): CalendarEvent[] {
  const pastMin = now - CAL_PAST_MS;
  const past: CalendarEvent[] = [];
  const future: CalendarEvent[] = [];
  for (const ev of events) {
    const t = new Date(ev.start).getTime();
    if (!Number.isFinite(t) || t < pastMin) continue;
    if (t < now) past.push(ev);
    else future.push(ev);
  }
  past.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  future.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return [...past.slice(-CAL_PAST_LIMIT), ...future.slice(0, CAL_FUTURE_LIMIT)];
}
