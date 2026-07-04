import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION = 'supabase-backend-v1-schema-bundle';
const OUTPUT_PATH = 'database/schema/supabase-backend-v1-bundle.sql';
const CANONICAL_SOURCES = [
  'database/schema/supabase-user-profiles-v1.sql',
  'database/schema/supabase-profile-settings-v1.sql',
  'database/schema/supabase-inventory-items-v1.sql',
  'database/schema/supabase-memory-v1.sql',
  'database/schema/supabase-signals-v1.sql',
  'database/schema/supabase-storage-v1.sql',
  'database/schema/supabase-product-events-v1.sql',
  'database/schema/supabase-telemetry-events-v1.sql',
  'database/schema/supabase-feature-votes-v1.sql',
];
const REQUIRED_MARKERS = {
  'database/schema/supabase-user-profiles-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.user_profiles',
    'identity_key text PRIMARY KEY',
    'ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY',
    'ADD COLUMN IF NOT EXISTS access_role',
    'ADD COLUMN IF NOT EXISTS feature_flags',
  ],
  'database/schema/supabase-telemetry-events-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.telemetry_events',
    'ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-feature-votes-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.feature_votes',
    'PRIMARY KEY (feature_id, device_id)',
    'ALTER TABLE public.feature_votes ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-profile-settings-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.profile_settings',
    'identity_key text PRIMARY KEY',
    'ALTER TABLE public.profile_settings ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-inventory-items-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.inventory_items',
    'identity_key text NOT NULL',
    'UNIQUE (identity_key, local_id)',
    'ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-memory-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.memory_nodes',
    'CREATE TABLE IF NOT EXISTS public.memory_edges',
    'CREATE TABLE IF NOT EXISTS public.memory_assets',
    'ALTER TABLE public.memory_nodes ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.memory_assets ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-signals-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.signals',
    'identity_key text NOT NULL',
    'signal_id text NOT NULL',
    'UNIQUE (identity_key, signal_id)',
    'ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY',
  ],
  'database/schema/supabase-storage-v1.sql': [
    'INSERT INTO storage.buckets',
    "'nesio-product-assets'",
    'public = false',
    'CREATE POLICY "nesio_assets_select_own_prefix"',
    'CREATE POLICY "nesio_assets_insert_own_prefix"',
    'CREATE POLICY "nesio_assets_update_own_prefix"',
    'CREATE POLICY "nesio_assets_delete_own_prefix"',
  ],
  'database/schema/supabase-product-events-v1.sql': [
    'CREATE TABLE IF NOT EXISTS public.product_events',
    'identity_key text NOT NULL',
    'ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY',
  ],
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readSource(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const exists = fs.existsSync(absolutePath);
  const source = exists ? fs.readFileSync(absolutePath, 'utf8') : '';
  const missingMarkers = (REQUIRED_MARKERS[relativePath] || []).filter((marker) => !source.includes(marker));
  return {
    path: relativePath,
    exists,
    ready: exists && missingMarkers.length === 0,
    missingMarkers,
    source,
  };
}

function findIgnoredDuplicatePaths(root) {
  const schemaDir = path.join(root, 'database', 'schema');
  if (!fs.existsSync(schemaDir)) return [];
  return fs.readdirSync(schemaDir)
    .filter((file) => /^supabase-.* 2\.sql$/.test(file))
    .map((file) => path.join('database', 'schema', file));
}

function buildBundle(sources) {
  const timestamp = new Date().toISOString();
  const sections = [
    '-- Nesio Supabase Backend v1 Bundle',
    `-- Generated at ${timestamp}`,
    '-- Apply manually in Supabase SQL Editor after CEO-approved production data operation window.',
    '-- This file contains schema only. It does not contain secrets. It creates the private Storage bucket contract.',
    '',
    'BEGIN;',
    '',
  ];

  for (const entry of sources) {
    sections.push(`-- ============================================================================`);
    sections.push(`-- Source: ${entry.path}`);
    sections.push(`-- ============================================================================`);
    sections.push(entry.source.trim());
    sections.push('');
  }

  sections.push('COMMIT;');
  sections.push('');
  return `${sections.join('\n')}`;
}

function writeBundle(root, bundle) {
  const absolutePath = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bundle, 'utf8');
}

function buildReport(root, sources, ignoredDuplicatePaths, wrote) {
  return {
    version: VERSION,
    safePublicStatus: true,
    secretsRedacted: true,
    sideEffects: wrote,
    mode: wrote ? 'write' : 'check',
    outputPath: OUTPUT_PATH,
    sources: sources.map((entry) => ({
      path: entry.path,
      exists: entry.exists,
      ready: entry.ready,
      missingMarkers: entry.missingMarkers,
    })),
    ignoredDuplicateCount: ignoredDuplicatePaths.length,
    ignoredDuplicatePaths,
    ready: sources.every((entry) => entry.ready),
  };
}

function main() {
  const root = process.cwd();
  const shouldWrite = hasFlag('--write');
  const sources = CANONICAL_SOURCES.map((sourcePath) => readSource(root, sourcePath));
  const ignoredDuplicatePaths = findIgnoredDuplicatePaths(root);
  const bundle = buildBundle(sources);

  if (shouldWrite) {
    writeBundle(root, bundle);
  }

  const report = buildReport(root, sources, ignoredDuplicatePaths, shouldWrite);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ready) {
    process.exitCode = 1;
  }
}

main();
