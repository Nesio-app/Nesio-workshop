import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import { parseIcsEvents, parseCalendarName } from '@/lib/portal/ics';

type Feed = { url: string; label: string };
type FeedResult = { label: string; ok: boolean; count: number; error?: string };
type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};
type GoogleCalendarItem = {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasStage5LabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  return Boolean(configured && provided === configured && accessMode === 'personal_lab');
}

function requireAuthenticatedCalendarAccess(req: NextRequest): NextResponse | null {
  const cookieStore = cookies();
  const hasNesioSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (hasNesioSession || hasStage5LabAccess(req)) return null;

  return NextResponse.json(
    {
      ok: false,
      configured: false,
      enabled: false,
      events: [],
      feeds: [],
      sources: [],
      error: 'calendar_auth_required',
      message: 'Sign in before loading private calendar data.',
    },
    { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

function privateFeedAccessEnabled(): boolean {
  return envValue('CALENDAR_PRIVATE_FEEDS_ENABLED').toLowerCase() === 'true';
}

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
        'Mozilla/5.0 (compatible; Nesio/1.0; +https://www.nesio.app)',
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

function googleCalendarAccessToken(): string {
  return cookies().get('nesio_google_calendar_access')?.value || '';
}

function googleCalendarRefreshToken(): string {
  return cookies().get('nesio_google_calendar_refresh')?.value || '';
}

function setCalendarCookies(response: NextResponse, session: GoogleTokenResponse | null) {
  if (!session?.access_token) return response;

  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  response.cookies.set('nesio_google_calendar_access', session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  if (session.refresh_token) {
    response.cookies.set('nesio_google_calendar_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
    });
  }

  return response;
}

function extractZoomFromText(text: string): string {
  const m = text.match(/https?:\/\/[a-z0-9-]+\.zoom\.us\/[^\s"<>]*/i);
  return m ? m[0] : '';
}

function mapGoogleCalendarItem(item: GoogleCalendarItem) {
  const start = item.start?.dateTime || item.start?.date || '';
  const end = item.end?.dateTime || item.end?.date || start;
  const desc = item.description || '';
  const zoomUrl = extractZoomFromText(desc);
  return {
    id: item.id || `${item.summary || 'google-event'}-${start}`,
    title: item.summary || 'Untitled event',
    description: desc || undefined,
    start,
    end,
    calendarName: 'Google Calendar',
    source: 'Google Calendar',
    // Zoom link takes priority over generic htmlLink (Google Calendar page)
    url: zoomUrl || item.htmlLink || '',
  };
}

async function refreshGoogleCalendarSession(refreshToken: string): Promise<GoogleTokenResponse | null> {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<GoogleTokenResponse>;
}

async function fetchGoogleOAuthEvents(accessToken: string) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '80');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`google calendar fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data?.items) ? data.items : [];
  return rows.map((item: GoogleCalendarItem) => mapGoogleCalendarItem(item));
}

export async function GET(req: NextRequest) {
  const authFailure = requireAuthenticatedCalendarAccess(req);
  if (authFailure) return authFailure;

  const accessToken = googleCalendarAccessToken();
  const refreshToken = googleCalendarRefreshToken();
  if (accessToken) {
    try {
      const events = await fetchGoogleOAuthEvents(accessToken);
      return NextResponse.json(
        {
          ok: true,
          configured: true,
          enabled: true,
          provider: 'google_calendar_oauth',
          events,
          feeds: [{ label: 'Google Calendar', ok: true, count: events.length }],
          sources: ['Google Calendar'],
          fetchedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    } catch (err) {
      const refreshedSession = await refreshGoogleCalendarSession(refreshToken);
      if (refreshedSession?.access_token) {
        try {
          const events = await fetchGoogleOAuthEvents(refreshedSession.access_token);
          const response = NextResponse.json(
            {
              ok: true,
              configured: true,
              enabled: true,
              provider: 'google_calendar_oauth',
              status: 'calendar_session_refreshed',
              events,
              feeds: [{ label: 'Google Calendar', ok: true, count: events.length }],
              sources: ['Google Calendar'],
              fetchedAt: new Date().toISOString(),
            },
            { headers: { 'Cache-Control': 'no-store, max-age=0' } },
          );
          return setCalendarCookies(response, refreshedSession);
        } catch {
          // Fall through to the original safe OAuth fetch error below.
        }
      }

      return NextResponse.json(
        {
          ok: false,
          configured: true,
          enabled: true,
          provider: 'google_calendar_oauth',
          events: [],
          feeds: [
            {
              label: 'Google Calendar',
              ok: false,
              count: 0,
              error: err instanceof Error ? err.message : 'fetch failed',
            },
          ],
          sources: ['Google Calendar'],
          message: 'Google Calendar OAuth token could not fetch events.',
        },
        { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }
  }

  const feeds = calendarFeeds();
  const enabled = privateFeedAccessEnabled();

  if (feeds.length === 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      enabled,
      events: [],
      feeds: [],
      message: 'Set GOOGLE_CALENDAR_ICAL_URL and FIDELITY on Vercel.',
    });
  }

  if (!enabled) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        enabled: false,
        events: [],
        feeds: feeds.map((feed) => ({
          label: feed.label,
          ok: false,
          count: 0,
          error: 'calendar private feeds disabled',
        })),
        sources: feeds.map((f) => f.label),
        message: 'Calendar private feeds disabled. Set CALENDAR_PRIVATE_FEEDS_ENABLED=true to enable configured feeds.',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
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

  const events = mergeCalendarEvents(lists, 80);

  return NextResponse.json(
    {
      ok: true,
      configured: true,
      enabled: true,
      events,
      feeds: feedResults,
      sources: feeds.map((f) => f.label),
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
