import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { mergeCalendarEvents } from '@/lib/portal/calendar-filters';
import type { CalendarEvent } from '@/lib/portal/types';
import { parseIcsEvents, parseCalendarName } from '@/lib/portal/ics';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { pickCalendarTokens, shouldUseOAuth } from '@/lib/portal/calendar-token.mjs';
import { envValue } from '@/lib/portal/env';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import {
  buildEventParsePrompt,
  parseDraftFromLlm,
  validateDraft,
  draftToGoogleEvent,
  type DraftEvent,
} from '@/lib/portal/calendar-create';
import { USER_TIME_ZONE, nowUserTzISO } from '@/lib/portal/user-timezone';
import { hasVerifiedSessionCookie } from '@/lib/portal/api-auth';

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
  // 安全:验真会话(HMAC 验签 refresh|openid,不再裸信 cookie 存在;与 gmail 同款)。access 的真伪由
  // 下游取 Google 数据时兜底(伪 access 拿不到日历数据、无泄露)。收口伪造 refresh/openid presence 洞。
  const hasNesioSession = await hasVerifiedSessionCookie();
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

function mapGoogleCalendarItem(item: GoogleCalendarItem, calName = 'Google Calendar') {
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
    // 批次 48:全天事件(start.date 无 dateTime)必须带标记 —— 拍平后下游把
    // "2026-07-11" 按 UTC 午夜解析,长出「20:00 · 2h后」的假钟点和假倒计时
    allDay: !item.start?.dateTime,
    calendarName: calName,
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

type GoogleCalendarListEntry = { id: string; summary: string; primary?: boolean };

// 列出用户在 Google 日历里勾选显示的所有日历(含订阅/Other calendars)。
// calendar.readonly 已覆盖 calendarList.list,无需加 scope / 重连。
async function fetchGoogleCalendarList(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false',
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`calendarlist_http_${res.status}`);
  const data = await res.json().catch(() => ({})) as { items?: Array<{ id?: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean }> };
  return (data.items || [])
    .filter((c) => c.id && c.selected !== false) // selected=false = 用户在 Google 日历左栏取消勾选
    .map((c) => ({ id: c.id as string, summary: c.summaryOverride || c.summary || (c.primary ? 'Google Calendar' : c.id as string), primary: c.primary }));
}

async function fetchEventsForCalendar(accessToken: string, cal: GoogleCalendarListEntry) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  // 主日历保持原 80;订阅日历各 50(农历/节假日一天一条,靠 mergeCalendarEvents 的农历过滤 + 总量 80 挡噪音)
  url.searchParams.set('maxResults', cal.primary ? '80' : '50');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    // 批次 41:把 Google 的真实拒绝原因带出来(403 常见于 GCP 项目没启用 Calendar API)
    const body = await res.json().catch(() => null) as { error?: { message?: string; status?: string } } | null;
    const reason = body?.error?.status || body?.error?.message?.slice(0, 120) || '';
    throw new Error(`calendar_http_${res.status}${reason ? `: ${reason}` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data?.items) ? data.items : [];
  return rows.map((item: GoogleCalendarItem) => mapGoogleCalendarItem(item, cal.summary));
}

// 多日历拉取:此前只拉 calendars/primary/events,用户在 Google 日历勾选的订阅日历
// (Fidelity/课程/节假日等 Other calendars)全部漏掉。现在先 calendarList 列举再逐个
// 并发拉,单日历失败不阻断其它;全军覆没才抛错(让上层的刷新/借用重试链接管)。
async function fetchGoogleOAuthEvents(accessToken: string): Promise<{ events: CalendarEvent[]; feeds: FeedResult[] }> {
  let calendars: GoogleCalendarListEntry[] = [];
  try {
    calendars = await fetchGoogleCalendarList(accessToken);
  } catch { /* calendarList 不可用(旧 token/权限异常)→ 退回只拉 primary,不差于从前 */ }
  if (!calendars.length) calendars = [{ id: 'primary', summary: 'Google Calendar', primary: true }];

  const settled = await Promise.allSettled(calendars.map((c) => fetchEventsForCalendar(accessToken, c)));
  const lists: ReturnType<typeof mapGoogleCalendarItem>[][] = [];
  const feeds: FeedResult[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      lists.push(r.value);
      feeds.push({ label: calendars[i].summary, ok: true, count: r.value.length });
    } else {
      feeds.push({ label: calendars[i].summary, ok: false, count: 0, error: r.reason instanceof Error ? r.reason.message : 'fetch failed' });
    }
  });
  if (lists.length === 0) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw first ? (first.reason instanceof Error ? first.reason : new Error(String(first.reason))) : new Error('calendar_all_failed');
  }
  // mergeCalendarEvents:跨日历去重(同一会议同时出现在主日历+团队日历)+ 农历标记过滤 + 时间排序,总量 80
  const events = mergeCalendarEvents(lists, 80);
  return { events, feeds };
}

export async function GET(req: NextRequest) {
  const authFailure = await requireAuthenticatedCalendarAccess(req);
  if (authFailure) return authFailure;
  let lastOAuthError = '';

  let { accessToken, refreshToken } = await resolveCalendarTokens();
  // 批次 35 根因:合并授权(Google 日历+Gmail)是同一个 token,通讯录/邮件走
  // resolveGmailAccessToken(整条借用链)能拿到,日历却只认自己名下的 —— 于是
  // 「通讯录导入 127 成功、日历说没连接」。日历自己两手空空时,借同链 token
  // (它带 calendar scope)。
  if (!accessToken && !refreshToken) {
    const borrowed = await resolveGmailAccessToken(req).catch(() => '');
    if (borrowed) accessToken = borrowed;
  }
  // access 可能过期但 refresh 仍在 → 只要有任一,就走 OAuth 路径(而非直接掉进 iCal)。
  if (shouldUseOAuth({ accessToken, refreshToken })) {
    try {
      const { events, feeds: calFeeds } = await fetchGoogleOAuthEvents(accessToken);
      return NextResponse.json(
        {
          ok: true,
          configured: true,
          enabled: true,
          provider: 'google_calendar_oauth',
          events,
          feeds: calFeeds,
          sources: calFeeds.map((f) => f.label),
          fetchedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    } catch (err) {
      lastOAuthError = err instanceof Error ? err.message : String(err);
      const refreshedSession = await refreshGoogleCalendarSession(refreshToken);
      if (refreshedSession?.access_token) {
        try {
          const { events, feeds: calFeeds } = await fetchGoogleOAuthEvents(refreshedSession.access_token);
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
              feeds: calFeeds,
              sources: calFeeds.map((f) => f.label),
              fetchedAt: new Date().toISOString(),
            },
            { headers: { 'Cache-Control': 'no-store, max-age=0' } },
          );
          return setCalendarCookies(response, refreshedSession);
        } catch {
          // Fall through to the original safe OAuth fetch error below.
        }
      }

      // 批次 39:自家 token 刷新也失败(陈死 refresh)→ 最后借一次共享 Google token
      // (合并授权同一 token,通讯录能用它日历就能用)再落 iCal。
      const borrowed = await resolveGmailAccessToken(req).catch(() => '');
      if (borrowed && borrowed !== accessToken) {
        try {
          const { events, feeds: calFeeds } = await fetchGoogleOAuthEvents(borrowed);
          return NextResponse.json(
            {
              ok: true,
              configured: true,
              enabled: true,
              provider: 'google_calendar_oauth',
              status: 'calendar_borrowed_token',
              events,
              feeds: calFeeds,
              sources: calFeeds.map((f) => f.label),
              fetchedAt: new Date().toISOString(),
            },
            { headers: { 'Cache-Control': 'no-store, max-age=0' } },
          );
        } catch (err2) { lastOAuthError = err2 instanceof Error ? err2.message : String(err2); /* fall to iCal below */ }
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
      message: lastOAuthError
        ? `日历接口被拒:${lastOAuthError} —— 若含 403/PERMISSION_DENIED,多半是 Google Cloud 项目没启用 Calendar API(console.cloud.google.com → API 库 → Google Calendar API → 启用)。`
        : 'Connect Google Calendar to sync your events.',
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

// ── 创建日程(POST)──────────────────────────────────────────────────────────
// 需 calendar.events scope(见 connect 路由);写主日历 primary。入参二选一:
//   ① 结构化 { summary, startISO, endISO?, allDay?, location?, description?, timeZone? }
//   ② 自然语言 { text, timeZone? } —— LLM 解析成草稿(相对时间锚 now)。
// 复用 GET 的鉴权 / 取 token / 刷新 / 写 cookie。失败态显式(红线:异步动作必有可见失败)。

async function acquireCalendarToken(req: NextRequest): Promise<{ accessToken: string; refreshToken: string }> {
  const { accessToken, refreshToken } = await resolveCalendarTokens();
  if (!accessToken && !refreshToken) {
    const borrowed = await resolveGmailAccessToken(req).catch(() => '');
    if (borrowed) return { accessToken: borrowed, refreshToken: '' };
  }
  return { accessToken, refreshToken };
}

function insertGoogleEvent(accessToken: string, eventBody: Record<string, unknown>): Promise<Response> {
  return fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(eventBody),
    cache: 'no-store',
  });
}

function normalizeCreated(g: Record<string, unknown>, draft: DraftEvent) {
  return {
    id: typeof g.id === 'string' ? g.id : '',
    htmlLink: typeof g.htmlLink === 'string' ? g.htmlLink : '',
    summary: typeof g.summary === 'string' ? g.summary : draft.summary,
    start: (g.start as unknown) ?? null,
    end: (g.end as unknown) ?? null,
  };
}

export async function POST(req: NextRequest) {
  const authFailure = await requireAuthenticatedCalendarAccess(req);
  if (authFailure) return authFailure;

  let body: {
    text?: string; timeZone?: string; summary?: string; startISO?: string;
    endISO?: string; allDay?: boolean; location?: string; description?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }

  // 个人版固定纽约时区:忽略设备上报的时区(可能是 Asia/Shanghai),
  // 保证「周六上午9点」按纽约本地解析、写进 Google 也标 America/New_York。
  const timeZone = USER_TIME_ZONE;

  // 组装草稿:显式字段优先;否则自然语言 → LLM 解析。
  let draft: DraftEvent | null = null;
  if (body.summary && body.startISO) {
    draft = {
      summary: body.summary, startISO: body.startISO, endISO: body.endISO,
      allDay: body.allDay, location: body.location, description: body.description, timeZone,
    };
  } else if (body.text && body.text.trim()) {
    if (!aiProviderAvailable()) {
      return NextResponse.json(
        { ok: false, error: 'nl_parse_unavailable', message: 'AI 暂不可用,可直接传 summary + startISO 建日程。' },
        { status: 503 },
      );
    }
    try {
      const { text } = await completeText({
        prompt: buildEventParsePrompt(body.text, nowUserTzISO(), timeZone),
        maxTokens: 300, temperature: 0.1, route: 'calendar-create',
      });
      draft = parseDraftFromLlm(text);
      if (draft && !draft.timeZone) draft.timeZone = timeZone;
    } catch {
      return NextResponse.json(
        { ok: false, error: 'nl_parse_failed', message: '没太听懂时间,换种说法、或直接选个时间。' },
        { status: 422 },
      );
    }
  }

  const invalid = validateDraft(draft);
  if (invalid || !draft) {
    return NextResponse.json(
      { ok: false, error: invalid || 'no_draft', message: '缺少标题或时间,补齐后再试。' },
      { status: 400 },
    );
  }

  const eventBody = draftToGoogleEvent(draft);

  const { accessToken, refreshToken } = await acquireCalendarToken(req);
  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      { ok: false, error: 'calendar_not_connected', message: '还没连接 Google 日历,先去设置里连接。' },
      { status: 409 },
    );
  }

  // 有 access 先试;401/403/网络失败且有 refresh → 刷新后重试一次。
  let res: Response | null = null;
  if (accessToken) res = await insertGoogleEvent(accessToken, eventBody).catch(() => null);
  if ((!res || res.status === 401 || res.status === 403) && refreshToken) {
    const refreshed = await refreshGoogleCalendarSession(refreshToken);
    if (refreshed?.access_token) {
      const retry = await insertGoogleEvent(refreshed.access_token, eventBody).catch(() => null);
      if (retry && retry.ok) {
        await saveIntegrationToken('calendar', {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token || refreshToken || undefined,
          expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined,
        }, req).catch(() => { /* Supabase heal best-effort */ });
        const okJson = await retry.json().catch(() => ({})) as Record<string, unknown>;
        const created = NextResponse.json({ ok: true, status: 'calendar_session_refreshed', event: normalizeCreated(okJson, draft) });
        return setCalendarCookies(created, refreshed);
      }
      res = retry;
    }
  }

  if (!res) {
    return NextResponse.json({ ok: false, error: 'network', message: '网络不太稳,稍后再试一次。' }, { status: 502 });
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const hint = res.status === 403
      ? '可能还没重新授权「管理日程」(断开重连 Google),或 Google Cloud 未启用 Calendar API。'
      : '写入日历没成功,稍后再试。';
    return NextResponse.json(
      { ok: false, error: `google_${res.status}`, message: hint, detail: errText.slice(0, 300) },
      { status: 502 },
    );
  }

  const okJson = await res.json().catch(() => ({})) as Record<string, unknown>;
  return NextResponse.json({ ok: true, event: normalizeCreated(okJson, draft) });
}
