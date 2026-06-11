import type { CalendarEvent } from './types';

const LUNAR_PATTERNS = [
  /农历/i,
  /阴历/i,
  /\bLunar\b/i,
  /^[甲乙丙丁戊己庚辛壬癸].{0,3}年/,
  /正月初|腊月|闰月/,
  /^(立春|雨水|惊蛰|春分|清明|谷雨|立夏|小满|芒种|夏至|小暑|大暑|立秋|处暑|白露|秋分|寒露|霜降|立冬|小雪|大雪|冬至|小寒|大寒)$/,
  /^[正二三四五六七八九十冬腊闰]{1,2}月/,
  /^初[一二三四五六日天]/,
  /^十[一二三四五六七八九]/,
  /^二十[一二三四五六七八九]?$/,
  /^三十$/,
];

export function isLunarEvent(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return LUNAR_PATTERNS.some((re) => re.test(t));
}

export function mergeCalendarEvents(
  lists: CalendarEvent[][],
  limit = 3,
): CalendarEvent[] {
  const seen = new Set<string>();
  const merged: CalendarEvent[] = [];

  for (const list of lists) {
    for (const ev of list) {
      if (isLunarEvent(ev.title)) continue;
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
