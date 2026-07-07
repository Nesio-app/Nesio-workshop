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

assert.equal(report.standaloneAppReadiness.version, 'standalone-app-readiness-contract-v0');
assert.equal(report.standaloneAppReadiness.architecture, 'baohe-first-multi-sku-ready');
assert.equal(report.standaloneAppReadiness.implementation, 'strategy-contract-only');
assert.equal(report.standaloneAppReadiness.boundaries.splitsRepo, false);
assert.equal(report.standaloneAppReadiness.boundaries.createsStandaloneApp, false);
assert.equal(report.standaloneAppReadiness.boundaries.createsAppStoreListing, false);
assert.equal(report.standaloneAppReadiness.boundaries.migratesCode, false);
assert.equal(report.standaloneAppReadiness.boundaries.migratesData, false);
assert.equal(report.standaloneAppReadiness.boundaries.separateAppStoreMetadataDraftOnly, true);
assert.equal(report.standaloneAppReadiness.boundaries.separatePrivacyLabelDraftOnly, true);
assert.equal(report.standaloneAppReadiness.boundaries.standaloneEntitlementDraftOnly, true);

assert.deepEqual(report.standaloneAppReadiness.extractionConditions, [
  'independent_user_group',
  'commercial_model_conflict_with_bundle',
  'app_store_review_risk_requires_separation',
  'module_complexity_slows_main_app',
  'independent_brand_required',
]);

assert.equal(report.standaloneAppReadiness.modules.length, report.summary.moduleCount);
assert.equal(report.standaloneAppReadiness.summary.moduleCount, report.summary.moduleCount);
assert.equal(report.standaloneAppReadiness.summary.readyNowCount, 0);
assert.equal(report.standaloneAppReadiness.summary.possibleLaterCount, 0);
assert.equal(report.standaloneAppReadiness.summary.notNowCount, report.summary.moduleCount);
assert.equal(report.standaloneAppReadiness.summary.warningCount, 0);
assert.equal(report.summary.standaloneReadinessReadyNowCount, 0);
assert.equal(report.summary.standaloneReadinessPossibleLaterCount, 0);

const byModule = new Map(report.standaloneAppReadiness.modules.map((entry) => [entry.moduleId, entry]));
// inventory 已原生化,不再是可拆分评估对象
assert.equal(byModule.has('inventory'), false);

for (const [moduleId, entry] of byModule) {
  assert.equal(entry.createsStandaloneAppNow, false, `${moduleId} must not create standalone app now`);
  assert.equal(entry.splitsRepoNow, false, `${moduleId} must not split repo now`);
  assert.equal(entry.migratesCodeNow, false, `${moduleId} must not migrate code now`);
  assert.equal(entry.migratesDataNow, false, `${moduleId} must not migrate data now`);
  assert.ok(['not_now', 'possible_later'].includes(entry.standaloneEligible));
}

for (const moduleId of ['finance', 'health', 'psychoanalysis']) {
  const entry = byModule.get(moduleId);
  assert.equal(entry.standaloneEligible, 'not_now', `${moduleId} must not be standalone eligible now`);
  assert.equal(entry.extractionReadinessScore, 0, `${moduleId} readiness score should be 0`);
}

console.log('report-module-registry standalone readiness tests passed');
