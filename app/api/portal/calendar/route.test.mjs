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
          mergeCalendarEvents(lists, limit) {
            return lists.flat().slice(0, limit);
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
      if (specifier === '@/lib/portal/env') {
        // 共享 env 助手(取代各路由本地 envValue);纯函数,忠实复制。
        return { envValue: (key) => (process.env[key] ?? '').trim() };
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
  global.fetch = async (url, init = {}) => {
    fetchedUrls.push({ url: String(url), authorization: init.headers?.Authorization || init.headers?.authorization || '' });
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
  };

  const { GET } = loadRoute();
  const response = await GET(mockRequest());

  assert.equal(fetchedUrls.length, 1);
  assert.match(fetchedUrls[0].url, /https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events/);
  assert.equal(fetchedUrls[0].authorization, 'Bearer google-access-token');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.provider, 'google_calendar_oauth');
  assert.equal(response.body.events[0].title, 'Google OAuth Event');
  assert.equal(response.body.events[0].source, 'Google Calendar');
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
    fetchedUrls.push({ url: String(url), authorization: init.headers?.Authorization || init.headers?.authorization || '' });
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

    assert.equal(fetchedUrls.length, 1, '应直接用 Supabase token 打 Google,而不是掉进 iCal 兜底。');
    assert.equal(fetchedUrls[0].authorization, 'Bearer supabase-access-token', '用的是 Supabase 里的 token,不是 cookie。');
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

    if (urlText.includes('/calendar/v3/calendars/primary/events') && authorizations.at(-1) === 'Bearer expired-google-access-token') {
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

    if (urlText.includes('/calendar/v3/calendars/primary/events') && authorizations.at(-1) === 'Bearer fresh-google-access-token') {
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
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      'https://oauth2.googleapis.com/token',
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
