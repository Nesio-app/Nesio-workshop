import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-user-profiles-v1.sql');
const readmePath = path.join(root, 'database', 'README.md');
const routePath = path.join(root, 'app', 'api', 'cloud', 'account', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase user profiles schema must exist.');
assert.ok(fs.existsSync(routePath), 'cloud account route must exist.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.user_profiles',
  'identity_key text PRIMARY KEY',
  'user_id uuid REFERENCES auth.users',
  'email text',
  'provider text',
  'providers text[] NOT NULL DEFAULT',
  'display_name text',
  'avatar_url text',
  'onboarding_completed boolean NOT NULL DEFAULT false',
  'profile jsonb NOT NULL DEFAULT',
  'last_seen_at timestamptz',
  'ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY',
  'auth.uid() = user_id',
  'CREATE INDEX IF NOT EXISTS idx_user_profiles_user_updated',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(profile\)\s*=\s*'object'\s*\)/, 'profile must be constrained to a JSON object.');
assert.match(route, /\/rest\/v1\/user_profiles/, 'cloud account route must target user_profiles.');
assert.match(route, /deriveCloudIdentity/, 'cloud account route must derive a provider-neutral identity.');
assert.match(route, /cloudAccountProfile/, 'cloud account route must explicitly identify account profile responses.');
assert.match(readme, /supabase-user-profiles-v1\.sql/, 'database README must document the Supabase user profiles schema.');
assert.equal(
  pkg.scripts['test:cloud-user-profiles-supabase-schema'],
  'node scripts/cloud-user-profiles-supabase-schema.test.mjs',
  'package.json must expose cloud user profiles Supabase schema test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-user-profiles-supabase-schema/,
  'test:contracts must include Supabase cloud user profiles schema coverage.',
);

console.log('cloud user profiles Supabase schema contract passed');
