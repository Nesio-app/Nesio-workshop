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
assert.equal(plan.entries.length >= 4, true);

const entryByModuleId = new Map(plan.entries.map((entry) => [entry.moduleId, entry]));
assert.equal(entryByModuleId.get('inventory')?.sourceDir, 'storage-web');
assert.equal(entryByModuleId.get('inventory')?.publicPath, 'storage');
assert.equal(entryByModuleId.get('plan')?.sourceDir, 'adhd-flow-ios/web');
assert.equal(entryByModuleId.get('fitness')?.sourceDir, 'fitness/web');
assert.equal(entryByModuleId.get('health')?.sourceDir, 'health-web');

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
  assert.equal(existsSync(join(tempRoot, 'adhd-flow', 'app.js')), true);
  assert.equal(existsSync(join(tempRoot, 'fitness', 'app.js')), true);
  assert.equal(existsSync(join(tempRoot, 'health', 'index.html')), true);
  assert.equal(readFileSync(join(tempRoot, 'adhd-flow', 'config.js'), 'utf8').includes('https://'), false);
  assert.equal(readFileSync(join(tempRoot, 'fitness', 'config.js'), 'utf8').includes('https://'), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('toolbox bundler tests passed');
