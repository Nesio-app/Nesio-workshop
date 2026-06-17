import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(output);

assert.equal(report.cloudReadiness.version, 'cloud-readiness-contract-v0');
assert.equal(report.cloudReadiness.implementation, 'report-only');
assert.equal(report.cloudReadiness.boundaries.cloudEnabled, false);
assert.equal(report.cloudReadiness.boundaries.realCloudProviderConnected, false);
assert.equal(report.cloudReadiness.boundaries.networkRequestsEnabled, false);
assert.equal(report.cloudReadiness.boundaries.writesCloudData, false);
assert.equal(report.cloudReadiness.boundaries.cloudMigrationEnabled, false);
assert.equal(report.cloudReadiness.boundaries.realCloudRequiresCeoGate, true);

assert.deepEqual(
  report.cloudReadiness.providerCandidates.map((candidate) => candidate.provider),
  ['supabase', 'neon', 'firebase', 'turso', 'self_hosted_postgres'],
);
assert.ok(report.cloudReadiness.providerSelectionCriteria.includes('data_export_portability'));
assert.ok(report.cloudReadiness.providerSelectionCriteria.includes('delete_semantics_verifiable'));
assert.ok(report.cloudReadiness.providerSelectionCriteria.includes('offline_first_sync_fit'));

assert.equal(report.cloudReadiness.idMapping.localIdField, 'local_id');
assert.equal(report.cloudReadiness.idMapping.cloudIdField, 'cloud_id');
assert.equal(report.cloudReadiness.idMapping.cloudIdNullableNow, true);
assert.equal(report.cloudReadiness.idMapping.mappingEnabledNow, false);
assert.equal(report.cloudReadiness.idMapping.serverUserIdRequiredNow, false);

assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.tableName, 'inventory_items');
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.status, 'draft_only');
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.enabledNow, false);
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.fields.local_id.sensitivity, 'personal_local');
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.fields.cloud_id.nullableNow, true);
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.fields.owner_profile_id.source, 'future_identity_boundary');
assert.equal(report.cloudReadiness.inventoryCloudSchemaDraft.indexes.length > 0, true);

assert.equal(report.cloudReadiness.exportDeleteSemantics.exportCloudData.enabledNow, false);
assert.equal(report.cloudReadiness.exportDeleteSemantics.exportCloudData.futureBehavior, 'include_cloud_snapshot_after_explicit_user_request');
assert.equal(report.cloudReadiness.exportDeleteSemantics.deleteCloudData.enabledNow, false);
assert.equal(report.cloudReadiness.exportDeleteSemantics.deleteCloudData.requiresRealAuth, true);
assert.equal(report.cloudReadiness.exportDeleteSemantics.deleteLocalDataDifferentFromDeleteAccount, true);

assert.equal(report.cloudReadiness.syncConflictPolicy.enabledNow, false);
assert.equal(report.cloudReadiness.syncConflictPolicy.defaultInventoryPolicy, 'manual_merge_required');
assert.equal(report.cloudReadiness.syncConflictPolicy.lowRiskMetadataPolicy, 'last_write_wins_allowed_later');
assert.deepEqual(report.cloudReadiness.syncConflictPolicy.states, ['none', 'pending', 'conflict', 'resolved', 'failed']);

assert.equal(report.cloudReadiness.userIdentityBoundary.accountSystemEnabled, false);
assert.equal(report.cloudReadiness.userIdentityBoundary.currentProfileKind, 'local_profile');
assert.equal(report.cloudReadiness.userIdentityBoundary.serverUserIdEnabled, false);
assert.equal(report.cloudReadiness.userIdentityBoundary.cloudIdentityEnabled, false);

const cloudByTable = new Map(report.cloudReadiness.tablePlacement.map((entry) => [entry.table, entry]));
assert.equal(cloudByTable.get('inventory_items').futureCloudEligible, true);
assert.equal(cloudByTable.get('inventory_items').currentPlacement, 'local_only');
assert.equal(cloudByTable.get('local_profile').futureCloudEligible, false);
assert.equal(cloudByTable.get('demo_seed').futureCloudEligible, false);
assert.equal(cloudByTable.get('handoff_records').futureCloudEligible, false);

assert.equal(report.summary.cloudReadinessVersion, 'cloud-readiness-contract-v0');
assert.equal(report.summary.cloudEnabled, false);
assert.equal(report.summary.realCloudProviderConnected, false);
assert.equal(report.summary.cloudProviderCandidateCount, 5);
assert.equal(report.summary.inventoryCloudSchemaDraftReady, true);
assert.equal(report.summary.futureCloudEligibleTableCount, 2);

console.log('report-module-registry cloud readiness tests passed');
