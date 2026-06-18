import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.equal(packageJson.scripts['bundle:toolbox'], 'node scripts/bundle-toolbox.mjs');
assert.equal(packageJson.scripts['test:toolbox-bundler'], 'node scripts/toolbox-bundler.test.mjs');

const scriptPath = join(repoRoot, 'scripts', 'bundle-toolbox.mjs');
assert.equal(existsSync(scriptPath), true, 'bundle-toolbox.mjs must exist');

const output = execFileSync('node', [scriptPath, '--dry-run'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 4,
});
const plan = JSON.parse(output);

assert.equal(plan.version, 'toolbox-bundle-plan-v0');
assert.equal(plan.implementation, 'local-manifest-driven-static-bundler');
assert.equal(plan.boundaries.noExternalServiceCalls, true);
assert.equal(plan.boundaries.noRealDataMigration, true);
assert.equal(plan.boundaries.noRuntimePluginLoading, true);
assert.equal(plan.exposureMode, 'public_launch_only');
assert.deepEqual(plan.entries.map((entry) => entry.moduleId), ['inventory']);

const entryByModuleId = new Map(plan.entries.map((entry) => [entry.moduleId, entry]));
const excludedByModuleId = new Map(plan.excludedEntries.map((entry) => [entry.moduleId, entry]));
assert.equal(entryByModuleId.get('inventory')?.sourceDir, 'storage-web');
assert.equal(entryByModuleId.get('inventory')?.publicPath, 'storage');
assert.equal(entryByModuleId.has('plan'), false, 'default public bundle must not include sandbox plan');
assert.equal(entryByModuleId.has('fitness'), false, 'default public bundle must not include sandbox fitness');
assert.equal(entryByModuleId.has('health'), false, 'default public bundle must not include gated health');
assert.equal(excludedByModuleId.has('plan'), true, 'sandbox plan must be listed as excluded from public bundle');
assert.equal(excludedByModuleId.has('fitness'), true, 'sandbox fitness must be listed as excluded from public bundle');
assert.equal(excludedByModuleId.has('health'), true, 'gated health must be listed as excluded from public bundle');

for (const entry of plan.entries) {
  assert.equal(entry.manifestVersion, 'tool-manifest-v0');
  assert.equal(entry.generatedConfigHasExternalUrl, false, `${entry.moduleId} must not generate external API URLs`);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'baohe-toolbox-bundle-'));
try {
  const applyOutput = execFileSync('node', [scriptPath, '--out-dir', tempRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 4,
  });
  const applied = JSON.parse(applyOutput);
  assert.equal(applied.applied, true);
  assert.equal(existsSync(join(tempRoot, 'storage', 'index.html')), true);
  assert.equal(existsSync(join(tempRoot, 'adhd-flow', 'app.js')), false, 'default public bundle must not write sandbox plan assets');
  assert.equal(existsSync(join(tempRoot, 'fitness', 'app.js')), false, 'default public bundle must not write sandbox fitness assets');
  assert.equal(existsSync(join(tempRoot, 'health', 'index.html')), false, 'default public bundle must not write gated health assets');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('toolbox bundler tests passed');
