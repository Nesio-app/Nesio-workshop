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
    return new Date(y, m, d);
  }

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (raw.endsWith('Z')) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function eventFromBlock(block: string): CalendarEvent | null {
  const lines = block.split('\n');
  let uid = '';
  let summary = '';
  let dtstart = '';
  let dtend = '';

  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':');
    const base = key.split(';')[0];
    if (base === 'UID') uid = val;
    if (base === 'SUMMARY') summary = val;
    if (base === 'DTSTART') dtstart = val;
    if (base === 'DTEND') dtend = val;
  }

  const start = parseIcsDate(dtstart);
  if (!start || !summary) return null;

  const allDay = /^\d{8}$/.test(dtstart.trim());
  const end = dtend ? parseIcsDate(dtend) : undefined;

  return {
    id: uid || `${summary}-${start.toISOString()}`,
    title: summary.replace(/\\n/g, ' ').replace(/\\,/g, ','),
    start: start.toISOString(),
    end: end?.toISOString(),
    allDay,
  };
}

export function parseIcsEvents(icsText: string, limit = 12): CalendarEvent[] {
  const flat = unfoldIcs(icsText);
  const blocks = flat.split('BEGIN:VEVENT').slice(1);
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;

  const events = blocks
    .map((chunk) => eventFromBlock(chunk.split('END:VEVENT')[0] || ''))
    .filter((e): e is CalendarEvent => Boolean(e))
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= now - 24 * 60 * 60 * 1000 && t <= horizon;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return events.slice(0, limit);
}
