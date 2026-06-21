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

assert.equal(report.aiProviderRouter.version, 'ai-provider-router-contract-v0');
assert.equal(report.aiProviderRouter.implementation, 'runtime-aware-contract');
assert.equal(report.aiProviderRouter.boundaries.realProviderCallsEnabled, false);
assert.equal(report.aiProviderRouter.providers.productionProviderEnabled, false);
assert.equal(report.aiProviderRouter.runtimeAiReadiness.providerCount, 4);
assert.equal(report.aiProviderRouter.runtimeAiReadiness.configuredProviderCount, 0);
assert.equal(report.aiProviderRouter.runtimeAiReadiness.enabledProviderCount, 0);

assert.equal(report.summary.aiProviderRouterVersion, 'ai-provider-router-contract-v0');
assert.equal(report.summary.aiProviderConfiguredCount, 0);
assert.equal(report.summary.aiProviderEnabledCount, 0);
assert.equal(report.summary.aiRealProviderCallsEnabled, false);
assert.equal(report.summary.defaultAiProvider, null);

console.log('report-module-registry AI provider router tests passed');
