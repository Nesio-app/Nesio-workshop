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

assert.equal(report.webSurfaceContract.version, 'web-surface-contract-v0');
assert.equal(report.webSurfaceContract.primaryExperience, 'mobile_web_pwa');
assert.equal(report.webSurfaceContract.mobileWeb.supportLevel, 'official');
assert.equal(report.webSurfaceContract.desktopWeb.supportLevel, 'preview_compatibility');
assert.equal(report.webSurfaceContract.desktopWeb.desktopSaasDashboardEnabled, false);
assert.deepEqual(report.webSurfaceContract.mobileWeb.launchScope.publicModuleIds, ['shell', 'inventory']);

assert.equal(report.summary.webSurfaceContractVersion, 'web-surface-contract-v0');
assert.equal(report.summary.mobileWebSupported, true);
assert.equal(report.summary.pwaSupported, true);
assert.equal(report.summary.desktopPreviewOnly, true);
assert.equal(report.summary.desktopDashboardEnabled, false);
assert.equal(report.summary.webSurfaceWarningCount, 0);

const desktopPromisedModules = report.webSurfaceContract.modules
  .filter((entry) => entry.desktopProductPromise)
  .map((entry) => entry.moduleId);
assert.deepEqual(desktopPromisedModules, []);

console.log('report web surface contract tests passed');
