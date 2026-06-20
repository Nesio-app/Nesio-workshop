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
