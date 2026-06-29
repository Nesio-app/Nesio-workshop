#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-product-events-v1.sql');
const routePath = path.join(root, 'app', 'api', 'cloud', 'events', 'route.ts');
const statusPath = path.join(root, 'app', 'api', 'cloud', 'status', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const todayFeedPath = path.join(root, 'components', 'portal', 'TodayFeed.tsx');
const readmePath = path.join(root, 'database', 'README.md');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(schemaPath), 'Supabase product events schema must exist.');
assert.ok(fs.existsSync(routePath), 'cloud events route must exist at app/api/cloud/events/route.ts.');

const schema = fs.readFileSync(schemaPath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const statusRoute = fs.readFileSync(statusPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const todayFeed = fs.readFileSync(todayFeedPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
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
  'created_at timestamptz NOT NULL DEFAULT now()',
  'ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY',
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
  '/rest/v1/product_events',
  'sanitizeCloudEventInput',
  'product_event_recorded',
  'not_signed_in',
  'cloud_not_configured',
  'safePublicStatus',
  'secretsRedacted',
  'readsCloud',
  'writesCloud',
]) {
  assert.ok(route.includes(marker), `cloud events route missing marker: ${marker}`);
}

assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/, 'cloud events route must not serialize service role secrets.');

for (const marker of [
  'eventsEndpoint',
  '/api/cloud/events',
  "productEvents: 'product_events'",
]) {
  assert.ok(statusRoute.includes(marker), `cloud status route missing events marker: ${marker}`);
}

for (const marker of [
  'CloudProductEvent',
  'CloudProductEventsResponse',
  'cloudEvents',
  '/api/cloud/events',
  'recordCloudProductEvent',
  'fetchCloudProductEvents',
]) {
  assert.ok(client.includes(marker), `app-api-client missing events marker: ${marker}`);
}

for (const marker of [
  'recordCloudProductEvent',
  "eventType: 'today.card.feedback'",
  'targetType: card.type',
  'targetId: cardId',
  'feedback',
]) {
  assert.ok(todayFeed.includes(marker), `TodayFeed missing cloud feedback marker: ${marker}`);
}

assert.match(readme, /supabase-product-events-v1\.sql/, 'database README must document product_events schema.');
assert.equal(pkg.scripts['test:cloud-events-runtime'], 'node scripts/cloud-events-runtime.test.mjs');
assert.match(pkg.scripts['test:contracts'], /test:cloud-events-runtime/);

console.log('cloud events runtime contract passed');
