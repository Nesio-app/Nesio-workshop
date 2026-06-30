#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const schemaPath = path.join(root, 'database/schema/supabase-signals-v1.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const dbUrl = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
const dryRun = process.argv.includes('--dry-run');
const printSql = process.argv.includes('--print-sql');

const requiredMarkers = [
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE TABLE IF NOT EXISTS public.signals',
  'embedding_vector vector(768)',
  'idx_signals_embedding_vector',
  'CREATE OR REPLACE FUNCTION public.match_own_signals',
  'match_identity_key text',
  'ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY "signals_select_own"',
  'CREATE POLICY "signals_insert_own"',
  'CREATE POLICY "signals_update_own"',
];

const missingMarkers = requiredMarkers.filter((marker) => !sql.includes(marker));
if (missingMarkers.length) {
  console.error(JSON.stringify({
    ok: false,
    error: 'schema_missing_required_markers',
    missingMarkers,
    schemaPath,
  }, null, 2));
  process.exit(1);
}

if (printSql) {
  process.stdout.write(sql);
  process.exit(0);
}

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: 'dry_run',
    schemaPath,
    byteLength: Buffer.byteLength(sql),
    requiredMarkersPresent: true,
    executesProductionSql: false,
  }, null, 2));
  process.exit(0);
}

if (!dbUrl) {
  console.error(JSON.stringify({
    ok: false,
    error: 'missing_database_url',
    requiredEnv: ['SUPABASE_DB_URL or DATABASE_URL'],
    hint: 'Set SUPABASE_DB_URL to the Supabase direct Postgres connection string, then rerun npm run cloud:supabase:migrate:signals.',
    executesProductionSql: false,
  }, null, 2));
  process.exit(2);
}

const result = spawnSync('psql', [dbUrl, '--set', 'ON_ERROR_STOP=1', '--file', schemaPath], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error(JSON.stringify({
    ok: false,
    error: 'psql_unavailable_or_failed_to_start',
    message: result.error.message,
    executesProductionSql: false,
  }, null, 2));
  process.exit(3);
}

if (result.status !== 0) {
  console.error(JSON.stringify({
    ok: false,
    error: 'migration_failed',
    status: result.status,
    stderr: result.stderr,
    executesProductionSql: true,
  }, null, 2));
  process.exit(result.status || 4);
}

console.log(JSON.stringify({
  ok: true,
  migration: 'supabase-signals-v1',
  schemaPath,
  executesProductionSql: true,
  stdout: result.stdout.trim().slice(0, 4000),
}, null, 2));
