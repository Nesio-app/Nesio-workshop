import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-product-events-v1.sql');
const readmePath = path.join(root, 'database', 'README.md');
const routePath = path.join(root, 'app', 'api', 'cloud', 'events', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase product events schema must exist.');
assert.ok(fs.existsSync(routePath), 'cloud events route must exist.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.product_events',
  'event_id text PRIMARY KEY',
  'identity_key text NOT NULL',
  'user_id uuid REFERENCES auth.users',
  'event_type text NOT NULL',
  'source text NOT NULL',
  'target_type text',
  'target_id text',
  'feedback text',
  'payload jsonb NOT NULL DEFAULT',
  'ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY',
  'auth.uid() = user_id',
  'CREATE INDEX IF NOT EXISTS idx_product_events_user_created',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(payload\)\s*=\s*'object'\s*\)/, 'payload must be constrained to a JSON object.');
assert.match(route, /\/rest\/v1\/product_events/, 'cloud events route must target product_events.');
assert.match(route, /deriveCloudIdentity/, 'cloud events route must derive a provider-neutral identity.');
assert.match(route, /product_event_recorded/, 'cloud events route must explicitly identify product event responses.');
assert.match(readme, /supabase-product-events-v1\.sql/, 'database README must document the Supabase product events schema.');
assert.equal(
  pkg.scripts['test:cloud-product-events-supabase-schema'],
  'node scripts/cloud-product-events-supabase-schema.test.mjs',
  'package.json must expose cloud product events Supabase schema test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-product-events-supabase-schema/,
  'test:contracts must include Supabase cloud product events schema coverage.',
);

console.log('cloud product events Supabase schema contract passed');
