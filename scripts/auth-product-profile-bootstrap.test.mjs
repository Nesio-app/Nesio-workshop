#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const helperPath = path.join(root, 'lib', 'portal', 'cloud-account-profile.ts');
const callbackPath = path.join(root, 'app', 'api', 'auth', 'callback', 'route.ts');
const importPath = path.join(root, 'app', 'api', 'auth', 'import', 'route.ts');
const sessionPath = path.join(root, 'app', 'api', 'auth', 'session', 'route.ts');
const startPath = path.join(root, 'app', 'api', 'auth', 'start', 'route.ts');
const portalPath = path.join(root, 'components', 'portal', 'Portal.tsx');
const onboardingPath = path.join(root, 'components', 'portal', 'PortalOnboarding.tsx');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(helperPath), 'cloud account profile bootstrap helper is missing.');

const helper = fs.readFileSync(helperPath, 'utf8');
for (const marker of [
  'bootstrapCloudAccountProfile',
  '/rest/v1/user_profiles',
  'getCloudConfig',
  'serviceRoleRestHeaders',
  'on_conflict',
  'identity_key',
  'last_seen_at',
  'profile_bootstrapped',
  'profileBootstrapStatus',
  'profileBootstrapBlocking',
  'authReady',
]) {
  assert.ok(helper.includes(marker), `cloud account profile helper missing marker: ${marker}`);
}
assert.doesNotMatch(helper, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/, 'cloud account profile helper must use cloud runtime headers instead of direct service role env reads.');
assert.doesNotMatch(helper, /process\.env\.CLOUD_DB_ENABLED/, 'cloud account profile helper must use cloud runtime config instead of direct cloud env reads.');
assert.match(helper, /profile_bootstrap_deferred:user_profiles_unavailable[^]*identityKey:\s*row\.identity_key/s, 'profile bootstrap must preserve cloud identity when product profile table is deferred.');

for (const [label, filePath] of [
  ['auth callback route', callbackPath],
  ['auth import route', importPath],
  ['auth session route', sessionPath],
]) {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.ok(source.includes('bootstrapCloudAccountProfile'), `${label} must bootstrap product user profile.`);
}

const callback = fs.readFileSync(callbackPath, 'utf8');
assert.match(callback, /bootstrapCloudAccountProfile\([^)]*session\?\.access_token/s, 'auth callback must bootstrap after Supabase code/OTP session exchange.');
assert.match(callback, /profileBootstrapStatus/s, 'auth callback redirect must expose safe product profile bootstrap status.');
assert.match(callback, /profileBootstrapBlocking/s, 'auth callback redirect must mark product profile bootstrap as non-blocking.');
assert.match(callback, /authReady/s, 'auth callback redirect must expose whether auth is ready independent of profile bootstrap.');

const importRoute = fs.readFileSync(importPath, 'utf8');
assert.match(importRoute, /bootstrapCloudAccountProfile\([^)]*accessToken/s, 'auth import must bootstrap after hash-token import.');
assert.match(importRoute, /profileBootstrapped/s, 'auth import response must expose whether product profile was bootstrapped.');
assert.match(importRoute, /profileBootstrapStatus/s, 'auth import response must expose safe product profile bootstrap status.');
assert.match(importRoute, /profileBootstrapBlocking/s, 'auth import response must expose non-blocking product profile bootstrap marker.');
assert.match(importRoute, /authReady/s, 'auth import response must expose auth-ready marker.');
assert.doesNotMatch(importRoute, /identityKey[^]*safeJson/s, 'auth import response must not expose product identity key.');

const sessionRoute = fs.readFileSync(sessionPath, 'utf8');
assert.match(sessionRoute, /bootstrapCloudAccountProfile\([^)]*accessCookie/s, 'auth session must bootstrap signed-in access cookie sessions.');
assert.match(sessionRoute, /bootstrapCloudAccountProfile\([^)]*refreshedSession\.access_token/s, 'auth session must bootstrap refreshed sessions.');
assert.match(sessionRoute, /profileBootstrapped/s, 'auth session response must expose whether product profile was bootstrapped.');
assert.match(sessionRoute, /profileBootstrapStatus/s, 'auth session response must expose safe product profile bootstrap status.');
assert.match(sessionRoute, /profileBootstrapBlocking/s, 'auth session response must expose non-blocking product profile bootstrap marker.');
assert.match(sessionRoute, /authReady/s, 'auth session response must expose auth-ready marker.');

const appApiClient = fs.readFileSync(path.join(root, 'lib', 'portal', 'app-api-client.ts'), 'utf8');
assert.match(appApiClient, /profileBootstrapped\?: boolean/s, 'AuthSessionResponse must type product profile bootstrap status.');
assert.match(appApiClient, /profileBootstrapStatus\?: string/s, 'AuthSessionResponse must type product profile bootstrap reason.');
assert.match(appApiClient, /profileBootstrapBlocking\?: boolean/s, 'AuthSessionResponse must type product profile bootstrap blocking marker.');
assert.match(appApiClient, /authReady\?: boolean/s, 'AuthSessionResponse must type auth-ready marker.');

const portal = fs.readFileSync(portalPath, 'utf8');
assert.match(portal, /fetch\('\/api\/auth\/session'/s, 'Portal must refresh signed-in state from the auth session endpoint.');
assert.match(portal, /const loggedIn\s*=\s*Boolean\(data\.loggedIn\)/s, 'Portal must trust loggedIn for UI auth state once the session payload is definitive.');
assert.match(portal, /const sessionReady\s*=\s*loggedIn\s*&&\s*data\.authReady\s*!==\s*false\s*&&\s*data\.profileBootstrapBlocking\s*!==\s*true/s, 'Portal must treat product profile bootstrap as non-blocking while still respecting auth readiness.');
assert.match(portal, /markNesioOnboardingDoneForAuth\(\)/s, 'Portal must persist onboarding completion when a signed-in session is ready.');
assert.match(portal, /window\.dispatchEvent\(new CustomEvent\(NESIO_ONBOARDING_COMPLETE_EVENT/s, 'Portal must notify onboarding when a signed-in session is ready.');
assert.match(portal, /canUsePrivateRuntime\s*=\s*authSessionLoggedIn\s*===\s*true/s, 'Portal private runtime/sync must require a definitive signed-in session (not unknown).');
assert.match(portal, /canViewPrivateData\s*=\s*authSessionLoggedIn\s*!==\s*false/s, 'Portal UI private view must stay sticky while session is unknown (avoid demo/empty flicker).');
assert.match(portal, /status\s*===\s*['"]session_unverified['"]/s, 'Portal must treat session_unverified as unknown, not signed-out.');
assert.match(portal, /useState<\s*boolean\s*\|\s*null\s*>\s*\(\s*null\s*\)/s, 'Portal auth login bit must be tri-state (true/false/null).');
assert.doesNotMatch(portal, /\.finally\(\s*\(\)\s*=>\s*\{\s*if\s*\(\s*!cancelled\s*\)\s*setAuthReady\(true\);\s*\}\s*\)\s*;\s*\n\s*window\.addEventListener/s, 'Portal must not set authReady in an outer finally that races ahead of the session fetch.');
assert.doesNotMatch(portal, /profileBootstrapped|profileBootstrapStatus/s, 'Portal UI gate must not bounce signed-in users because product profile bootstrap is unavailable.');

const onboarding = fs.readFileSync(onboardingPath, 'utf8');
assert.match(onboarding, /NESIO_ONBOARDING_DONE_KEYS/s, 'PortalOnboarding must share the auth onboarding completion keys.');
assert.match(onboarding, /NESIO_ONBOARDING_COMPLETE_EVENT/s, 'PortalOnboarding must listen for the shared auth onboarding completion event.');
assert.match(onboarding, /markNesioOnboardingDoneForAuth\(\)/s, 'PortalOnboarding must use the shared auth onboarding completion helper.');
assert.match(onboarding, /authReady\?: boolean/s, 'PortalOnboarding must understand auth-ready marker.');
assert.match(onboarding, /profileBootstrapBlocking\?: boolean/s, 'PortalOnboarding must understand non-blocking profile marker.');
assert.match(onboarding, /function isAuthReadySession/s, 'PortalOnboarding must gate onboarding completion on auth readiness, not product profile availability.');
assert.match(onboarding, /function hasAuthReadyCallbackSuccess/s, 'PortalOnboarding must treat auth-ready callback URLs as successful even if immediate session refresh races.');
assert.match(onboarding, /params\.get\('authReady'\)\s*!==\s*'false'/s, 'PortalOnboarding must only reject callback auth readiness when the callback explicitly says authReady=false.');
assert.match(onboarding, /params\.get\('profileBootstrapBlocking'\)\s*!==\s*'true'/s, 'PortalOnboarding must only block callback completion when product profile bootstrap is explicitly blocking.');
assert.match(onboarding, /const callbackReady\s*=\s*hasAuthReadyCallbackSuccess\(\)/s, 'PortalOnboarding hydrate must compute callback readiness before clearing callback params.');
assert.match(onboarding, /if \(callbackReady\)[^]*completeOnboardingAfterAuth\(\{\s*showTips:\s*false\s*\}\)[^]*clearAuthCallbackParams\(\)[^]*return;/s, 'PortalOnboarding must complete onboarding from a successful auth callback if the session endpoint is still racing.');
assert.match(onboarding, /completeOnboardingAfterAuth\(\{\s*showTips:\s*false\s*\}\)/s, 'PortalOnboarding must not show first-use tips immediately after auth callback/session import.');
assert.doesNotMatch(onboarding, /completeOnboardingAfterAuth\(\{\s*showTips:\s*!done\s*\}\)/s, 'PortalOnboarding must not bounce newly signed-in users into first-use tips based on onboarding done state.');
assert.match(onboarding, /'authReady'[^]*'profileBootstrapBlocking'/s, 'PortalOnboarding must clear auth callback readiness markers after consuming them.');

const authClient = fs.readFileSync(path.join(root, 'lib', 'portal', 'auth', 'auth-client.ts'), 'utf8');
assert.match(authClient, /NESIO_ONBOARDING_DONE_KEYS/s, 'auth client must expose shared onboarding completion keys.');
assert.match(authClient, /NESIO_ONBOARDING_COMPLETE_EVENT/s, 'auth client must expose a shared onboarding completion event.');
assert.match(authClient, /function markNesioOnboardingDoneForAuth/s, 'auth client must expose a helper to mark onboarding complete after auth.');
assert.doesNotMatch(authClient, /isNesioApex|host === 'nesio\.app'|hostname === 'nesio\.app'/s, 'auth client must not rewrite nesio.app callbacks to a different host because auth cookies are host-only.');

const startRoute = fs.readFileSync(startPath, 'utf8');
assert.match(startRoute, /auth[^]*cookies\s+are\s+host-only/s, 'auth start route must document the host-only callback boundary.');
assert.doesNotMatch(startRoute, /url\.hostname\s*=\s*['"]www\.nesio\.app['"]/s, 'auth start route must not rewrite nesio.app callbacks to www.nesio.app.');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert.equal(pkg.scripts['test:auth-product-profile-bootstrap'], 'node scripts/auth-product-profile-bootstrap.test.mjs');
assert.match(pkg.scripts['test:contracts'], /test:auth-product-profile-bootstrap/);

console.log('auth product profile bootstrap contract passed');
