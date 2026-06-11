import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import { parseIcsEvents, parseCalendarName } from '@/lib/portal/ics';

type Feed = { url: string; label: string };
type FeedResult = { label: string; ok: boolean; count: number; error?: string };

function normalizeIcalUrl(raw: string): string {
  const u = raw.trim();
  if (u.startsWith('webcal://')) return `https://${u.slice('webcal://'.length)}`;
  if (u.startsWith('http://')) return `https://${u.slice('http://'.length)}`;
  return u;
}

function calendarFeeds(): Feed[] {
  const feeds: Feed[] = [];
  const add = (raw: string | undefined, label: string) => {
    const v = raw?.trim();
    if (!v || v === '""' || v === "''") return;
    const url = normalizeIcalUrl(v);
    if (!url.startsWith('https://')) return;
    if (feeds.some((f) => f.url === url)) return;
    feeds.push({ url, label });
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
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; TreasureBox/1.0; +https://treasurebox-nu.vercel.app)',
      Accept: 'text/calendar, text/plain, */*',
    },
    redirect: 'follow',
    next: { revalidate: 300 },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  const calName = parseCalendarName(text) || fallbackLabel;
  const events = parseIcsEvents(text, 90, calName);
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
      feeds: [],
      message: 'Set GOOGLE_CALENDAR_ICAL_URL and FIDELITY on Vercel.',
    });
  }

  const feedResults: FeedResult[] = [];
  const lists: Awaited<ReturnType<typeof fetchIcsEvents>>[] = [];

  for (const feed of feeds) {
    try {
      const events = await fetchIcsEvents(feed.url, feed.label);
      lists.push(events);
      feedResults.push({ label: feed.label, ok: true, count: events.length });
    } catch (err) {
      lists.push([]);
      feedResults.push({
        label: feed.label,
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : 'fetch failed',
      });
    }
  }

  const events = mergeCalendarEvents(lists, 40);

  return NextResponse.json(
    {
      ok: true,
      configured: true,
      events,
      feeds: feedResults,
      sources: feeds.map((f) => f.label),
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
