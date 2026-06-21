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
const authSessionRoute = read('app/api/auth/session/route.ts');
const authLogoutRoute = read('app/api/auth/logout/route.ts');
const calendarConnectRoute = read('app/api/portal/calendar/connect/route.ts');
const calendarOAuthCallbackRoute = read('app/api/portal/calendar/oauth/callback/route.ts');
const runtimeHelper = read('lib/portal/production-runtime.ts');
const packageJson = JSON.parse(read('package.json'));

for (const source of [healthRoute, authStartRoute, authCallbackRoute, authSessionRoute, authLogoutRoute, calendarConnectRoute, calendarOAuthCallbackRoute]) {
  assert.match(source, /redact|safe|public/i, 'production runtime routes must explicitly redact or expose only safe status');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY[^?].*NextResponse\.json/s, 'routes must not return service role secrets');
  assert.doesNotMatch(source, /WECHAT_APP_SECRET[^?].*NextResponse\.json/s, 'routes must not return WeChat secrets');
  assert.doesNotMatch(source, /OPENAI_API_KEY[^?].*NextResponse\.json/s, 'routes must not return AI secrets');
  assert.doesNotMatch(source, /GOOGLE_CLIENT_SECRET[^?].*NextResponse\.json/s, 'routes must not return Google client secrets');
}

assert.match(healthRoute, /GET\(/, 'production health route must expose GET');
assert.match(healthRoute, /request:\s*Request/, 'production health route must inspect the incoming request.');
assert.match(healthRoute, /canonicalHost|requestHost/, 'production health route must pass host context into safe status.');
assert.match(runtimeHelper, /accountAuth/, 'production health must summarize account auth readiness');
assert.match(runtimeHelper, /cloud/, 'production health must summarize cloud readiness');
assert.match(runtimeHelper, /thirdParty/, 'production health must summarize third-party readiness');
assert.match(runtimeHelper, /ai/, 'production health must summarize AI readiness');
assert.match(runtimeHelper, /canonicalDomain/, 'production health must expose the configured canonical domain.');
assert.match(runtimeHelper, /requestHost/, 'production health must expose the safe request host.');
assert.match(runtimeHelper, /canonicalDomainMatchesRequestHost/, 'production health must expose whether the request host matches canonical domain.');
assert.match(runtimeHelper, /canonicalDomainReady/, 'production readiness summary must include canonical domain readiness.');

assert.match(authStartRoute, /POST\(/, 'auth start route must expose POST');
assert.match(authStartRoute, /email/, 'auth start must support email provider');
assert.match(authStartRoute, /google/, 'auth start must support Google provider');
assert.match(authStartRoute, /wechat/, 'auth start must support WeChat provider');
assert.match(authStartRoute, /phone/, 'auth start must support phone provider');
assert.match(authStartRoute, /503/, 'auth start must fail closed when provider config is missing');
assert.match(authStartRoute, /const email = body\.email\?\.trim\(\) \|\| ''/, 'auth start must trim email before validating OTP input.');
assert.match(authStartRoute, /const phone = body\.phone\?\.trim\(\) \|\| ''/, 'auth start must trim phone before validating OTP input.');
assert.match(authStartRoute, /requestSupabaseOtp\(\{ email, redirectTo \}\)/, 'auth start must send the trimmed email to Supabase OTP.');
assert.match(authStartRoute, /requestSupabaseOtp\(\{ phone, redirectTo \}\)/, 'auth start must send the trimmed phone to Supabase OTP.');
assert.match(authCallbackRoute, /GET\(/, 'auth callback route must expose GET');
assert.match(authCallbackRoute, /NextResponse\.redirect/, 'auth callback must redirect back to the Shell instead of 404ing');
assert.match(authCallbackRoute, /auth_callback_received/, 'auth callback must expose safe callback status');
assert.match(authCallbackRoute, /auth\/v1\/token/, 'auth callback must exchange Supabase authorization code for a session');
assert.match(authCallbackRoute, /grant_type['"]?\s*:\s*['"]authorization_code/, 'auth callback must use authorization_code grant');
assert.match(authCallbackRoute, /token_hash/, 'auth callback must support Supabase email and phone OTP token_hash callback links');
assert.match(authCallbackRoute, /auth\/v1\/verify/, 'auth callback must verify Supabase token_hash OTP callbacks');
assert.match(authCallbackRoute, /SUPABASE_OTP_TYPES/, 'auth callback must allowlist Supabase OTP callback types');
assert.match(authCallbackRoute, /cookies\.set\(['"]baohe_auth_access/, 'auth callback must store access token in an httpOnly cookie');
assert.match(authCallbackRoute, /cookies\.set\(['"]baohe_auth_refresh/, 'auth callback must store refresh token in an httpOnly cookie');
assert.match(authCallbackRoute, /httpOnly:\s*true/, 'auth callback cookies must be httpOnly');
assert.match(authCallbackRoute, /sameSite:\s*['"]lax['"]/, 'auth callback cookies must use SameSite=Lax');
assert.doesNotMatch(authCallbackRoute, /searchParams\.set\(['"]access_token/, 'auth callback must not echo access tokens into redirect URLs');
assert.doesNotMatch(authCallbackRoute, /searchParams\.set\(['"]refresh_token/, 'auth callback must not echo refresh tokens into redirect URLs');
assert.match(authSessionRoute, /GET\(/, 'auth session route must expose GET');
assert.match(authSessionRoute, /cookies\(\).*baohe_auth_access|cookieStore\.get\(['"]baohe_auth_access/, 'auth session must read the access cookie');
assert.match(authSessionRoute, /cookieStore\.get\(['"]baohe_auth_refresh/, 'auth session must read the refresh cookie');
assert.match(authSessionRoute, /auth\/v1\/user/, 'auth session must verify the session with Supabase user endpoint when configured');
assert.match(authSessionRoute, /grant_type=refresh_token/, 'auth session must refresh an expired Supabase access session when a refresh cookie exists');
assert.match(authSessionRoute, /cookies\.set\(['"]baohe_auth_access/, 'auth session must persist refreshed access cookies');
assert.match(authSessionRoute, /cookies\.set\(['"]baohe_auth_refresh/, 'auth session must persist refreshed refresh cookies');
assert.match(authSessionRoute, /loggedIn/, 'auth session must expose a safe loggedIn status');
assert.match(authSessionRoute, /secretsRedacted:\s*true/, 'auth session must mark secrets as redacted');
assert.doesNotMatch(authSessionRoute, /access_token.*NextResponse\.json|refresh_token.*NextResponse\.json/s, 'auth session must not return raw tokens');
assert.match(authLogoutRoute, /POST\(/, 'auth logout route must expose POST');
assert.match(authLogoutRoute, /baohe_auth_access/, 'auth logout must clear the access cookie');
assert.match(authLogoutRoute, /baohe_auth_refresh/, 'auth logout must clear the refresh cookie');
assert.match(authLogoutRoute, /maxAge:\s*0/, 'auth logout must expire auth cookies');
assert.match(authLogoutRoute, /auth\/v1\/logout/, 'auth logout should best-effort revoke the Supabase session when configured');
assert.match(runtimeHelper, /state', 'nesio'|state", "nesio"/, 'WeChat OAuth state should use Nesio naming.');
assert.match(calendarConnectRoute, /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/, 'Google Calendar connect must redirect through Google OAuth.');
assert.match(calendarConnectRoute, /calendar\.readonly/, 'Google Calendar connect must request calendar readonly scope.');
assert.match(calendarConnectRoute, /provider_not_configured/, 'Google Calendar connect must fail closed when OAuth config is missing.');
assert.match(calendarOAuthCallbackRoute, /oauth2\.googleapis\.com\/token/, 'Google Calendar callback must exchange the OAuth code for tokens.');
assert.match(calendarOAuthCallbackRoute, /nesio_google_calendar_access/, 'Google Calendar callback must store access token in an httpOnly cookie.');
assert.match(calendarOAuthCallbackRoute, /nesio_google_calendar_refresh/, 'Google Calendar callback must store refresh token in an httpOnly cookie.');
assert.match(runtimeHelper, /google_calendar[\s\S]*\/api\/portal\/calendar\/connect/, 'Google Calendar provider action must point users at OAuth connect.');

assert.equal(
  packageJson.scripts['test:production-runtime-surface'],
  'node scripts/production-runtime-surface.test.mjs',
  'package.json must expose production runtime surface test',
);

console.log('production runtime surface tests passed');
