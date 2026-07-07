import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import { buildModuleProductContractV0 } from '../lib/portal/module-product-contract-v0.mjs';
import { buildWebSurfaceContractV0 } from '../lib/portal/web-surface-contract-v0.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const config = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));
const registry = buildModuleRegistry(config);
const moduleProductContract = buildModuleProductContractV0(registry.modules);
const contract = buildWebSurfaceContractV0({
  modules: registry.modules,
  moduleProductContract,
  mobileAppIntegration: registry.mobileAppIntegration,
});

assert.equal(contract.version, 'web-surface-contract-v0');
assert.equal(contract.implementation, 'static-surface-contract-only');
assert.equal(contract.boundaries.changesUI, false);
assert.equal(contract.boundaries.desktopDashboardEnabled, false);
assert.equal(contract.boundaries.productionDeployEnabled, false);
assert.equal(contract.boundaries.appStoreSubmissionEnabled, false);
assert.equal(contract.boundaries.readsRealData, false);
assert.equal(contract.boundaries.writesRealData, false);

assert.equal(contract.primaryExperience, 'mobile_web_pwa');
assert.equal(contract.mobileWeb.supportLevel, 'official');
assert.equal(contract.mobileWeb.mobileFirst, true);
assert.deepEqual(contract.mobileWeb.supportedBrowsers, ['iOS Safari', 'Android Chrome']);
assert.equal(contract.mobileWeb.pwa.addToHomeScreenSupported, true);
assert.deepEqual(contract.mobileWeb.launchScope.publicModuleIds, ['shell', 'inventory', 'plan']);
assert.equal(contract.mobileWeb.launchScope.todoTaskSupportRequired, true);

assert.equal(contract.desktopWeb.supportLevel, 'preview_compatibility');
assert.equal(contract.desktopWeb.desktopSaasDashboardEnabled, false);
assert.equal(contract.desktopWeb.mobileAppFrame.maxWidthPx, 480);
assert.equal(contract.desktopWeb.mobileAppFrame.centered, true);
assert.equal(contract.desktopWeb.productPromise, 'Preview and support access only; not a desktop productivity app.');
assert.ok(contract.desktopWeb.userNotice.includes('移动端优先'));

assert.equal(contract.summary.mobileWebSupported, true);
assert.equal(contract.summary.pwaSupported, true);
assert.equal(contract.summary.desktopPreviewOnly, true);
assert.equal(contract.summary.desktopDashboardEnabled, false);
assert.equal(contract.summary.warningCount, 0);

const byModule = new Map(contract.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(byModule.get('inventory').mobileWebEntry, 'supported');
assert.equal(byModule.get('inventory').desktopWebEntry, 'preview_frame');
for (const moduleId of ['finance', 'health', 'psychoanalysis', 'secretary', 'lifesim']) {
  assert.equal(byModule.get(moduleId).mobileWebEntry, 'gated_or_hidden', `${moduleId} must remain gated/hidden on mobile web`);
  assert.equal(byModule.get(moduleId).desktopWebEntry, 'not_promised', `${moduleId} must not become a desktop promise`);
}

console.log('web surface contract v0 tests passed');
