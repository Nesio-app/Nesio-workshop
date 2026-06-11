import { NextResponse } from 'next/server';
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import { parseIcsEvents } from '@/lib/portal/ics';

function calendarUrls(): string[] {
  const urls: string[] = [];
  const add = (raw?: string) => {
    const v = raw?.trim();
    if (v && !urls.includes(v)) urls.push(v);
  };

  add(process.env.GOOGLE_CALENDAR_ICAL_URL);
  add(process.env.GOOGLE_CALENDAR_ICS_URL);
  add(process.env.FIDELITY);
  add(process.env.FIDELITY_ICAL_URL);
  add(process.env.FIDELITY_CALENDAR_ICAL_URL);
  add(process.env.GOOGLE_CALENDAR_FIDELITY_ICAL_URL);

  const multi =
    process.env.CALENDAR_ICAL_URLS?.trim() ||
    process.env.GOOGLE_CALENDAR_ICAL_URLS?.trim();
  if (multi) {
    for (const part of multi.split(',')) add(part);
  }

  return urls;
}

async function fetchIcsEvents(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TreasureBox/1.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  return parseIcsEvents(text, 40);
}

export async function GET() {
  const urls = calendarUrls();

  if (urls.length === 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      events: [],
      message: 'Set GOOGLE_CALENDAR_ICAL_URL on Vercel to sync calendars.',
    });
  }

  try {
    const lists = await Promise.all(
      urls.map((url) =>
        fetchIcsEvents(url).catch(() => [] as Awaited<ReturnType<typeof parseIcsEvents>>),
      ),
    );

    const events = mergeCalendarEvents(lists, 3);

    return NextResponse.json({
      ok: true,
      configured: true,
      events,
      sources: urls.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, configured: true, events: [], error: 'calendar parse failed' },
      { status: 502 },
    );
  }
}
