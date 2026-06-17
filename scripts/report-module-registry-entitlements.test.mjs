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

assert.equal(report.entitlements.contract.version, 'entitlement-contract-v0');
assert.equal(report.entitlements.contract.implementation, 'report-only');
assert.equal(report.entitlements.contract.approvalGateSeparateFromPaywallGate, true);
assert.equal(report.entitlements.contract.behaviorEnabled, false);
assert.equal(report.entitlements.contract.storeKitEnabled, false);
assert.equal(report.entitlements.contract.receiptVerificationEnabled, false);
assert.equal(report.entitlements.contract.restorePurchaseEnabled, false);
assert.equal(report.entitlements.contract.priceConfigured, false);

assert.equal(report.entitlements.summary.reportOnly, true);
assert.equal(report.entitlements.summary.behaviorEnabled, false);
assert.equal(report.entitlements.summary.storeKitEnabled, false);
assert.equal(report.entitlements.summary.priceConfigured, false);
assert.equal(report.entitlements.summary.productCount, report.summary.moduleCount);
assert.equal(report.entitlements.summary.moduleEntitlementCount, report.summary.moduleCount);
assert.equal(report.entitlements.summary.shellEntitlementViewCount, report.summary.moduleCount);
assert.equal(report.summary.entitlementReportOnly, true);
assert.equal(report.summary.entitlementBehaviorEnabled, false);
assert.equal(report.summary.entitlementStoreKitEnabled, false);

assert.deepEqual(
  report.entitlements.contract.dictionaries.paywallStates,
  ['free', 'trial', 'subscribed', 'locked', 'included_in_bundle', 'expired', 'restore_required'],
);

for (const tool of report.tools) {
  assert.equal(tool.commercial.moduleId, tool.id);
  assert.match(tool.commercial.productId, /^baohe\.[a-z0-9_-]+\.subscription$/);
  assert.match(tool.commercial.entitlementKey, /^entitlement\.[a-z0-9_-]+\.full_access$/);
  assert.equal(tool.commercial.subscriptionTier, 'single_tool');
  assert.equal(tool.commercial.storeProvider, 'storekit');
  assert.equal(tool.commercial.storeProductRef, null);
  assert.equal(tool.commercial.storeProductConfigured, false);
  assert.equal(tool.commercial.storePriceConfigured, false);
  assert.equal(tool.commercial.priceConfigured, false);
  assert.equal(tool.commercial.behaviorEnabled, false);
  assert.equal(tool.commercial.receiptVerificationEnabled, false);
  assert.equal(tool.commercial.restorePurchaseEnabled, false);

  assert.equal(tool.shellEntitlement.moduleId, tool.id);
  assert.equal(tool.shellEntitlement.moduleExists, true);
  assert.equal(tool.shellEntitlement.reportOnly, true);
  assert.equal(tool.shellEntitlement.changesRuntimeBehavior, false);
  assert.notEqual(tool.shellEntitlement.approvalGateState, undefined);
  assert.notEqual(tool.shellEntitlement.paywallState, undefined);
  assert.equal(typeof tool.shellEntitlement.blockedByApprovalGate, 'boolean');
  assert.equal(typeof tool.shellEntitlement.blockedByPaywallGate, 'boolean');
}

const finance = report.tools.find((tool) => tool.id === 'finance');
if (finance) {
  assert.equal(finance.shellEntitlement.approvalGateState !== finance.shellEntitlement.paywallState, true);
  assert.equal(finance.shellEntitlement.blockedByApprovalGate, true);
  assert.equal(finance.shellEntitlement.blockedByPaywallGate, true);
}

const allAccess = report.entitlements.bundles.find((bundle) => bundle.bundleId === 'baohe.bundle.all_access');
assert.equal(Boolean(allAccess), true);
assert.equal(allAccess.includedModules.length, report.summary.moduleCount);
assert.equal(allAccess.behaviorEnabled, false);
assert.equal(allAccess.priceConfigured, false);

for (const view of report.entitlements.shellEntitlementViews) {
  assert.equal(view.reportOnly, true);
  assert.equal(view.changesRuntimeBehavior, false);
  assert.equal(['open', 'open_free_preview', 'show_paywall', 'show_restore', 'hide', 'show_approval_gate'].includes(view.shellAction), true);
}

console.log('report-module-registry entitlement tests passed');
