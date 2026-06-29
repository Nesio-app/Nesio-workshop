import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scriptPath = path.join(root, 'scripts', 'supabase-cloud-preflight.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(fs.existsSync(scriptPath), 'expected scripts/supabase-cloud-preflight.mjs to exist');
assert.equal(
  pkg.scripts['cloud:supabase:preflight'],
  'node scripts/supabase-cloud-preflight.mjs',
  'package.json must expose cloud:supabase:preflight',
);

const offlineOutput = execFileSync('node', [scriptPath, '--offline', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLOUD_DB_ENABLED: 'true',
    CLOUD_STORAGE_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-secret-value',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
    SUPABASE_STORAGE_BUCKET: 'nesio-test-assets',
  },
});
const report = JSON.parse(offlineOutput);

assert.equal(report.version, 'supabase-cloud-preflight-v1');
assert.equal(report.safePublicStatus, true);
assert.equal(report.secretsRedacted, true);
assert.equal(report.mode, 'offline');
assert.equal(report.summary.databaseEnvReady, true);
assert.equal(report.summary.storageEnvReady, true);
assert.equal(report.summary.schemaFilesReady, true);
assert.equal(report.summary.networkChecked, false);
assert.equal(report.summary.readyToEnableCloudDb, true);
assert.equal(report.summary.readyToEnableCloudStorage, true);
assert.equal(report.summary.readyForProductBackend, true);
assert.deepEqual(report.issueCounts, {
  missingEnv: 0,
  missingSchemaMarkers: 0,
  blockedTables: 0,
  storageBlocked: 0,
}, 'ready offline report should expose zero backend issue counts');
assert.deepEqual(report.operatorActions, [], 'ready offline report should not require follow-up operator actions');
assert.deepEqual(
  report.requiredEnv.map((entry) => entry.key),
  [
    'CLOUD_DB_ENABLED',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CLOUD_STORAGE_ENABLED',
    'SUPABASE_STORAGE_BUCKET',
  ],
);
for (const entry of report.requiredEnv) {
  assert.equal(entry.present, true, `expected env ${entry.key} to be present`);
  assert.equal(entry.value, '[redacted]', `expected env ${entry.key} value to be redacted`);
}
assert.deepEqual(
  report.databaseRequiredEnv.map((entry) => entry.key),
  ['CLOUD_DB_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
);
assert.deepEqual(
  report.storageRequiredEnv.map((entry) => entry.key),
  ['CLOUD_STORAGE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'],
);
assert.ok(report.schemaFiles.userProfiles.path.endsWith('database/schema/supabase-user-profiles-v1.sql'));
assert.ok(report.schemaFiles.profileSettings.path.endsWith('database/schema/supabase-profile-settings-v1.sql'));
assert.ok(report.schemaFiles.inventoryItems.path.endsWith('database/schema/supabase-inventory-items-v1.sql'));
assert.ok(report.schemaFiles.memoryNodes.path.endsWith('database/schema/supabase-memory-v1.sql'));
assert.ok(report.schemaFiles.memoryEdges.path.endsWith('database/schema/supabase-memory-v1.sql'));
assert.ok(report.schemaFiles.memoryAssets.path.endsWith('database/schema/supabase-memory-v1.sql'));
assert.ok(report.schemaFiles.storageAssets.path.endsWith('database/schema/supabase-storage-v1.sql'));
assert.ok(report.schemaFiles.productEvents.path.endsWith('database/schema/supabase-product-events-v1.sql'));
assert.ok(report.schemaFiles.signals.path.endsWith('database/schema/supabase-signals-v1.sql'));
assert.ok(report.schemaFiles.userProfiles.hasIdentityKey);
assert.ok(report.schemaFiles.profileSettings.hasIdentityKey);
assert.ok(report.schemaFiles.inventoryItems.hasIdentityKey);
assert.ok(report.schemaFiles.memoryNodes.hasIdentityKey);
assert.ok(report.schemaFiles.memoryEdges.hasIdentityKey);
assert.ok(report.schemaFiles.memoryAssets.hasIdentityKey);
assert.ok(report.schemaFiles.productEvents.hasIdentityKey);
assert.ok(report.schemaFiles.signals.hasIdentityKey);
assert.equal(report.schemaFiles.storageAssets.ready, true, 'Storage bucket/policy schema must be part of Backend v1 readiness');
assert.equal(report.storage.bucket, 'nesio-test-assets');
assert.equal(report.storage.bucketConfigured, true);
assert.ok(!offlineOutput.includes('anon-secret-value'));
assert.ok(!offlineOutput.includes('service-role-secret-value'));
assert.ok(!offlineOutput.includes('nesio-test-assets-secret'));

const missingOutput = execFileSync('node', [scriptPath, '--offline', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLOUD_DB_ENABLED: '',
    CLOUD_STORAGE_ENABLED: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_STORAGE_BUCKET: '',
  },
});
const missingReport = JSON.parse(missingOutput);
assert.equal(missingReport.summary.databaseEnvReady, false);
assert.equal(missingReport.summary.storageEnvReady, false);
assert.equal(missingReport.summary.readyToEnableCloudDb, false);
assert.equal(missingReport.summary.readyToEnableCloudStorage, false);
assert.equal(missingReport.summary.readyForProductBackend, false);
assert.ok(missingReport.requiredEnv.every((entry) => entry.present === false));
assert.ok(missingReport.issueCounts.missingEnv >= 6, 'missing env report must count missing backend env vars');
assert.ok(
  missingReport.operatorActions.some((action) => action.action === 'set_backend_env'),
  'missing env report must tell operator to set backend env',
);
assert.ok(
  missingReport.operatorActions.some((action) => action.action === 'enable_cloud_runtime_flags'),
  'missing env report must tell operator to enable cloud runtime flags',
);
assert.ok(
  missingReport.operatorActions.every((action) => action.requiresCeoGate === true),
  'backend operator actions must remain CEO-gated',
);

const source = fs.readFileSync(scriptPath, 'utf8');
assert.match(source, /\/rest\/v1\/user_profiles/, 'preflight must know how to check user_profiles table.');
assert.match(source, /\/rest\/v1\/profile_settings/, 'preflight must know how to check profile_settings table.');
assert.match(source, /\/rest\/v1\/inventory_items/, 'preflight must know how to check inventory_items table.');
assert.match(source, /\/rest\/v1\/memory_nodes/, 'preflight must know how to check memory_nodes table.');
assert.match(source, /\/rest\/v1\/memory_edges/, 'preflight must know how to check memory_edges table.');
assert.match(source, /\/rest\/v1\/memory_assets/, 'preflight must know how to check memory_assets table.');
assert.match(source, /\/rest\/v1\/product_events/, 'preflight must know how to check product_events table.');
assert.match(source, /\/rest\/v1\/signals/, 'preflight must know how to check signals table.');
assert.match(source, /supabase-storage-v1\.sql/, 'preflight must validate the Storage bucket and policy schema file.');
assert.match(source, /supabase-signals-v1\.sql/, 'preflight must validate the Signal schema file.');
assert.match(source, /nesio_assets_select_own_prefix/, 'preflight must validate private Storage select policy markers.');
assert.match(source, /signals_insert_own/, 'preflight must validate Signal RLS insert policy markers.');
assert.match(source, /\/storage\/v1\/bucket/, 'preflight must know how to check Supabase Storage bucket.');
assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, 'preflight must validate service role availability.');
assert.match(source, /SUPABASE_STORAGE_BUCKET/, 'preflight must validate storage bucket availability.');
assert.match(source, /operatorActions/, 'preflight must emit operator actions for backend enablement.');
assert.match(source, /issueCounts/, 'preflight must emit issue counts for backend readiness.');
assert.match(source, /requiresCeoGate/, 'preflight operator actions must carry CEO gate metadata.');
assert.doesNotMatch(source, /console\.log\([^)]*SERVICE_ROLE_KEY/s, 'preflight must not print secret env values directly.');

console.log('supabase cloud preflight tests passed');
