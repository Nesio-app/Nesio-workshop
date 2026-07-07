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

assert.equal(report.offlineSyncConflict.version, 'offline-sync-conflict-contract-v0');
assert.equal(report.offlineSyncConflict.implementation, 'report-only');
assert.equal(report.offlineSyncConflict.boundaries.syncEnabled, false);
assert.equal(report.offlineSyncConflict.boundaries.cloudSyncEnabled, false);
assert.equal(report.offlineSyncConflict.boundaries.backgroundWorkerEnabled, false);
assert.equal(report.offlineSyncConflict.boundaries.networkRequestsEnabled, false);
assert.equal(report.offlineSyncConflict.boundaries.uploadsUserData, false);
assert.equal(report.offlineSyncConflict.boundaries.realConflictMergeEnabled, false);
assert.equal(report.offlineSyncConflict.boundaries.realSyncRequiresCeoGate, true);

assert.deepEqual(report.offlineSyncConflict.conflictStates, ['none', 'pending', 'conflict', 'resolved', 'failed']);
assert.deepEqual(report.offlineSyncConflict.retryStates, ['idle', 'queued', 'retrying', 'paused', 'failed', 'abandoned']);
assert.equal(report.offlineSyncConflict.futureOfflineQueue.enabledNow, false);
assert.equal(report.offlineSyncConflict.futureOfflineQueue.workerEnabled, false);
assert.equal(report.offlineSyncConflict.futureOfflineQueue.storage, 'local_contract_only');
assert.equal(report.offlineSyncConflict.mergePolicies.lastWriteWins.enabledNow, false);
assert.equal(report.offlineSyncConflict.mergePolicies.manualMerge.defaultForSensitiveData, true);

assert.equal(report.summary.syncEnabledModuleCount, 0);
assert.equal(report.summary.cloudSyncEnabled, false);
assert.equal(report.summary.offlineQueueEnabledNow, false);
assert.equal(report.summary.syncConflictModelReadable, true);
assert.equal(report.summary.inventorySyncReadiness, 'not_found'); // inventory 已原生化,不再是注册表模块

const syncByModule = new Map(report.offlineSyncConflict.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(syncByModule.size, report.summary.moduleCount);

for (const tool of report.tools) {
  const entry = syncByModule.get(tool.id);
  assert.ok(entry, `${tool.id} must have sync readiness entry`);
  assert.equal(entry.syncEnabled, false, `${tool.id} must keep sync disabled`);
  assert.equal(entry.cloudSyncEnabled, false, `${tool.id} must keep cloud sync disabled`);
  assert.equal(entry.backgroundWorkerEnabled, false, `${tool.id} must not enable background sync worker`);
  assert.equal(entry.networkRequestsEnabled, false, `${tool.id} must not send sync network requests`);
  assert.equal(entry.uploadsUserData, false, `${tool.id} must not upload user data`);
  assert.ok(report.offlineSyncConflict.conflictStates.includes(entry.defaultConflictState));
}

assert.equal(syncByModule.has('inventory'), false);

console.log('report-module-registry offline sync conflict tests passed');
