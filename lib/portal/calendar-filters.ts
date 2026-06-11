import type { CalendarEvent } from './types';

/** Drop events from lunar calendars or with explicit lunar titles only. */
export function isLunarEvent(title: string, calendarName = ''): boolean {
  const cal = calendarName.trim();
  if (/农历|阴历|lunar|chinese\s*holiday|节气和节日/i.test(cal)) return true;

  const t = title.trim();
  if (!t) return false;
  if (/农历|阴历|\bLunar\b/i.test(t)) return true;

  // Pure lunar date titles e.g. 正月初一、二月廿三
  if (/^(闰?)(正|腊|冬|寒)[月]?(初[一二三四五六七八九十]|十[一二三四五六七八九]|二十[一二三四五六七八九]?|三十)/.test(t)) {
    return true;
  }
  if (/^[一二三四五六七八九十冬腊]{1,2}月(初|十|二十)/.test(t) && t.length <= 8) {
    return true;
  }

  return false;
}

export function mergeCalendarEvents(
  lists: CalendarEvent[][],
  limit = 3,
): CalendarEvent[] {
  const seen = new Set<string>();
  const merged: CalendarEvent[] = [];

  for (const list of lists) {
    for (const ev of list) {
      if (isLunarEvent(ev.title, ev.calendarName)) continue;
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
