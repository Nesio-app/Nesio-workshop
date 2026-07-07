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

assert.equal(report.moduleAdapterContract.version, 'module-adapter-contract-v0');
assert.equal(report.moduleAdapterContract.architecture, 'baohe-first-modular-monolith');
assert.equal(report.moduleAdapterContract.implementation, 'report-only');
assert.equal(report.moduleAdapterContract.boundaries.splitsRepos, false);
assert.equal(report.moduleAdapterContract.boundaries.createsStandaloneApps, false);
assert.equal(report.moduleAdapterContract.boundaries.changesRuntimeBehavior, false);
assert.equal(report.moduleAdapterContract.boundaries.createsIndependentDataBackend, false);
assert.equal(report.moduleAdapterContract.boundaries.storeKitEnabled, false);
assert.equal(report.moduleAdapterContract.boundaries.externalAuthEnabled, false);
assert.equal(report.moduleAdapterContract.boundaries.cloudSyncEnabled, false);
assert.equal(report.moduleAdapterContract.boundaries.readsRealData, false);
assert.equal(report.moduleAdapterContract.boundaries.writesRealData, false);
assert.equal(report.moduleAdapterContract.boundaries.publishesApps, false);

assert.equal(report.summary.moduleAdapterContractVersion, 'module-adapter-contract-v0');
assert.equal(report.summary.modularMonolithArchitecture, 'baohe-first-modular-monolith');
assert.equal(report.summary.standaloneAppModuleCount, 0);
assert.equal(report.summary.extractableNowCount, 0);
assert.equal(report.summary.adapterContractWarningCount, 0);

const adapterByModule = new Map(report.moduleAdapterContract.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(adapterByModule.size, report.summary.moduleCount);

for (const moduleId of report.tools.map((tool) => tool.id)) {
  const entry = adapterByModule.get(moduleId);
  assert.ok(entry, `${moduleId} must have adapter contract entry`);
  assert.deepEqual(entry.adapterKeys, ['open', 'return', 'entitlement', 'localData']);
  assert.equal(entry.openAdapter, 'module_registry_open_href');
  assert.equal(entry.returnAdapter, 'shell_return_href');
  assert.equal(entry.entitlementAdapter, 'report_only_shell_entitlement');
  assert.equal(entry.localDataAdapter, 'module_local_data_contract');
  assert.equal(entry.splitsRepo, false);
  assert.equal(entry.createsStandaloneApp, false);
  assert.equal(entry.extractableNow, false);
  assert.equal(entry.adapterCompleteness, 'complete');
}

const inventory = adapterByModule.get('inventory');
assert.equal(inventory.extractabilityStatus, 'eligible_later');
assert.equal(inventory.eligibleForFutureExtraction, true);
assert.equal(inventory.reason, 'Launchable first-party module can be evaluated later; keep embedded for v0.1.');

for (const moduleId of ['finance', 'health', 'psychoanalysis']) {
  const entry = adapterByModule.get(moduleId);
  assert.equal(entry.extractableNow, false, `${moduleId} must not be extractable now`);
  assert.equal(entry.eligibleForFutureExtraction, false, `${moduleId} must not be future-extraction eligible now`);
  assert.match(entry.reason, /gated|hidden|internal|future-paid|sandbox|CEO/i);
}

assert.equal(report.moduleAdapterContract.summary.moduleCount, report.summary.moduleCount);
assert.equal(report.moduleAdapterContract.summary.completeAdapterModuleCount, report.summary.moduleCount);
assert.equal(report.moduleAdapterContract.summary.extractableNowCount, 0);
assert.equal(report.moduleAdapterContract.summary.standaloneAppCount, 0);
assert.equal(report.moduleAdapterContract.summary.warningCount, 0);
assert.equal(report.moduleAdapterContract.policy.singleFlightIsCurrentGoal, false);
assert.equal(report.moduleAdapterContract.policy.baoheShellIsPrimary, true);
assert.equal(report.moduleAdapterContract.policy.trueExtractionRequiresLaunchableOrMonetized, true);

console.log('report-module-registry module adapter contract tests passed');
