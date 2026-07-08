import type { CalendarEvent } from './types';

function unfoldIcs(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/**
 * 时区两段式换算:把「某 IANA 时区的墙上时间」换成正确的 UTC 时刻(零依赖,用 Intl)。
 * 修复:服务器(UTC)此前把 DTSTART;TZID=America/New_York:...T090000 当服务器本地时间,
 * 纽约上午 9 点被存成 09:00Z,客户端(纽约)显示成 05:00 —— 正好差一个时区偏移。
 */
function zonedWallTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, sec: number, timeZone: string): Date | null {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = dtf.formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? NaN);
    const asWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    if (!Number.isFinite(asWall)) return null;
    return new Date(guess - (asWall - guess));
  } catch { return null; } // 未知时区名 → 交回调用方按无 TZID 处理
}

export function parseIcsDate(value: string, tzid = ''): Date | null { // export: 时区契约直测
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6)) - 1;
    const d = Number(raw.slice(6, 8));
    // 全天事件是"浮动日历日",按本地午夜构造 —— 若用 Date.UTC 午夜,西时区消费方按本地读会
    // 差一天("7月9号"匹配到 7月8号)。
    return new Date(y, m, d);
  }

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (raw.endsWith('Z')) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // 带 TZID 的墙上时间:按该时区换算成 UTC 时刻(此前被错当服务器本地时间)
  if (tzid) {
    const z = zonedWallTimeToUtc(+y, +mo, +d, +h, +mi, +s, tzid);
    if (z) return z;
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function icsUnescape(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function extractZoomUrl(text: string): string {
  const m = text.match(/https?:\/\/[a-z0-9-]+\.zoom\.us\/[^\s"<>]*/i);
  return m ? m[0] : '';
}

function eventFromBlock(block: string, calendarName = ''): CalendarEvent | null {
  const lines = block.split('\n');
  let uid = '';
  let summary = '';
  let dtstart = '';
  let dtstartTz = '';
  let dtend = '';
  let dtendTz = '';
  let description = '';
  let location = '';
  let url = '';

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const base = key.split(';')[0].toUpperCase();
    if (base === 'UID') uid = val.trim();
    if (base === 'SUMMARY') summary = val.trim();
    if (base === 'DTSTART') { dtstart = val.trim(); dtstartTz = /;TZID=([^;:]+)/i.exec(key)?.[1]?.trim() || ''; }
    if (base === 'DTEND') { dtend = val.trim(); dtendTz = /;TZID=([^;:]+)/i.exec(key)?.[1]?.trim() || ''; }
    if (base === 'DESCRIPTION') description = icsUnescape(val.trim());
    if (base === 'LOCATION') location = icsUnescape(val.trim());
    if (base === 'URL') url = val.trim();
  }

  const start = parseIcsDate(dtstart, dtstartTz);
  if (!start || !summary) return null;

  const allDay = /^\d{8}$/.test(dtstart.trim());
  const end = dtend ? parseIcsDate(dtend, dtendTz || dtstartTz) : undefined;

  // Prefer explicit URL, then Zoom URL from location, then Zoom URL from description
  const resolvedUrl = url || (location && /zoom\.us/i.test(location) ? location : '') || extractZoomUrl(description) || extractZoomUrl(location);

  return {
    id: uid || `${summary}-${start.toISOString()}`,
    title: icsUnescape(summary),
    start: start.toISOString(),
    end: end?.toISOString(),
    allDay,
    calendarName: calendarName || undefined,
    description: description || undefined,
    location: (!resolvedUrl && location) ? location : undefined,
    url: resolvedUrl || undefined,
  };
}

export function parseCalendarName(icsText: string): string {
  const m = unfoldIcs(icsText).match(/X-WR-CALNAME:([^\n\r]+)/);
  return m ? m[1].trim() : '';
}

export function parseIcsEvents(icsText: string, limit = 12, calendarName = ''): CalendarEvent[] {
  const calName = calendarName || parseCalendarName(icsText);
  const flat = unfoldIcs(icsText);
  const blocks = flat.split('BEGIN:VEVENT').slice(1);
  const now = Date.now();
  const horizon = now + 30 * 24 * 60 * 60 * 1000;

  const events = blocks
    .map((chunk) => eventFromBlock(chunk.split('END:VEVENT')[0] || '', calName))
    .filter((e): e is CalendarEvent => Boolean(e))
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= now - 24 * 60 * 60 * 1000 && t <= horizon;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return events.slice(0, limit);
}
