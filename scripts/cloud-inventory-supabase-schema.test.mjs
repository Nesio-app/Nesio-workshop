import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-inventory-items-v1.sql');
const readmePath = path.join(root, 'database', 'README.md');
const routePath = path.join(root, 'app', 'api', 'cloud', 'inventory', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase inventory items schema must exist.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.inventory_items',
  'user_id uuid NOT NULL REFERENCES auth.users',
  'local_id text NOT NULL',
  'schema_version text NOT NULL DEFAULT',
  'item jsonb NOT NULL DEFAULT',
  'updated_at timestamptz NOT NULL DEFAULT now()',
  'deleted_at timestamptz',
  'UNIQUE (user_id, local_id)',
  'ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY',
  'auth.uid() = user_id',
  'CREATE INDEX IF NOT EXISTS idx_inventory_items_user_updated',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(item\)\s*=\s*'object'\s*\)/, 'item must be constrained to a JSON object.');
assert.match(route, /\/rest\/v1\/inventory_items/, 'cloud inventory route must target inventory_items.');
assert.match(readme, /supabase-inventory-items-v1\.sql/, 'database README must document the Supabase inventory items schema.');
assert.equal(
  pkg.scripts['test:cloud-inventory-supabase-schema'],
  'node scripts/cloud-inventory-supabase-schema.test.mjs',
  'package.json must expose cloud inventory Supabase schema test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-inventory-supabase-schema/,
  'test:contracts must include Supabase cloud inventory schema coverage.',
);

console.log('cloud inventory Supabase schema contract passed');
