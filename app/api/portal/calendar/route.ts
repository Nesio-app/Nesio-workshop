import { NextResponse } from 'next/server';
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import { parseIcsEvents, parseCalendarName } from '@/lib/portal/ics';

type Feed = { url: string; label: string };

function calendarFeeds(): Feed[] {
  const feeds: Feed[] = [];
  const add = (raw: string | undefined, label: string) => {
    const v = raw?.trim();
    if (!v) return;
    if (feeds.some((f) => f.url === v)) return;
    feeds.push({ url: v, label });
  };

  add(process.env.GOOGLE_CALENDAR_ICAL_URL, 'Google');
  add(process.env.GOOGLE_CALENDAR_ICS_URL, 'Google');
  add(process.env.FIDELITY, 'Fidelity');
  add(process.env.FIDELITY_ICAL_URL, 'Fidelity');
  add(process.env.FIDELITY_CALENDAR_ICAL_URL, 'Fidelity');
  add(process.env.GOOGLE_CALENDAR_FIDELITY_ICAL_URL, 'Fidelity');

  const multi =
    process.env.CALENDAR_ICAL_URLS?.trim() ||
    process.env.GOOGLE_CALENDAR_ICAL_URLS?.trim();
  if (multi) {
    multi.split(',').forEach((part, i) => add(part, `Calendar ${i + 1}`));
  }

  return feeds;
}

async function fetchIcsEvents(url: string, fallbackLabel: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TreasureBox/1.0' },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  const calName = parseCalendarName(text) || fallbackLabel;
  const events = parseIcsEvents(text, 60, calName);
  return events.map((ev) => ({
    ...ev,
    calendarName: ev.calendarName || calName,
    source: fallbackLabel,
  }));
}

export async function GET() {
  const feeds = calendarFeeds();

  if (feeds.length === 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      events: [],
      message: 'Set GOOGLE_CALENDAR_ICAL_URL and FIDELITY on Vercel.',
    });
  }

  try {
    const lists = await Promise.all(
      feeds.map((feed) =>
        fetchIcsEvents(feed.url, feed.label).catch(() => []),
      ),
    );

    const events = mergeCalendarEvents(lists, 40);

    return NextResponse.json({
      ok: true,
      configured: true,
      events,
      sources: feeds.map((f) => f.label),
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, configured: true, events: [], error: 'calendar parse failed' },
      { status: 502 },
    );
  }
}
