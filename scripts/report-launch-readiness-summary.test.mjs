import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

const output = execFileSync('node', [join(scriptDir, 'report-launch-readiness-summary.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 40,
});
const summary = JSON.parse(output);

assert.equal(summary.version, 'launch-readiness-summary-v0');
assert.equal(summary.generatedFrom, 'report-module-registry.mjs');
assert.equal(summary.status, 'candidate_not_release_ready');
assert.equal(summary.firstLaunchPromise, 'Shell + Inventory / purchase-memory + Todo');
assert.equal(summary.appStoreReady, false);
assert.equal(summary.testFlightReady, false);
assert.deepEqual(summary.ordinaryUserPublicModules, []);
assert.deepEqual(summary.launchableModules.sort(), ['shell']);
assert.equal(summary.excludedFromLaunchModules.includes('finance'), true);
assert.equal(summary.excludedFromLaunchModules.includes('health'), true);
assert.equal(summary.excludedFromLaunchModules.includes('psychoanalysis'), true);
assert.equal(summary.ceoGatedModules.includes('finance'), true);
assert.equal(summary.ceoGatedModules.includes('inventory'), false);
assert.deepEqual(summary.launchableModulesWithDeferredApproval, []);
assert.equal(summary.gates.approvalGateOverridesPaywallGate, true);
assert.equal(summary.gates.realPurchaseEnabled, false);
assert.equal(summary.gates.storeKitEnabled, false);
assert.equal(summary.gates.externalAuthEnabled, false);
assert.equal(summary.gates.cloudSyncEnabled, false);
// inventoryLocalFlow 随静态 /storage/ 解绑移除;本地数据边界由 gates.* 承担
assert.equal('inventoryLocalFlow' in summary, false);
assert.equal(summary.webSurface.mobileWebSupported, true);
assert.equal(summary.webSurface.pwaSupported, true);
assert.equal(summary.webSurface.desktopPreviewOnly, true);
assert.equal(summary.webSurface.desktopDashboardEnabled, false);
assert.equal(summary.warningCounts.dataAggregationRuntimeBlockerCount, 0);
assert.equal(summary.requiredQaCommands.includes('npm run test:e2e'), true);
assert.equal(summary.requiredQaCommands.includes('npm run test:qa:static'), true);
assert.equal(summary.needsCeoGateForRelease, true);
assert.equal(summary.ceoGateTriggers.includes('TestFlight submission'), true);

const markdown = execFileSync('node', [join(scriptDir, 'report-launch-readiness-summary.mjs'), '--markdown'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 40,
});
assert.match(markdown, /Baohe Launch Readiness Summary v0/);
assert.match(markdown, /Ordinary user public modules: none/);
assert.match(markdown, /App Store ready: false/);

console.log('launch readiness summary tests passed');
