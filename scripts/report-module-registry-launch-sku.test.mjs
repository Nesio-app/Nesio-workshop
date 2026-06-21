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

assert.equal(report.launchSku.version, 'launch-sku-v0');
assert.equal(report.launchSku.skuKey, 'shell_inventory_todo_purchase_memory');
assert.equal(report.launchSku.launchSkuAppStoreReady, false);
assert.deepEqual(report.launchSku.includedModuleIds, ['shell', 'inventory', 'plan']);
assert.deepEqual(report.launchSku.launchableBusinessModuleIds, ['inventory', 'plan']);
assert.equal(report.summary.launchSkuAppStoreReady, false);
assert.equal(report.summary.launchableModuleCount, 3);
assert.equal(report.summary.excludedFromLaunchCount, 9);
assert.equal(report.summary.futurePaidModuleCount, 5);
assert.equal(report.summary.toolLifecycleVersion, 'tool-lifecycle-v0');
assert.equal(report.summary.toolLifecycleLaunchableCount, 2);
assert.equal(report.summary.toolLifecycleSandboxCount, 9);
assert.equal(report.summary.toolLifecycleReadyForCandidateReviewCount, 9);

const statusByModule = new Map(report.launchSku.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(statusByModule.get('shell').launchStatus, 'launchable');
assert.equal(statusByModule.get('inventory').launchStatus, 'launchable');
assert.equal(statusByModule.get('inventory').toolLifecycle, 'launchable');
assert.equal(statusByModule.get('inventory').toolLifecycleStage, 5);
assert.equal(statusByModule.get('inventory').nextLifecycleTarget, 'monetized');
assert.equal(statusByModule.get('plan').launchStatus, 'launchable');
assert.equal(statusByModule.get('plan').toolLifecycle, 'launchable');

const launchableModules = report.launchSku.modules.filter((entry) => entry.launchStatus === 'launchable');
assert.deepEqual(launchableModules.map((entry) => entry.moduleId).sort(), ['inventory', 'plan', 'shell']);
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

const lifecycleByModule = new Map(report.toolLifecycle.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(report.toolLifecycle.version, 'tool-lifecycle-v0');
assert.deepEqual(report.toolLifecycle.summary.launchableModuleIds.sort(), ['inventory', 'plan']);
assert.equal(report.toolLifecycle.summary.nextCandidateModuleIds.length, report.summary.moduleCount - 2);
for (const [moduleId, entry] of lifecycleByModule) {
  if (moduleId === 'inventory' || moduleId === 'plan') {
    assert.equal(entry.lifecycle, 'launchable');
    assert.equal(entry.lifecycleStage, 5);
    assert.equal(entry.readyForCandidateReview, false);
    continue;
  }
  assert.equal(entry.lifecycle, 'sandbox', `${moduleId} should remain sandbox`);
  assert.equal(entry.lifecycleStage, 3, `${moduleId} should be stage 3`);
  assert.equal(entry.nextLifecycleTarget, 'candidate', `${moduleId} should be preparing for candidate`);
  assert.equal(entry.nextLifecycleStage, 4, `${moduleId} should target stage 4`);
  assert.equal(entry.readyForCandidateReview, true, `${moduleId} should be ready for candidate review`);
}

const finance = statusByModule.get('finance');
assert.equal(finance.launchStatus, 'hidden');
assert.equal(finance.mobileStrategy, 'native_bridge_deferred');
assert.equal(finance.needsCeoGate, true);

const inventory = statusByModule.get('inventory');
assert.equal(inventory.isLaunchBusinessModule, true);
assert.equal(inventory.entitlementKey != null, true);
assert.equal(inventory.entitlementChangesLaunchStatus, false);
assert.equal(inventory.approvalGateOverridesPaywallGate, true);

const plan = statusByModule.get('plan');
assert.equal(plan.isLaunchBusinessModule, true);
assert.equal(plan.entitlementChangesLaunchStatus, false);
assert.equal(plan.approvalGateOverridesPaywallGate, true);

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
