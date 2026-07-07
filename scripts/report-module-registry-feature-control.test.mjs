import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

assert.equal(report.featureControl.version, 'feature-control-contract-v0');
assert.equal(report.featureControl.implementation, 'local-static-config');
assert.equal(report.featureControl.boundaries.remoteConfigEnabled, false);
assert.equal(report.featureControl.boundaries.realtimePushEnabled, false);
assert.equal(report.featureControl.boundaries.deletesUserData, false);

assert.equal(report.featureControl.modules.length, report.summary.moduleCount);
for (const entry of report.featureControl.modules) {
  assert.match(entry.killSwitchKey, /^kill\.module\.[a-z0-9_-]+$/);
  assert.equal(typeof entry.canBeKilled, 'boolean');
  assert.equal(entry.killed, false);
  assert.equal(entry.entryActionEnabled, entry.canOpenAtRuntime);
}

for (const moduleId of ['finance', 'health', 'psychoanalysis']) {
  const entry = report.featureControl.modules.find((item) => item.moduleId === moduleId);
  assert.ok(entry, `${moduleId} feature-control entry must exist`);
  assert.equal(entry.canBeKilled, true, `${moduleId} must be killable`);
  assert.equal(entry.defaultFailClosed, true, `${moduleId} must default fail-closed`);
  assert.equal(entry.entryActionEnabled, false, `${moduleId} must not be executable at first launch`);
}

// inventory 已原生化,不再有 feature-control 条目
assert.equal(report.featureControl.modules.some((entry) => entry.moduleId === 'inventory'), false);
assert.deepEqual(report.featureControl.readyToCandidateModuleIds, []);

const launchSafety = readFileSync(join(repoRoot, 'lib/portal/launch-safety.ts'), 'utf8');
assert.match(launchSafety, /isLocalKillSwitchActive/, 'launch-safety must expose local kill switch check');
assert.match(launchSafety, /applyFeatureControlToolGate/, 'launch-safety must expose Shell feature-control gate');

const portal = readFileSync(join(repoRoot, 'components/portal/Portal.tsx'), 'utf8');
assert.match(portal, /applyFeatureControlToolGate/, 'Portal must consume feature-control local kill switch state');

const openTool = readFileSync(join(repoRoot, 'lib/portal/open-tool.ts'), 'utf8');
assert.match(openTool, /isToolKilledByLocalFeatureControl/, 'openToolHref must fail closed for killed tools');

assert.equal(report.summary.featureControlModuleCount, report.summary.moduleCount);
assert.equal(report.summary.killSwitchCapableModuleCount, report.summary.moduleCount);
assert.equal(report.summary.remoteFeatureControlEnabled, false);

console.log('report-module-registry feature-control tests passed');
