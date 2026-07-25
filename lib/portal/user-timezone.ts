/**
 * 用户时区单一事实源。个人版(owner)固定用美国纽约时间 —— 无论设备/服务器时区,
 * App 里所有「现在几点/今天几号/日程排在哪一天」都以此为准,消除:
 *   ① 服务端 UTC 把纽约周五晚当成周六 → 相对日期(「周六」)算歪;
 *   ② 各处默认 Asia/Shanghai → 事件分到错误的一天、时间显示偏 12+ 小时。
 * 需要多时区时再把常量换成「读用户设置」即可,消费方不用改。
 */

export const USER_TIME_ZONE = 'America/New_York';

const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number): string => String(n).padStart(2, '0');

export interface UserTzParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekdayIndex: number; // 0=Sun … 6=Sat
}

/** 某一瞬间在 USER_TIME_ZONE 的墙上时间各字段(含 DST)。 */
export function userTzParts(date: Date = new Date()): UserTzParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // 部分实现午夜给 24
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour, minute: Number(map.minute), second: Number(map.second),
    weekdayIndex: Math.max(0, WEEKDAY_EN.indexOf(map.weekday)),
  };
}

/** USER_TIME_ZONE 在该瞬间相对 UTC 的偏移串,如 "-04:00"(夏令时)/"-05:00"。 */
export function userTzOffset(date: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: USER_TIME_ZONE, timeZoneName: 'longOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = name.match(/GMT([+-]\d{2}:\d{2})/);
    if (m) return m[1];
  } catch { /* 回退到手算 */ }
  // 回退:UTC 与 tz 墙上时间之差(分钟)→ ±HH:MM
  const p = userTzParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const diffMin = Math.round((asUtc - date.getTime()) / 60000);
  const sign = diffMin >= 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 当前(或给定瞬间)在纽约的墙上时间 ISO,带偏移:2026-07-25T09:00:00-04:00。 */
export function nowUserTzISO(date: Date = new Date()): string {
  const p = userTzParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${userTzOffset(date)}`;
}

/** 纽约当天的日期键 YYYY-MM-DD(用于「今天/某天」归组)。 */
export function userTzDayKey(date: Date = new Date()): string {
  const p = userTzParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
