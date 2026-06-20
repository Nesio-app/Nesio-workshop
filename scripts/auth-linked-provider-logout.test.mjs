import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const logoutRoute = readFileSync(join(root, 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const cookieName of [
  'baohe_auth_access',
  'baohe_auth_refresh',
  'baohe_auth_provider',
  'baohe_wechat_openid',
  'baohe_wechat_unionid',
  'baohe_wechat_refresh',
  'nesio_google_calendar_access',
  'nesio_google_calendar_refresh',
]) {
  assert.match(
    logoutRoute,
    new RegExp(`expireAuthCookie\\(response, ['"]${cookieName}['"]\\)`),
    `Logout must clear linked provider cookie: ${cookieName}`,
  );
}

assert.doesNotMatch(
  logoutRoute,
  /cookies\.get\(['"]nesio_google_calendar_access['"]\)[\s\S]*NextResponse\.json/,
  'Logout must not echo Google Calendar OAuth tokens into the response.',
);

assert.equal(
  pkg.scripts['test:auth-linked-provider-logout'],
  'node scripts/auth-linked-provider-logout.test.mjs',
  'package.json must expose test:auth-linked-provider-logout.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:auth-linked-provider-logout/,
  'test:contracts must include linked provider logout coverage.',
);

console.log('auth linked provider logout checks passed');
