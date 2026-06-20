import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const healthRoute = read('app/api/portal/production/health/route.ts');
const authStartRoute = read('app/api/auth/start/route.ts');
const authCallbackRoute = read('app/api/auth/callback/route.ts');
const runtimeHelper = read('lib/portal/production-runtime.ts');
const packageJson = JSON.parse(read('package.json'));

for (const source of [healthRoute, authStartRoute, authCallbackRoute]) {
  assert.match(source, /redact|safe|public/i, 'production runtime routes must explicitly redact or expose only safe status');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY[^?].*NextResponse\.json/s, 'routes must not return service role secrets');
  assert.doesNotMatch(source, /WECHAT_APP_SECRET[^?].*NextResponse\.json/s, 'routes must not return WeChat secrets');
  assert.doesNotMatch(source, /OPENAI_API_KEY[^?].*NextResponse\.json/s, 'routes must not return AI secrets');
}

assert.match(healthRoute, /GET\(/, 'production health route must expose GET');
assert.match(runtimeHelper, /accountAuth/, 'production health must summarize account auth readiness');
assert.match(runtimeHelper, /cloud/, 'production health must summarize cloud readiness');
assert.match(runtimeHelper, /thirdParty/, 'production health must summarize third-party readiness');
assert.match(runtimeHelper, /ai/, 'production health must summarize AI readiness');

assert.match(authStartRoute, /POST\(/, 'auth start route must expose POST');
assert.match(authStartRoute, /email/, 'auth start must support email provider');
assert.match(authStartRoute, /google/, 'auth start must support Google provider');
assert.match(authStartRoute, /wechat/, 'auth start must support WeChat provider');
assert.match(authStartRoute, /phone/, 'auth start must support phone provider');
assert.match(authStartRoute, /503/, 'auth start must fail closed when provider config is missing');
assert.match(authCallbackRoute, /GET\(/, 'auth callback route must expose GET');
assert.match(authCallbackRoute, /NextResponse\.redirect/, 'auth callback must redirect back to the Shell instead of 404ing');
assert.match(authCallbackRoute, /auth_callback_received/, 'auth callback must expose safe callback status');
assert.match(authCallbackRoute, /auth\/v1\/token/, 'auth callback must exchange Supabase authorization code for a session');
assert.match(authCallbackRoute, /grant_type['"]?\s*:\s*['"]authorization_code/, 'auth callback must use authorization_code grant');
assert.match(authCallbackRoute, /cookies\.set\(['"]baohe_auth_access/, 'auth callback must store access token in an httpOnly cookie');
assert.match(authCallbackRoute, /cookies\.set\(['"]baohe_auth_refresh/, 'auth callback must store refresh token in an httpOnly cookie');
assert.match(authCallbackRoute, /httpOnly:\s*true/, 'auth callback cookies must be httpOnly');
assert.match(authCallbackRoute, /sameSite:\s*['"]lax['"]/, 'auth callback cookies must use SameSite=Lax');
assert.doesNotMatch(authCallbackRoute, /searchParams\.set\(['"]access_token/, 'auth callback must not echo access tokens into redirect URLs');
assert.doesNotMatch(authCallbackRoute, /searchParams\.set\(['"]refresh_token/, 'auth callback must not echo refresh tokens into redirect URLs');

assert.equal(
  packageJson.scripts['test:production-runtime-surface'],
  'node scripts/production-runtime-surface.test.mjs',
  'package.json must expose production runtime surface test',
);

console.log('production runtime surface tests passed');
