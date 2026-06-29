import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-memory-v1.sql');
const readmePath = path.join(root, 'database', 'README.md');
const routePath = path.join(root, 'app', 'api', 'cloud', 'memory', 'route.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase memory schema must exist.');
assert.ok(fs.existsSync(routePath), 'cloud memory route must exist.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.memory_nodes',
  'CREATE TABLE IF NOT EXISTS public.memory_edges',
  'CREATE TABLE IF NOT EXISTS public.memory_assets',
  'identity_key text NOT NULL',
  'user_id uuid REFERENCES auth.users',
  'local_id text NOT NULL',
  'node jsonb NOT NULL DEFAULT',
  'asset jsonb NOT NULL DEFAULT',
  'source_node_local_id text',
  'target_node_local_id text',
  'deleted_at timestamptz',
  'UNIQUE (identity_key, local_id)',
  'ALTER TABLE public.memory_nodes ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.memory_assets ENABLE ROW LEVEL SECURITY',
  'auth.uid() = user_id',
  'idx_memory_nodes_identity_updated',
  'idx_memory_assets_identity_updated',
]) {
  assert.match(schema, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `schema missing marker: ${marker}`);
}

assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(node\)\s*=\s*'object'\s*\)/, 'memory_nodes.node must be constrained to a JSON object.');
assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(asset\)\s*=\s*'object'\s*\)/, 'memory_assets.asset must be constrained to a JSON object.');
assert.match(route, /\/rest\/v1\/memory_nodes/, 'cloud memory route must target memory_nodes.');
assert.match(route, /\/rest\/v1\/memory_edges/, 'cloud memory route must target memory_edges.');
assert.match(route, /\/rest\/v1\/memory_assets/, 'cloud memory route must target memory_assets.');
assert.match(route, /deriveCloudIdentity/, 'cloud memory route must derive a provider-neutral identity.');
assert.match(readme, /supabase-memory-v1\.sql/, 'database README must document the Supabase memory schema.');
assert.equal(
  pkg.scripts['test:cloud-memory-supabase-schema'],
  'node scripts/cloud-memory-supabase-schema.test.mjs',
  'package.json must expose cloud memory Supabase schema test.',
);

console.log('cloud memory Supabase schema contract passed');
