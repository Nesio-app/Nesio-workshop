import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const importRoute = read('app/api/auth/import/route.ts');
const authClient = read('lib/portal/auth/auth-client.ts');
const layout = read('app/layout.tsx');
const authHashImportBridge = read('components/portal/AuthHashImportBridge.tsx');
const portal = read('components/portal/Portal.tsx');
const loginPage = read('components/portal/LoginPageClient.tsx');
const packageJson = JSON.parse(read('package.json'));

assert.match(importRoute, /POST\(/, 'implicit session import route must expose POST');
assert.match(importRoute, /auth\/v1\/user/, 'implicit session import must verify the access token with Supabase before setting cookies');
assert.match(importRoute, /cookies\.set\(['"]baohe_auth_access/, 'implicit session import must write the validated access token to an httpOnly cookie');
assert.match(importRoute, /cookies\.set\(['"]baohe_auth_refresh/, 'implicit session import must persist refresh token when Supabase provides one');
assert.match(importRoute, /cookies\.set\(['"]baohe_auth_provider/, 'implicit session import must persist the verified auth provider for account state');
assert.match(importRoute, /app_metadata\?\.provider/, 'implicit session import must derive provider state from the verified Supabase user');
assert.match(importRoute, /httpOnly:\s*true/, 'implicit session import cookies must be httpOnly');
assert.match(importRoute, /sameSite:\s*['"]lax['"]/, 'implicit session import cookies must use SameSite=Lax');
assert.match(importRoute, /secretsRedacted:\s*true/, 'implicit session import responses must mark secrets as redacted');
assert.match(importRoute, /type\?:\s*unknown/, 'implicit session import must accept Supabase auth type metadata from hash links');
assert.match(importRoute, /authType/, 'implicit session import response must expose safe Supabase auth type metadata');
assert.match(importRoute, /authMode/, 'implicit session import response must expose product login/register mode');
assert.match(importRoute, /signup[\s\S]*register/, 'signup hash imports must be surfaced as register mode');
assert.match(importRoute, /profileBootstrapped/, 'implicit session import response must expose product profile bootstrap success.');
assert.match(importRoute, /profileBootstrapStatus/, 'implicit session import response must expose product profile bootstrap status.');
assert.match(importRoute, /magiclink[\s\S]*login/, 'magiclink hash imports must be surfaced as login mode');
assert.doesNotMatch(importRoute, /accessToken[\s\S]*NextResponse\.json/, 'implicit session import must not echo the raw access token in JSON');
assert.doesNotMatch(importRoute, /refreshToken[\s\S]*NextResponse\.json/, 'implicit session import must not echo the raw refresh token in JSON');

assert.match(authClient, /readSupabaseAuthHash/, 'auth client must parse Supabase implicit-flow hash sessions');
assert.match(authClient, /access_token/, 'auth client must recognize Supabase access_token hashes');
assert.match(authClient, /type:\s*params\.get\(['"]type['"]\)[\s\S]*trim/, 'auth client must preserve Supabase hash type for product login/register semantics');
assert.match(authClient, /profileBootstrapped\?: boolean/, 'auth hash import result must type product profile bootstrap success.');
assert.match(authClient, /profileBootstrapStatus\?: string/, 'auth hash import result must type product profile bootstrap status.');
assert.match(authClient, /profileBootstrapped:\s*Boolean\(data\?\.profileBootstrapped\)/, 'auth client must propagate product profile bootstrap success.');
assert.match(authClient, /profileBootstrapStatus:\s*data\?\.profileBootstrapStatus/, 'auth client must propagate product profile bootstrap status.');
assert.match(authClient, /\/api\/auth\/import/, 'auth client must import implicit tokens through the server import route');
assert.match(authClient, /history\.replaceState/, 'auth client must clear token hashes from the visible URL after import');
assert.doesNotMatch(
  authClient,
  /localStorage\.setItem\(\s*['"][^'"]*['"]\s*,[\s\S]{0,120}(accessToken|refreshToken|access_token|refresh_token)/,
  'auth client must not persist auth tokens in localStorage',
);

assert.match(layout, /AuthHashImportBridge/, 'Root layout must mount the auth hash import bridge for all routes');
assert.match(authHashImportBridge, /importSupabaseHashSession/, 'AuthHashImportBridge must import Supabase hash sessions outside the portal route');
assert.match(authHashImportBridge, /nesio-auth-session-imported/, 'AuthHashImportBridge must broadcast the imported auth session for runtime consumers');
assert.match(authHashImportBridge, /window\.location\.hash/, 'AuthHashImportBridge must react to Supabase hash links on the current route');

assert.match(portal, /importSupabaseHashSession/, 'Portal must import Supabase hash sessions before reading the auth session');
assert.match(portal, /importSupabaseHashSession\(\)[\s\S]{0,500}refreshAuthSession/, 'Portal imports hash session before refreshing auth via session-state');
assert.match(portal, /fetchAuthSessionPayload[\s\S]*readSession/, 'Portal session lookup goes through session-state readSession');
assert.match(loginPage, /importSupabaseHashSession/, 'Login page must recover if Supabase redirects hash tokens to /login');
assert.match(loginPage, /importSupabaseHashSession\(\)[\s\S]{0,600}result\.ok[\s\S]{0,120}window\.location\.href = '\/'/, 'Login page must return users home after importing a hash session');

assert.equal(
  packageJson.scripts['test:auth-implicit-session-import'],
  'node scripts/auth-implicit-session-import.test.mjs',
  'package.json must expose the implicit session import regression test',
);

console.log('auth implicit session import tests passed');
