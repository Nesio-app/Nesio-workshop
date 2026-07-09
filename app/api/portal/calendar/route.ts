import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import { parseIcsEvents, parseCalendarName } from '@/lib/portal/ics';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { pickCalendarTokens, shouldUseOAuth } from '@/lib/portal/calendar-token.mjs';
import { envValue } from '@/lib/portal/env';

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
  // 免费最大化·Calendar:响应自带、此前全丢弃的字段(同 calendar.readonly scope,免费)
  location?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string }> };
};

function hasStage5LabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  return Boolean(configured && provided === configured && accessMode === 'personal_lab');
}

async function requireAuthenticatedCalendarAccess(req: NextRequest): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const hasNesioSession = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
      cookieStore.get('baohe_auth_refresh')?.value ||
      cookieStore.get('baohe_wechat_openid')?.value,
  );
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  if (hasNesioSession || hasStage5LabAccess(req) || noSupabase) return null;

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
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  return envValue('CALENDAR_PRIVATE_FEEDS_ENABLED').toLowerCase() === 'true' || noSupabase;
}

// 静态 ICS 订阅已按用户要求移除(2026-07):此前从 env(GOOGLE_CALENDAR_ICS_URL /
// FIDELITY / CALENDAR_ICAL_URLS 等)读一批 URL 自动订阅,会把外部日历(含带错时区的
// 陌生事件,如误入的一条演示日程)灌进 Today。日历现在只走用户自己的 Google OAuth 同步
// (/calendars/primary/events)。保留空实现以维持下方响应结构与鉴权门不变。
function calendarFeeds(): Feed[] {
  return [];
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

/**
 * Resolve the calendar OAuth tokens Supabase-first (cross-device), then cookie.
 * 修「Token 存储精神分裂」—— 此前只读 nesio_google_calendar_* cookie:换一台
 * 设备(Supabase 会话、本机无 cookie)日历就静默退回 iCal,显示"没连日历",
 * 即便账号明明连着(用户:「日历今天仍没修好」)。改走和 gmail-access 同一条
 * 解析链:getIntegrationToken('calendar') 先查 Supabase,再回落 cookie。
 */
async function resolveCalendarTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  // getIntegrationToken 已 Supabase 优先、再按显式开关回落 cookie。这里再显式认一次
  // 本机的 nesio_google_calendar_* cookie,覆盖旧授权只写这对 cookie 的历史数据。
  const supabase = await getIntegrationToken('calendar');
  const store = await cookies();
  const cookieTokens = {
    accessToken: store.get('nesio_google_calendar_access')?.value || '',
    refreshToken: store.get('nesio_google_calendar_refresh')?.value || '',
  };
  return pickCalendarTokens(supabase, cookieTokens);
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

// 免费最大化·Calendar:conferenceData 的视频入会链接优先(video/其它),比正则从
// description 里抠 zoom 链接更可靠(Google Meet/Zoom 都在 entryPoints 里)。
function conferenceUrl(item: GoogleCalendarItem): string {
  const eps = item.conferenceData?.entryPoints || [];
  const video = eps.find((e) => e.entryPointType === 'video' && e.uri);
  if (video?.uri) return video.uri;
  const any = eps.find((e) => e.uri);
  return any?.uri || '';
}

function mapGoogleCalendarItem(item: GoogleCalendarItem) {
  const start = item.start?.dateTime || item.start?.date || '';
  const end = item.end?.dateTime || item.end?.date || start;
  const desc = item.description || '';
  // 一键入会链接:conferenceData 优先 → description 里的 zoom → htmlLink 兜底
  const meetingUrl = conferenceUrl(item) || extractZoomFromText(desc);
  // 与会人名单(去掉自己),供会前简报「和 X、Y 开会」
  const attendees = (item.attendees || [])
    .filter((a) => !a.self && (a.displayName || a.email))
    .map((a) => a.displayName || a.email || '')
    .filter(Boolean);
  return {
    id: item.id || `${item.summary || 'google-event'}-${start}`,
    title: item.summary || 'Untitled event',
    description: desc || undefined,
    start,
    end,
    calendarName: 'Google Calendar',
    source: 'Google Calendar',
    // Meeting/Zoom link takes priority over generic htmlLink (Google Calendar page)
    url: meetingUrl || item.htmlLink || '',
    location: item.location || undefined,
    organizer: item.organizer?.displayName || item.organizer?.email || undefined,
    attendees: attendees.length ? attendees : undefined,
    meetingUrl: meetingUrl || undefined,
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
  const authFailure = await requireAuthenticatedCalendarAccess(req);
  if (authFailure) return authFailure;

  const { accessToken, refreshToken } = await resolveCalendarTokens();
  // access 可能过期但 refresh 仍在 → 只要有任一,就走 OAuth 路径(而非直接掉进 iCal)。
  if (shouldUseOAuth({ accessToken, refreshToken })) {
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
          // 刷新成功后同时写回 Supabase(不只 cookie),否则换设备下次又拿到旧 token。
          await saveIntegrationToken('calendar', {
            accessToken: refreshedSession.access_token,
            refreshToken: refreshedSession.refresh_token || refreshToken || undefined,
            expiresAt: refreshedSession.expires_in ? Date.now() + refreshedSession.expires_in * 1000 : undefined,
          }, req).catch(() => { /* Supabase heal best-effort */ });
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

      // OAuth failed — fall through to iCal subscription URL fallback below.
      // Do NOT return here; let the iCal path run so existing subscriptions still work.
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
      message: 'Connect Google Calendar to sync your events.',
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
