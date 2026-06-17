import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
});
const report = JSON.parse(output);

assert.equal(report.launchSku.version, 'launch-sku-v0');
assert.equal(report.launchSku.skuKey, 'shell_inventory_purchase_memory');
assert.equal(report.launchSku.launchSkuAppStoreReady, false);
assert.deepEqual(report.launchSku.includedModuleIds, ['shell', 'inventory']);
assert.deepEqual(report.launchSku.launchableBusinessModuleIds, ['inventory']);
assert.equal(report.summary.launchSkuAppStoreReady, false);
assert.equal(report.summary.launchableModuleCount, 2);
assert.equal(report.summary.excludedFromLaunchCount, 10);
assert.equal(report.summary.futurePaidModuleCount, 6);

const statusByModule = new Map(report.launchSku.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(statusByModule.get('shell').launchStatus, 'launchable');
assert.equal(statusByModule.get('inventory').launchStatus, 'launchable');

const launchableModules = report.launchSku.modules.filter((entry) => entry.launchStatus === 'launchable');
assert.deepEqual(launchableModules.map((entry) => entry.moduleId).sort(), ['inventory', 'shell']);
assert.equal(
  report.launchSku.modules.every((entry) => entry.launchStatus === 'launchable'),
  false,
  '11 modules must not all be launchable',
);

for (const moduleId of ['finance', 'health', 'psychoanalysis', 'secretary']) {
  const entry = statusByModule.get(moduleId);
  assert.notEqual(entry.launchStatus, 'launchable', `${moduleId} must not be launchable`);
  assert.equal(entry.excludedFromLaunch, true, `${moduleId} must be excluded from launch`);
}

const finance = statusByModule.get('finance');
assert.equal(finance.launchStatus, 'hidden');
assert.equal(finance.mobileStrategy, 'not_ready');
assert.equal(finance.needsCeoGate, true);

const inventory = statusByModule.get('inventory');
assert.equal(inventory.isLaunchBusinessModule, true);
assert.equal(inventory.entitlementKey != null, true);
assert.equal(inventory.entitlementChangesLaunchStatus, false);
assert.equal(inventory.approvalGateOverridesPaywallGate, true);

for (const entry of report.launchSku.modules) {
  assert.equal(entry.entitlementChangesLaunchStatus, false);
  if (entry.blockedByApprovalGate) {
    assert.equal(entry.approvalGateOverridesPaywallGate, true);
  }
}

assert.equal(report.launchSku.boundaries.storeKitEnabled, false);
assert.equal(report.launchSku.boundaries.realPaymentEnabled, false);
assert.equal(report.launchSku.boundaries.externalAuthEnabled, false);
assert.equal(report.launchSku.boundaries.cloudSyncEnabled, false);
assert.equal(report.launchSku.boundaries.appStoreSubmissionEnabled, false);

console.log('report-module-registry launch SKU tests passed');
