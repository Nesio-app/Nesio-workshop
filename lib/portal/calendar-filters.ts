import type { CalendarEvent } from './types';

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

  return false;
}

export function isLunarEvent(title: string, calendarName = ''): boolean {
  if (isLunarCalendarName(calendarName)) return true;
  return isLunarEventTitle(title);
}

export function mergeCalendarEvents(
  lists: CalendarEvent[][],
  limit = 5,
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
