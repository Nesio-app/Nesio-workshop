import type { CalendarEvent } from './types';

function unfoldIcs(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseIcsDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6)) - 1;
    const d = Number(raw.slice(6, 8));
    return new Date(Date.UTC(y, m, d));
  }

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (raw.endsWith('Z')) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
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
  let dtend = '';
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
    if (base === 'DTSTART') dtstart = val.trim();
    if (base === 'DTEND') dtend = val.trim();
    if (base === 'DESCRIPTION') description = icsUnescape(val.trim());
    if (base === 'LOCATION') location = icsUnescape(val.trim());
    if (base === 'URL') url = val.trim();
  }

  const start = parseIcsDate(dtstart);
  if (!start || !summary) return null;

  const allDay = /^\d{8}$/.test(dtstart.trim());
  const end = dtend ? parseIcsDate(dtend) : undefined;

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
