import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['scripts/submodule-doctor.mjs', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

const report = JSON.parse(output);

assert.equal(report.version, 'baohe-submodule-doctor-v0');
assert.equal(report.summary.totalSubmoduleCount, 5);
assert.equal(report.summary.activeLaunchDependencyCount, 1);
assert.equal(report.summary.publicLaunchSurfaceImpliedBySubmodule, false);
assert.equal(report.remediation.initCommand, 'git submodule update --init --recursive');

const byPath = new Map(report.submodules.map((entry) => [entry.path, entry]));

assert.equal(byPath.get('storage-ios')?.state, 'active_launch_dependency');
assert.equal(byPath.get('storage-ios')?.launchSurface, 'inventory_lineage_only');
assert.equal(byPath.get('psych-tool-ios')?.state, 'contract_reference');
assert.equal(byPath.get('questionbank-ios')?.state, 'sandbox_reference');
assert.equal(byPath.get('reading-ios')?.state, 'sandbox_reference');
assert.equal(byPath.get('weaver-ai')?.state, 'contract_reference');

for (const entry of report.submodules) {
  assert.equal(typeof entry.initialized, 'boolean', `${entry.path} should report initialized state`);
  assert.ok(entry.url.startsWith('https://github.com/hanbing6228/'), `${entry.path} should stay under the known owner namespace`);
  assert.ok(entry.policyNote.length > 10, `${entry.path} should include a useful policy note`);
}
