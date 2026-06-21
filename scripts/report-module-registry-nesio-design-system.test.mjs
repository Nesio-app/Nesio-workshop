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

assert.equal(report.nesioDesignSystem.version, 'nesio-design-system-v0');
assert.equal(report.nesioDesignSystem.source.sourceName, 'Nesio Design System');
assert.equal(report.nesioDesignSystem.source.namespace, 'NesioDesignSystem_d76dec');
assert.equal(report.nesioDesignSystem.source.sourcePath, 'design-system/nesio');
assert.equal(report.nesioDesignSystem.source.importedFrom, '/Users/jing/Downloads/Nosio Design System');
assert.equal(report.nesioDesignSystem.source.productionImportMode, 'lift-token-values-not-wholesale-css-import');

assert.equal(report.nesioDesignSystem.summary.canonicalName, 'Nesio');
assert.equal(report.nesioDesignSystem.summary.originalDownloadName, 'Nesio');
assert.equal(report.nesioDesignSystem.summary.runtimeSurfaceCount >= 12, true);
assert.equal(report.nesioDesignSystem.summary.requiredTokenFileCount, 5);
assert.equal(report.nesioDesignSystem.summary.requiredComponentFileCount, 9);
assert.equal(report.nesioDesignSystem.summary.guardrailCount >= 7, true);
assert.equal(report.nesioDesignSystem.summary.wholesaleUiReplacementAllowed, false);
assert.equal(report.nesioDesignSystem.summary.shellKitReferenceOnly, true);

assert.ok(report.nesioDesignSystem.assets.brand.crystal.endsWith('/icons/treasurebox.svg'));
assert.equal(Object.keys(report.nesioDesignSystem.assets.tools).length, 11);
assert.equal(Object.keys(report.nesioDesignSystem.assets.ai).length >= 6, true);

assert.equal(report.summary.nesioDesignSystemVersion, 'nesio-design-system-v0');
assert.equal(report.summary.nesioRuntimeSurfaceCount, report.nesioDesignSystem.summary.runtimeSurfaceCount);
assert.equal(report.summary.nesioDesignSystemGuardrailCount, report.nesioDesignSystem.summary.guardrailCount);
assert.equal(report.summary.nesioDesignSystemWholesaleUiReplacementAllowed, false);

console.log('report-module-registry Nesio design-system tests passed');
