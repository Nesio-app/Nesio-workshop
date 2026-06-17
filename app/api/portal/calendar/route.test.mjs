import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = new URL('./route.ts', import.meta.url);
const fixturePath = new URL('./__fixtures__/mock-private.ics', import.meta.url);

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
    console,
    require(specifier) {
      if (specifier === 'next/server') {
        return {
          NextResponse: {
            json(body, init = {}) {
              return { body, init };
            },
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

const originalFetch = global.fetch;
try {
  await testConfiguredFeedFailsClosedWithoutGate();
  await testConfiguredFeedUsesMockOnlyWhenGateEnabled();
  console.log('calendar fail-closed route tests passed');
} finally {
  global.fetch = originalFetch;
  clearCalendarEnv();
}
