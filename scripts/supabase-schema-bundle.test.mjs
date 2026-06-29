import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scriptPath = path.join(root, 'scripts', 'supabase-schema-bundle.mjs');
const outputPath = path.join(root, 'database', 'schema', 'supabase-backend-v1-bundle.sql');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const databaseReadme = fs.readFileSync(path.join(root, 'database', 'README.md'), 'utf8');

assert.ok(fs.existsSync(scriptPath), 'expected scripts/supabase-schema-bundle.mjs to exist');
assert.equal(
  packageJson.scripts['cloud:supabase:schema:bundle'],
  'node scripts/supabase-schema-bundle.mjs',
  'package.json must expose cloud:supabase:schema:bundle',
);
assert.equal(
  packageJson.scripts['test:supabase-schema-bundle'],
  'node scripts/supabase-schema-bundle.test.mjs',
  'package.json must expose test:supabase-schema-bundle',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /npm run test:supabase-schema-bundle/,
  'test:contracts must include the Supabase schema bundle guard',
);
assert.match(
  databaseReadme,
  /cloud:supabase:schema:bundle -- --check/,
  'database README must document the schema bundle check command',
);
assert.match(
  databaseReadme,
  /database\/schema\/supabase-backend-v1-bundle\.sql/,
  'database README must document the schema bundle output path',
);
assert.match(
  databaseReadme,
  /不会创建表、bucket 或迁移真实数据/,
  'database README must keep the no-live-side-effect boundary visible',
);

const output = execFileSync('node', [scriptPath, '--check'], {
  cwd: root,
  encoding: 'utf8',
});
const report = JSON.parse(output);

assert.equal(report.version, 'supabase-backend-v1-schema-bundle');
assert.equal(report.safePublicStatus, true);
assert.equal(report.secretsRedacted, true);
assert.equal(report.sideEffects, false);
assert.equal(report.outputPath, 'database/schema/supabase-backend-v1-bundle.sql');
assert.deepEqual(
  report.sources.map((source) => source.path),
  [
    'database/schema/supabase-user-profiles-v1.sql',
    'database/schema/supabase-profile-settings-v1.sql',
    'database/schema/supabase-inventory-items-v1.sql',
    'database/schema/supabase-memory-v1.sql',
    'database/schema/supabase-signals-v1.sql',
    'database/schema/supabase-storage-v1.sql',
    'database/schema/supabase-product-events-v1.sql',
  ],
  'bundle must use canonical Backend v1 schema files in operator-safe order',
);
assert.ok(report.sources.every((source) => source.exists), 'all canonical schema files must exist');
assert.ok(report.sources.every((source) => source.ready), 'all canonical schema files must be ready');
assert.equal(report.ignoredDuplicateCount >= 0, true, 'bundle report must count ignored duplicate schema files');
assert.ok(
  report.ignoredDuplicatePaths.every((entry) => entry.includes(' 2.sql')),
  'ignored duplicate list must only contain known Finder-copy schema paths',
);
assert.equal(report.ready, true, 'schema bundle check should be ready when canonical schema files are valid');

execFileSync('node', [scriptPath, '--write'], {
  cwd: root,
  encoding: 'utf8',
});

assert.ok(fs.existsSync(outputPath), 'schema bundle writer must create the canonical bundle file');
const bundle = fs.readFileSync(outputPath, 'utf8');
assert.match(bundle, /-- Nesio Supabase Backend v1 Bundle/, 'bundle must have a clear operator heading');
assert.match(bundle, /BEGIN;/, 'bundle must wrap schema application in an explicit transaction');
assert.match(bundle, /COMMIT;/, 'bundle must wrap schema application in an explicit transaction');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.user_profiles/, 'bundle must include user_profiles schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.profile_settings/, 'bundle must include profile_settings schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.inventory_items/, 'bundle must include inventory_items schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.memory_nodes/, 'bundle must include memory_nodes schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.memory_edges/, 'bundle must include memory_edges schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.memory_assets/, 'bundle must include memory_assets schema');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.signals/, 'bundle must include signals schema');
assert.match(bundle, /UNIQUE \(identity_key, signal_id\)/, 'signals schema must have stable per-user upsert key');
assert.match(bundle, /INSERT INTO storage\.buckets/, 'bundle must include Supabase Storage bucket schema');
assert.match(bundle, /public = false/, 'Storage bucket must be private by default');
assert.match(bundle, /CREATE POLICY "nesio_assets_select_own_prefix"/, 'bundle must include private asset select policy');
assert.match(bundle, /CREATE POLICY "nesio_assets_insert_own_prefix"/, 'bundle must include private asset insert policy');
assert.match(bundle, /CREATE TABLE IF NOT EXISTS public\.product_events/, 'bundle must include product_events schema');
assert.equal(
  (bundle.match(/CREATE TABLE IF NOT EXISTS public\.inventory_items/g) || []).length,
  1,
  'bundle must not include duplicate stale inventory schema copies',
);
assert.doesNotMatch(bundle, /supabase-inventory-items-v1 2\.sql/, 'bundle must not include stale Finder-copy schema paths');
assert.doesNotMatch(bundle, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/, 'bundle must not contain runtime secrets');

console.log('supabase schema bundle tests passed');
