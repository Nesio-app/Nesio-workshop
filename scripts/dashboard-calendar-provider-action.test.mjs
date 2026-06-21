import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'components', 'portal', 'DashboardHome.tsx'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const marker of [
  'createAppApiClient',
  'ProductionRuntimeProviderAction',
  'fetchProductionRuntimeHealth',
  'providerActionMatrix',
  'calendarProviderAction',
  'google_calendar',
  'loadCalendarLinkSettings',
  'CALENDAR_LINK_UPDATED_EVENT',
]) {
  assert.ok(source.includes(marker), `DashboardHome calendar runtime must include marker: ${marker}`);
}

assert.match(
  source,
  /providerActionMatrix[\s\S]*provider\.id === 'google_calendar'/,
  'DashboardHome must derive Google Calendar state from providerActionMatrix.',
);

assert.match(
  source,
  /calendarProviderAction\?\.actionStatus === 'ready'/,
  'DashboardHome must distinguish ready Google Calendar provider actions.',
);

assert.match(
  source,
  /calendarProviderAction\?\.serverOnly/,
  'DashboardHome must not expose server-only Google Calendar actions as direct frontend navigation.',
);

assert.match(
  source,
  /calendarLinkUrl[\s\S]*calendarProviderReady/,
  'DashboardHome must preserve local Google Calendar link fallback while supporting runtime provider readiness.',
);

assert.match(
  source,
  /const calendarProviderConnectUrl = calendarProviderReady\s*\?\s*\(calendarProviderAction\?\.startEndpoint \|\| '\/api\/portal\/calendar\/connect'\)\s*:\s*'';/,
  'DashboardHome must derive a Google Calendar OAuth connect URL from the ready provider action.',
);

assert.match(
  source,
  /if \(calendarProviderConnectUrl\)[\s\S]*window\.location\.href = calendarProviderConnectUrl;/,
  'DashboardHome calendar action must navigate ready Google Calendar providers into OAuth connect instead of only refreshing.',
);

assert.match(
  source,
  /calendarProviderConnectUrl \?[\s\S]*'接入'/,
  'DashboardHome must label the ready Google Calendar OAuth action as connect.',
);

assert.match(
  source,
  /const meetingJoinUrl = /,
  'DashboardHome meeting reminder must derive a real runtime join URL.',
);

assert.match(
  source,
  /const openMeetingJoinUrl = /,
  'DashboardHome meeting reminder must expose a runtime handler for its join action.',
);

assert.match(
  source,
  /meetingJoinUrl[\s\S]*calendarProviderConnectUrl[\s\S]*calendarLinkUrl[\s\S]*'\/settings'/,
  'DashboardHome meeting join action must fall back from event URL to provider connect, local calendar link, then settings.',
);

assert.match(
  source,
  /data-runtime-action="dashboard-open-meeting-link"[\s\S]*onClick=\{openMeetingJoinUrl\}/,
  'DashboardHome meeting join CTA must be wired to its runtime handler.',
);

assert.equal(
  packageJson.scripts['test:dashboard-calendar-provider-action'],
  'node scripts/dashboard-calendar-provider-action.test.mjs',
  'package.json must expose DashboardHome calendar provider action test',
);

assert.ok(
  packageJson.scripts['test:contracts'].includes('test:dashboard-calendar-provider-action'),
  'test:contracts must include DashboardHome calendar provider action test',
);

console.log('DashboardHome calendar provider action test passed');
