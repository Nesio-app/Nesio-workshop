import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const connectRoute = read('app/api/portal/calendar/connect/route.ts');
const callbackRoute = read('app/api/portal/calendar/oauth/callback/route.ts');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  connectRoute,
  /createCalendarOAuthAuditId/,
  'Google Calendar connect route must create a per-request OAuth audit id.',
);
assert.match(
  connectRoute,
  /nesio_google_calendar_oauth_state/,
  'Google Calendar connect route must set an httpOnly state cookie for OAuth CSRF protection.',
);
assert.match(
  connectRoute,
  /calendar_oauth_start/,
  'Google Calendar connect route must log a redacted OAuth start audit event.',
);
assert.doesNotMatch(
  connectRoute,
  /state', 'nesio_google_calendar'|state", "nesio_google_calendar"/,
  'Google Calendar connect route must not use a static OAuth state value.',
);

assert.match(
  callbackRoute,
  /source\.searchParams\.get\('state'\)/,
  'Google Calendar callback route must read the returned OAuth state.',
);
assert.match(
  callbackRoute,
  /nesio_google_calendar_oauth_state/,
  'Google Calendar callback route must verify the stored OAuth state cookie.',
);
assert.match(
  callbackRoute,
  /calendar_oauth_state_mismatch/,
  'Google Calendar callback route must fail closed on OAuth state mismatch.',
);
assert.match(
  callbackRoute,
  /calendar_oauth_callback/,
  'Google Calendar callback route must log a redacted callback audit event.',
);
assert.match(
  callbackRoute,
  /auditId/,
  'Google Calendar OAuth redirects must include auditId for support/debug correlation.',
);
assert.match(
  callbackRoute,
  /delete\(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE\)/,
  'Google Calendar callback route must clear the one-time OAuth state cookie.',
);
assert.doesNotMatch(
  `${connectRoute}\n${callbackRoute}`,
  /console\.(?:info|warn|error)\([^\n]*(?:clientSecret|access_token|refresh_token|Authorization|Bearer)/,
  'Google Calendar OAuth audit logs must not print secrets or tokens.',
);

assert.equal(
  packageJson.scripts['test:calendar-oauth-state-audit'],
  'node scripts/calendar-oauth-state-audit.test.mjs',
  'package.json must expose calendar OAuth state audit test.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:calendar-oauth-state-audit/,
  'test:security must include calendar OAuth state audit coverage.',
);

console.log('calendar OAuth state audit tests passed');
