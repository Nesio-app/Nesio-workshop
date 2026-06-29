#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const helperPath = path.join(root, 'lib', 'portal', 'cloud-account-profile.ts');
const callbackPath = path.join(root, 'app', 'api', 'auth', 'callback', 'route.ts');
const importPath = path.join(root, 'app', 'api', 'auth', 'import', 'route.ts');
const sessionPath = path.join(root, 'app', 'api', 'auth', 'session', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(helperPath), 'cloud account profile bootstrap helper is missing.');

const helper = fs.readFileSync(helperPath, 'utf8');
for (const marker of [
  'bootstrapCloudAccountProfile',
  '/rest/v1/user_profiles',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUD_DB_ENABLED',
  'on_conflict',
  'identity_key',
  'last_seen_at',
  'profile_bootstrapped',
  'profileBootstrapStatus',
]) {
  assert.ok(helper.includes(marker), `cloud account profile helper missing marker: ${marker}`);
}

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

const importRoute = fs.readFileSync(importPath, 'utf8');
assert.match(importRoute, /bootstrapCloudAccountProfile\([^)]*accessToken/s, 'auth import must bootstrap after hash-token import.');
assert.match(importRoute, /profileBootstrapped/s, 'auth import response must expose whether product profile was bootstrapped.');
assert.match(importRoute, /profileBootstrapStatus/s, 'auth import response must expose safe product profile bootstrap status.');
assert.doesNotMatch(importRoute, /identityKey[^]*safeJson/s, 'auth import response must not expose product identity key.');

const sessionRoute = fs.readFileSync(sessionPath, 'utf8');
assert.match(sessionRoute, /bootstrapCloudAccountProfile\([^)]*accessCookie/s, 'auth session must bootstrap signed-in access cookie sessions.');
assert.match(sessionRoute, /bootstrapCloudAccountProfile\([^)]*refreshedSession\.access_token/s, 'auth session must bootstrap refreshed sessions.');
assert.match(sessionRoute, /profileBootstrapped/s, 'auth session response must expose whether product profile was bootstrapped.');
assert.match(sessionRoute, /profileBootstrapStatus/s, 'auth session response must expose safe product profile bootstrap status.');

const appApiClient = fs.readFileSync(path.join(root, 'lib', 'portal', 'app-api-client.ts'), 'utf8');
assert.match(appApiClient, /profileBootstrapped\?: boolean/s, 'AuthSessionResponse must type product profile bootstrap status.');
assert.match(appApiClient, /profileBootstrapStatus\?: string/s, 'AuthSessionResponse must type product profile bootstrap reason.');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert.equal(pkg.scripts['test:auth-product-profile-bootstrap'], 'node scripts/auth-product-profile-bootstrap.test.mjs');
assert.match(pkg.scripts['test:contracts'], /test:auth-product-profile-bootstrap/);

console.log('auth product profile bootstrap contract passed');
