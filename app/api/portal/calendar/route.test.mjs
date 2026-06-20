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

async function testConfiguredFeedFailsClosedWithoutGate() {
  clearCalendarEnv();
  process.env.GOOGLE_CALENDAR_ICAL_URL = 'https://example.test/private.ics';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch must not be called without calendar safety gate');
  };

  const { GET } = loadRoute();
  const response = await GET();

  assert.equal(fetchCalled, false);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.events.length, 0);
  assert.match(response.body.message, /disabled/i);
  assert.doesNotMatch(JSON.stringify(response.body), /Sensitive Private Meeting/);
}

async function testConfiguredFeedUsesMockOnlyWhenGateEnabled() {
  clearCalendarEnv();
  process.env.GOOGLE_CALENDAR_ICAL_URL = 'https://example.test/private.ics';
  process.env.CALENDAR_PRIVATE_FEEDS_ENABLED = 'true';
  const mockIcs = fs.readFileSync(fixturePath, 'utf8');
  const fetchedUrls = [];
  global.fetch = async (url) => {
    fetchedUrls.push(String(url));
    return {
      ok: true,
      async text() {
        return mockIcs;
      },
    };
  };

  const { GET } = loadRoute();
  const response = await GET();

  assert.deepEqual(fetchedUrls, ['https://example.test/private.ics']);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.events[0].title, 'Sensitive Private Meeting');
}

async function testOauthCookieReadsGoogleCalendarApiWithoutIcsEnv() {
  clearCalendarEnv();
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
  const response = await GET();

  assert.equal(fetchedUrls.length, 1);
  assert.match(fetchedUrls[0].url, /https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events/);
  assert.equal(fetchedUrls[0].authorization, 'Bearer google-access-token');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.provider, 'google_calendar_oauth');
  assert.equal(response.body.events[0].title, 'Google OAuth Event');
  assert.equal(response.body.events[0].source, 'Google Calendar');
}

async function testOauthRefreshCookieRecoversExpiredCalendarAccess() {
  clearCalendarEnv();
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
  const response = await GET();

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
  await testConfiguredFeedUsesMockOnlyWhenGateEnabled();
  await testOauthCookieReadsGoogleCalendarApiWithoutIcsEnv();
  await testOauthRefreshCookieRecoversExpiredCalendarAccess();
  console.log('calendar fail-closed route tests passed');
} finally {
  global.fetch = originalFetch;
  mockCalendarAccessCookie = '';
  mockCalendarRefreshCookie = '';
  clearCalendarEnv();
}
