import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-profile-settings-v1.sql');
const readmePath = path.join(root, 'database', 'README.md');
const routePath = path.join(root, 'app', 'api', 'cloud', 'profile-settings', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase profile settings schema must exist.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.profile_settings',
  'user_id uuid PRIMARY KEY',
  'settings jsonb NOT NULL DEFAULT',
  'updated_at timestamptz NOT NULL DEFAULT now()',
  'ALTER TABLE public.profile_settings ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY',
  'auth.uid() = user_id',
  'CREATE INDEX IF NOT EXISTS idx_profile_settings_updated_at',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

assert.match(
  schema,
  /CHECK\s*\(\s*jsonb_typeof\(settings\)\s*=\s*'object'\s*\)/,
  'settings must be constrained to a JSON object.',
);
assert.match(route, /\/rest\/v1\/profile_settings/, 'cloud profile route must target profile_settings.');
assert.match(readme, /supabase-profile-settings-v1\.sql/, 'database README must document the Supabase profile settings schema.');
assert.equal(
  pkg.scripts['test:cloud-profile-supabase-schema'],
  'node scripts/cloud-profile-supabase-schema.test.mjs',
  'package.json must expose cloud profile Supabase schema test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-profile-supabase-schema/,
  'test:contracts must include Supabase cloud profile schema coverage.',
);

console.log('cloud profile Supabase schema contract passed');
