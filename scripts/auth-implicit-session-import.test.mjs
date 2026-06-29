import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const importRoute = read('app/api/auth/import/route.ts');
const authClient = read('lib/portal/auth-client.ts');
const portal = read('components/portal/Portal.tsx');
const loginPage = read('components/portal/LoginPageClient.tsx');
const packageJson = JSON.parse(read('package.json'));

assert.match(importRoute, /POST\(/, 'implicit session import route must expose POST');
assert.match(importRoute, /auth\/v1\/user/, 'implicit session import must verify the access token with Supabase before setting cookies');
assert.match(importRoute, /cookies\.set\(['"]baohe_auth_access/, 'implicit session import must write the validated access token to an httpOnly cookie');
assert.match(importRoute, /cookies\.set\(['"]baohe_auth_refresh/, 'implicit session import must persist refresh token when Supabase provides one');
assert.match(importRoute, /httpOnly:\s*true/, 'implicit session import cookies must be httpOnly');
assert.match(importRoute, /sameSite:\s*['"]lax['"]/, 'implicit session import cookies must use SameSite=Lax');
assert.match(importRoute, /secretsRedacted:\s*true/, 'implicit session import responses must mark secrets as redacted');
assert.doesNotMatch(importRoute, /accessToken[\s\S]*NextResponse\.json/, 'implicit session import must not echo the raw access token in JSON');
assert.doesNotMatch(importRoute, /refreshToken[\s\S]*NextResponse\.json/, 'implicit session import must not echo the raw refresh token in JSON');

assert.match(authClient, /readSupabaseAuthHash/, 'auth client must parse Supabase implicit-flow hash sessions');
assert.match(authClient, /access_token/, 'auth client must recognize Supabase access_token hashes');
assert.match(authClient, /\/api\/auth\/import/, 'auth client must import implicit tokens through the server import route');
assert.match(authClient, /history\.replaceState/, 'auth client must clear token hashes from the visible URL after import');
assert.doesNotMatch(authClient, /localStorage\.setItem[\s\S]*(accessToken|refreshToken|access_token|refresh_token)/, 'auth client must not persist auth tokens in localStorage');

assert.match(portal, /importSupabaseHashSession/, 'Portal must import Supabase hash sessions before reading the auth session');
assert.match(portal, /importSupabaseHashSession\(\)[\s\S]*\/api\/auth\/session/, 'Portal must import hash session before session lookup');
assert.match(loginPage, /importSupabaseHashSession/, 'Login page must recover if Supabase redirects hash tokens to /login');
assert.match(loginPage, /result\.imported && result\.ok[\s\S]*window\.location\.href = '\/'/, 'Login page must return users home after importing a hash session');

assert.equal(
  packageJson.scripts['test:auth-implicit-session-import'],
  'node scripts/auth-implicit-session-import.test.mjs',
  'package.json must expose the implicit session import regression test',
);

console.log('auth implicit session import tests passed');
