import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = new URL('./route.ts', import.meta.url);
const fixturePath = new URL('./__fixtures__/mock-private.ics', import.meta.url);
let mockCalendarAccessCookie = '';
let mockCalendarRefreshCookie = '';
let mockBaoheAuthCookie = '';
// Supabase-stored calendar token (cross-device). null → fall back to cookie.
let mockSupabaseCalendarToken = null;

function parseMockIcsEvents(text, limit, calendarName) {
  const summary = text.match(/^SUMMARY:(.+)$/m)?.[1]?.trim();
  if (!summary) return [];
  return [
    {
      id: 'private-meeting@example.test',
      title: summary,
      start: '2099-01-01T12:00:00.000Z',
      end: '2099-01-01T13:00:00.000Z',
      calendarName,
    },
  ].slice(0, limit);
}

function loadRoute() {
  const source = fs.readFileSync(routePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: 'route.ts',
  }).outputText;

  const routeModule = { exports: {} };
  const sandbox = {
    module: routeModule,
    exports: routeModule.exports,
    process,
    fetch: global.fetch,
    Date,
    URL,
    URLSearchParams,
    console,
    require(specifier) {
      if (specifier === 'next/server') {
        return {
          NextResponse: {
            json(body, init = {}) {
              const response = {
                body,
                init,
                cookiesSet: [],
                cookies: {
                  set(name, value, options = {}) {
                    response.cookiesSet.push({ name, value, options });
                  },
                },
              };
              return response;
            },
          },
        };
      }
      if (specifier === 'next/headers') {
        return {
          cookies() {
            return {
              get(name) {
                if (name === 'nesio_google_calendar_access' && mockCalendarAccessCookie) return { value: mockCalendarAccessCookie };
                if (name === 'nesio_google_calendar_refresh' && mockCalendarRefreshCookie) return { value: mockCalendarRefreshCookie };
                if (name === 'baohe_auth_access' && mockBaoheAuthCookie) return { value: mockBaoheAuthCookie };
                return undefined;
              },
            };
          },
        };
      }
      if (specifier === '@/lib/portal/ics') {
        return {
          parseCalendarName(text) {
            return text.match(/^X-WR-CALNAME:(.+)$/m)?.[1]?.trim() || '';
          },
          parseIcsEvents: parseMockIcsEvents,
        };
      }
      if (specifier === '@/lib/portal/calendar-filters') {
        return {
          CAL_PAST_MS: 35 * 86_400_000,
          mergeCalendarEvents(lists, limit) {
            return lists.flat().slice(0, limit);
          },
          windowCalendarEvents(events) {
            return events;
          },
        };
      }
      if (specifier === '@/lib/portal/integrations') {
        return {
          async getIntegrationToken(provider) {
            if (provider === 'calendar') return mockSupabaseCalendarToken;
            return null;
          },
          async saveIntegrationToken() { /* heal is best-effort; no-op in test */ },
        };
      }
      if (specifier === '@/lib/portal/calendar-token.mjs') {
        // Faithful copies of the pure helpers (covered by calendar-token.test.mjs).
        return {
          pickCalendarTokens(supabase, cookie) {
            const s = supabase || {};
            if (s.accessToken || s.refreshToken) {
              return { accessToken: s.accessToken || '', refreshToken: s.refreshToken || '' };
            }
            const c = cookie || {};
            return { accessToken: c.accessToken || '', refreshToken: c.refreshToken || '' };
          },
          shouldUseOAuth(tokens) {
            const t = tokens || {};
            return Boolean(t.accessToken || t.refreshToken);
          },
        };
      }
      if (specifier === '@/lib/portal/providers/gmail-access') {
        // 批次 35:日历两手空空时借共享 Google token 的链路。测试默认借不到(空串),
        // fail-closed 行为不变;单独用例可覆写 sandbox.__borrowedToken。
        return { resolveGmailAccessToken: async () => sandbox.__borrowedToken || '' };
      }
      if (specifier === '@/lib/portal/env') {
        // 共享 env 助手(取代各路由本地 envValue);纯函数,忠实复制。
        return { envValue: (key) => (process.env[key] ?? '').trim() };
      }
      if (specifier === '@/lib/portal/ai-complete') {
        // 日历 POST 的「一句话建日程」NL 解析用云 LLM;fail-closed 用例不走该分支。
        // 桩成「无 AI 供应商」——既不发真实云调用,又保持 GET fail-closed 断言不受影响。
        return { completeText: async () => ({ text: '', tier: 'none' }), aiProviderAvailable: () => false };
      }
      if (specifier === '@/lib/portal/calendar-create') {
        // POST 建日程的纯解析/校验助手;GET fail-closed 用例不触达,桩成安全 no-op。
        return {
          buildEventParsePrompt: () => '',
          parseDraftFromLlm: () => null,
          validateDraft: () => ({ ok: false, error: 'stubbed' }),
          draftToGoogleEvent: () => ({}),
        };
      }
      if (specifier === '@/lib/portal/user-timezone') {
        // 纯常量/纯函数,忠实复制(用户时区固定纽约)。
        return { USER_TIME_ZONE: 'America/New_York', nowUserTzISO: () => '2026-01-01T00:00:00-05:00' };
      }
      if (specifier === '@/lib/portal/api-auth') {
        // 验真会话门:忠实映射到 mock cookie —— 有会话 → true(通过),无 → false(fail-closed)。
        return { hasVerifiedSessionCookie: async () => Boolean(mockBaoheAuthCookie) };
      }
      throw new Error(`Unexpected import in calendar route test: ${specifier}`);
    },
  };

  vm.runInNewContext(compiled, sandbox, { filename: fileURLToPath(routePath) });
  return routeModule.exports;
}

function clearCalendarEnv() {
  for (const key of [
    'GOOGLE_CALENDAR_ICAL_URL',
    'GOOGLE_CALENDAR_ICS_URL',
    'FIDELITY',
    'FIDELITY_ICAL_URL',
    'FIDELITY_CALENDAR_ICAL_URL',
    'GOOGLE_CALENDAR_FIDELITY_ICAL_URL',
    'CALENDAR_ICAL_URLS',
    'GOOGLE_CALENDAR_ICAL_URLS',
    'CALENDAR_PRIVATE_FEEDS_ENABLED',
  ]) {
    delete process.env[key];
  }
}

function mockRequest(headers = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: {
      get(name) {
        return map.get(String(name).toLowerCase()) || null;
      },
    },
  };
}

async function testConfiguredFeedFailsClosedWithoutGate() {
  // Fail-closed applies to CLOUD deployments (Supabase configured, no
  // session). Deployments without Supabase run in local mode by design and
  // are covered by testLocalModeAllowsFeedsWithoutSession below.
  clearCalendarEnv();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.GOOGLE_CALENDAR_ICAL_URL = 'https://example.test/private.ics';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch must not be called without calendar safety gate');
  };

  const { GET } = loadRoute();
  const response = await GET(mockRequest());

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;

  assert.equal(fetchCalled, false);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'calendar_auth_required');
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.events.length, 0);
  assert.match(response.body.message, /Sign in/i);
  assert.doesNotMatch(JSON.stringify(response.body), /Sensitive Private Meeting/);
}

// 静态 ICS 订阅已移除(用户 2026-07 要求):即使 env 里残留 ICS URL,也**绝不**去订阅/拉取,
// 只走 Google OAuth。锁死回归:配了 ICAL_URL 也不发任何 fetch,响应 configured:false。
async function testStaticIcsFeedSubscriptionRemoved() {
  clearCalendarEnv();
  delete process.env.SUPABASE_URL;   // 本地模式:鉴权门放行,确保是「无 feed」而非「被门挡住」
  delete process.env.SUPABASE_ANON_KEY;
  mockBaoheAuthCookie = '';
  mockCalendarAccessCookie = '';      // 无 OAuth,只有残留的 ICS env
  process.env.GOOGLE_CALENDAR_ICAL_URL = 'https://example.test/private.ics';
  process.env.CALENDAR_PRIVATE_FEEDS_ENABLED = 'true';
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; throw new Error('must not subscribe to any ICS URL'); };

  const { GET } = loadRoute();
  const response = await GET(mockRequest());

  assert.equal(fetchCalled, false, '不再订阅任何 URL 日历(即使 env 残留)');
  assert.equal(response.body.configured, false, '无静态 feed → configured:false');
  assert.equal(response.body.events.length, 0);
}

async function testOauthCookieReadsGoogleCalendarApiWithoutIcsEnv() {
  clearCalendarEnv();
  mockBaoheAuthCookie = 'baohe-session';
  mockCalendarAccessCookie = 'google-access-token';
  const fetchedUrls = [];
  // 多日历契约:先 calendarList 列举勾选日历(含订阅日历),再逐日历拉 events ——
  // 订阅日历(如 Fidelity)必须进来,此前只拉 primary 导致 Other calendars 全漏。
  global.fetch = async (url, init = {}) => {
    const urlText = String(url);
    fetchedUrls.push({ url: urlText, authorization: init.headers?.Authorization || init.headers?.authorization || '' });
    if (urlText.includes('/users/me/calendarList')) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              { id: 'primary', summary: 'Janice', primary: true, selected: true },
              { id: 'fidelity@group.calendar.google.com', summary: 'Fidelity', selected: true },
              { id: 'unchecked@group.calendar.google.com', summary: 'Unchecked', selected: false },
            ],
          };
        },
      };
    }
    if (urlText.includes('/calendars/primary/events')) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: 'google-event-1',
                summary: 'Google OAuth Event',
                start: { dateTime: '2099-02-01T10:00:00-05:00' },
                end: { dateTime: '2099-02-01T10:30:00-05:00' },
                htmlLink: 'https://calendar.google.com/event?eid=1',
              },
            ],
          };
        },
      };
    }
    if (urlText.includes('fidelity%40group.calendar.google.com')) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: 'fidelity-event-1',
                summary: 'Fidelity Webinar',
                start: { dateTime: '2099-02-02T10:00:00-05:00' },
                end: { dateTime: '2099-02-02T11:00:00-05:00' },
              },
            ],
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${urlText}`);
  };

  const { GET } = loadRoute();
  const response = await GET(mockRequest());

  assert.equal(fetchedUrls.length, 3, 'calendarList + 两个勾选日历(selected:false 的不拉)');
  assert.match(fetchedUrls[0].url, /\/users\/me\/calendarList/);
  assert.equal(fetchedUrls[0].authorization, 'Bearer google-access-token');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.provider, 'google_calendar_oauth');
  const titles = response.body.events.map((e) => e.title);
  assert.ok(titles.includes('Google OAuth Event'), '主日历事件在');
  assert.ok(titles.includes('Fidelity Webinar'), '订阅日历(Fidelity)事件必须进来');
  const fidelityEv = response.body.events.find((e) => e.title === 'Fidelity Webinar');
  assert.equal(fidelityEv.calendarName, 'Fidelity', '事件携带真实日历名(不再硬编码 Google Calendar)');
  assert.equal(fidelityEv.source, 'Google Calendar');
}

// 修「Token 存储精神分裂」:换设备只有 Supabase token、本机无 cookie 时,
// 日历以前只读 cookie → 静默退回 iCal("没连日历")。现在应走 OAuth。
async function testSupabaseTokenReadsCalendarCrossDeviceWithoutCookie() {
  clearCalendarEnv();
  mockBaoheAuthCookie = 'baohe-session';
  mockCalendarAccessCookie = ''; // 新设备:没有本机 cookie
  mockCalendarRefreshCookie = '';
  mockSupabaseCalendarToken = { accessToken: 'supabase-access-token', refreshToken: 'supabase-refresh-token' };
  const fetchedUrls = [];
  global.fetch = async (url, init = {}) => {
    const urlText = String(url);
    fetchedUrls.push({ url: urlText, authorization: init.headers?.Authorization || init.headers?.authorization || '' });
    if (urlText.includes('/users/me/calendarList')) {
      return {
        ok: true,
        async json() {
          return { items: [{ id: 'primary', summary: 'Google Calendar', primary: true, selected: true }] };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: 'google-event-xdev',
              summary: 'Cross-device Google Event',
              start: { dateTime: '2099-05-01T10:00:00-05:00' },
              end: { dateTime: '2099-05-01T10:30:00-05:00' },
            },
          ],
        };
      },
    };
  };

  try {
    const { GET } = loadRoute();
    const response = await GET(mockRequest());

    assert.equal(fetchedUrls.length, 2, '应直接用 Supabase token 打 Google(calendarList + events),而不是掉进 iCal 兜底。');
    assert.ok(fetchedUrls.every((f) => f.authorization === 'Bearer supabase-access-token'), '用的是 Supabase 里的 token,不是 cookie。');
    assert.equal(response.body.ok, true);
    assert.equal(response.body.provider, 'google_calendar_oauth');
    assert.equal(response.body.events[0].title, 'Cross-device Google Event');
  } finally {
    mockSupabaseCalendarToken = null;
  }
}

async function testOauthRefreshCookieRecoversExpiredCalendarAccess() {
  clearCalendarEnv();
  mockBaoheAuthCookie = 'baohe-session';
  mockCalendarAccessCookie = 'expired-google-access-token';
  mockCalendarRefreshCookie = 'google-refresh-token';
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
  const fetchedUrls = [];
  const authorizations = [];

  global.fetch = async (url, init = {}) => {
    const urlText = String(url);
    fetchedUrls.push(urlText);
    authorizations.push(init.headers?.Authorization || init.headers?.authorization || '');
    const auth = authorizations.at(-1);

    // 过期 token:calendarList 与 events 都 401(→ 路由走刷新链)
    if ((urlText.includes('/users/me/calendarList') || urlText.includes('/calendar/v3/calendars/primary/events')) && auth === 'Bearer expired-google-access-token') {
      return {
        ok: false,
        status: 401,
        async json() {
          return {};
        },
      };
    }

    if (urlText === 'https://oauth2.googleapis.com/token') {
      const body = init.body?.toString?.() || '';
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=google-refresh-token/);
      return {
        ok: true,
        async json() {
          return {
            access_token: 'fresh-google-access-token',
            refresh_token: 'fresh-google-refresh-token',
            expires_in: 3600,
          };
        },
      };
    }

    if (urlText.includes('/users/me/calendarList') && auth === 'Bearer fresh-google-access-token') {
      return {
        ok: true,
        async json() {
          return { items: [{ id: 'primary', summary: 'Google Calendar', primary: true, selected: true }] };
        },
      };
    }

    if (urlText.includes('/calendar/v3/calendars/primary/events') && auth === 'Bearer fresh-google-access-token') {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: 'google-event-refreshed',
                summary: 'Refreshed Google OAuth Event',
                start: { dateTime: '2099-03-01T10:00:00-05:00' },
                end: { dateTime: '2099-03-01T10:30:00-05:00' },
              },
            ],
          };
        },
      };
    }

    throw new Error(`Unexpected fetch in refresh test: ${urlText}`);
  };

  const { GET } = loadRoute();
  const response = await GET(mockRequest());

  assert.equal(response.body.ok, true);
  assert.equal(response.body.provider, 'google_calendar_oauth');
  assert.equal(response.body.status, 'calendar_session_refreshed');
  assert.equal(response.body.events[0].title, 'Refreshed Google OAuth Event');
  assert.deepEqual(
    fetchedUrls.map((url) => (url === 'https://oauth2.googleapis.com/token' ? url : new URL(url).origin + new URL(url).pathname)),
    [
      // 过期尝试:calendarList 401(容错回退 primary)→ primary events 401 → 走刷新
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      'https://oauth2.googleapis.com/token',
      // 刷新后重试:calendarList → primary events
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    ],
  );
  assert.equal(response.cookiesSet.find((cookie) => cookie.name === 'nesio_google_calendar_access')?.value, 'fresh-google-access-token');
  assert.equal(response.cookiesSet.find((cookie) => cookie.name === 'nesio_google_calendar_refresh')?.value, 'fresh-google-refresh-token');
}

const originalFetch = global.fetch;
try {
  await testConfiguredFeedFailsClosedWithoutGate();
  await testStaticIcsFeedSubscriptionRemoved();
  await testOauthCookieReadsGoogleCalendarApiWithoutIcsEnv();
  await testSupabaseTokenReadsCalendarCrossDeviceWithoutCookie();
  await testOauthRefreshCookieRecoversExpiredCalendarAccess();
  console.log('calendar fail-closed route tests passed');
} finally {
  global.fetch = originalFetch;
  mockCalendarAccessCookie = '';
  mockCalendarRefreshCookie = '';
  mockBaoheAuthCookie = '';
  mockSupabaseCalendarToken = null;
  clearCalendarEnv();
}
