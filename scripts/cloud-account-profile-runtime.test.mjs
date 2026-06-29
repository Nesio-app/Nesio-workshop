#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-user-profiles-v1.sql');
const routePath = path.join(root, 'app', 'api', 'cloud', 'account', 'route.ts');
const statusPath = path.join(root, 'app', 'api', 'cloud', 'status', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const readmePath = path.join(root, 'database', 'README.md');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase user profile schema must exist.');
assert.ok(fs.existsSync(routePath), 'cloud account route must exist at app/api/cloud/account/route.ts.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const statusRoute = fs.readFileSync(statusPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.user_profiles',
  'identity_key text PRIMARY KEY',
  'user_id uuid REFERENCES auth.users',
  'email text',
  'provider text',
  'providers text[]',
  'display_name text',
  'avatar_url text',
  'onboarding_completed boolean NOT NULL DEFAULT false',
  'last_seen_at timestamptz',
  'ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY',
  'auth.uid() = user_id',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

for (const marker of [
  'export async function GET',
  'export async function POST',
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'deriveCloudIdentity',
  '/auth/v1/user',
  '/rest/v1/user_profiles',
  'upsertCloudAccountProfile',
  'sanitizeAccountProfilePatch',
  'not_signed_in',
  'cloud_not_configured',
  'safePublicStatus',
  'secretsRedacted',
  'readsCloud',
  'writesCloud',
]) {
  assert.ok(route.includes(marker), `cloud account route missing marker: ${marker}`);
}

assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/, 'cloud account route must not serialize service role secrets.');

for (const marker of [
  'cloudAccountEndpoint',
  '/api/cloud/account',
  "userProfiles: 'user_profiles'",
]) {
  assert.ok(statusRoute.includes(marker), `cloud status route missing account marker: ${marker}`);
}

for (const marker of [
  'CloudAccountProfile',
  'CloudAccountProfileResponse',
  'cloudAccount',
  '/api/cloud/account',
  'fetchCloudAccountProfile',
  'saveCloudAccountProfile',
]) {
  assert.ok(client.includes(marker), `app-api-client missing account marker: ${marker}`);
}

assert.match(readme, /supabase-user-profiles-v1\.sql/, 'database README must document user_profiles schema.');
assert.equal(pkg.scripts['test:cloud-account-profile-runtime'], 'node scripts/cloud-account-profile-runtime.test.mjs');
assert.match(pkg.scripts['test:contracts'], /test:cloud-account-profile-runtime/);

console.log('cloud account profile runtime contract passed');
