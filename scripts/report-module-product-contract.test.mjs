import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(output);

assert.equal(report.moduleProductContract.version, 'module-product-contract-v0');
assert.equal(report.moduleProductContract.implementation, 'static-product-contract-only');
assert.equal(report.moduleProductContract.boundaries.changesUI, false);
assert.equal(report.moduleProductContract.boundaries.readsRealData, false);
assert.equal(report.moduleProductContract.boundaries.writesRealData, false);
assert.equal(report.moduleProductContract.summary.moduleCount, report.summary.moduleCount);
assert.equal(report.moduleProductContract.summary.warningCount, 0);
assert.equal(report.summary.moduleProductContractVersion, 'module-product-contract-v0');
assert.equal(report.summary.moduleProductContractModuleCount, report.summary.moduleCount);
assert.equal(report.summary.moduleProductWarningCount, 0);

assert.equal(report.moduleTrustBoundary.summary.moduleCount, report.summary.moduleCount);
assert.equal(report.summary.moduleTrustBoundaryHighTrustCount, report.moduleTrustBoundary.summary.highTrustModuleCount);
assert.equal(report.coreObjectModels.version, 'core-object-model-contract-v0');
assert.equal(report.summary.coreObjectModelGroupCount, 3);

const byModule = new Map(report.moduleProductContract.modules.map((entry) => [entry.moduleId, entry]));
const appStoreMentionable = report.moduleProductContract.modules
  .filter((entry) => entry.appStore.appStoreMentionAllowed)
  .map((entry) => entry.moduleId)
  .sort();
assert.deepEqual(appStoreMentionable, ['inventory']);
assert.equal(report.summary.moduleProductAppStoreMentionAllowedCount, 1);
assert.equal(report.summary.moduleProductPublicVisibleCount, 1);

for (const moduleId of ['finance', 'health', 'psychoanalysis', 'secretary', 'lifesim']) {
  const entry = byModule.get(moduleId);
  assert.equal(entry.appStore.publicVisible, false, `${moduleId} must not be public visible`);
  assert.equal(entry.appStore.appStoreMentionAllowed, false, `${moduleId} must not be App Store mentionable`);
  assert.equal(entry.trustBoundary.requiresCEOApproval, true, `${moduleId} must be CEO-gated`);
  assert.equal(entry.entitlementApprovalState.approvalGatePriority, 'before_paywall');
}

const launchCohorts = report.moduleProductContract.modules.reduce((counts, entry) => {
  counts[entry.launchCohort] = (counts[entry.launchCohort] || 0) + 1;
  return counts;
}, {});
assert.equal(launchCohorts.first_launch, 1);
assert.equal(byModule.get('inventory').launchCohort, 'first_launch');
assert.equal(byModule.get('inventory').appStore.marketingClaim.includes('购买记忆'), true);

console.log('report module product contract tests passed');
