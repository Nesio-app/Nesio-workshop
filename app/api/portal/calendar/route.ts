import { NextResponse } from 'next/server';
import { parseIcsEvents } from '@/lib/portal/ics';

export async function GET() {
  const icalUrl =
    process.env.GOOGLE_CALENDAR_ICAL_URL?.trim() ||
    process.env.GOOGLE_CALENDAR_ICS_URL?.trim();

  if (!icalUrl) {
    return NextResponse.json({
      ok: false,
      configured: false,
      events: [],
      message: 'Set GOOGLE_CALENDAR_ICAL_URL on Vercel to sync Google Calendar.',
    });
  }

  try {
    const res = await fetch(icalUrl, {
      headers: { 'User-Agent': 'TreasureBox/1.0' },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, configured: true, events: [], error: 'calendar fetch failed' },
        { status: 502 },
      );
    }

    const text = await res.text();
    const events = parseIcsEvents(text, 14);

    return NextResponse.json({
      ok: true,
      configured: true,
      events,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, configured: true, events: [], error: 'calendar parse failed' },
      { status: 502 },
    );
  }
}
