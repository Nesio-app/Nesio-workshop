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
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-secret-value',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
  },
});
const report = JSON.parse(offlineOutput);

assert.equal(report.version, 'supabase-cloud-preflight-v0');
assert.equal(report.safePublicStatus, true);
assert.equal(report.secretsRedacted, true);
assert.equal(report.mode, 'offline');
assert.equal(report.summary.envReady, true);
assert.equal(report.summary.schemaFilesReady, true);
assert.equal(report.summary.networkChecked, false);
assert.equal(report.summary.readyToEnableCloudDb, true);
assert.deepEqual(
  report.requiredEnv.map((entry) => entry.key),
  ['CLOUD_DB_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
);
for (const entry of report.requiredEnv) {
  assert.equal(entry.present, true, `expected env ${entry.key} to be present`);
  assert.equal(entry.value, '[redacted]', `expected env ${entry.key} value to be redacted`);
}
assert.ok(report.schemaFiles.profileSettings.path.endsWith('database/schema/supabase-profile-settings-v1.sql'));
assert.ok(report.schemaFiles.inventoryItems.path.endsWith('database/schema/supabase-inventory-items-v1.sql'));
assert.ok(report.schemaFiles.profileSettings.hasIdentityKey);
assert.ok(report.schemaFiles.inventoryItems.hasIdentityKey);
assert.ok(!offlineOutput.includes('anon-secret-value'));
assert.ok(!offlineOutput.includes('service-role-secret-value'));

const missingOutput = execFileSync('node', [scriptPath, '--offline', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLOUD_DB_ENABLED: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
});
const missingReport = JSON.parse(missingOutput);
assert.equal(missingReport.summary.envReady, false);
assert.equal(missingReport.summary.readyToEnableCloudDb, false);
assert.ok(missingReport.requiredEnv.every((entry) => entry.present === false));

const source = fs.readFileSync(scriptPath, 'utf8');
assert.match(source, /\/rest\/v1\/profile_settings/, 'preflight must know how to check profile_settings table.');
assert.match(source, /\/rest\/v1\/inventory_items/, 'preflight must know how to check inventory_items table.');
assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, 'preflight must validate service role availability.');
assert.doesNotMatch(source, /console\.log\([^)]*SERVICE_ROLE_KEY/s, 'preflight must not print secret env values directly.');

console.log('supabase cloud preflight tests passed');
