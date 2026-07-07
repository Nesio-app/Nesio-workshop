import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

assert.equal(report.launchExposureSemantics.version, 'launch-exposure-semantics-v0');
assert.equal(report.summary.launchExposureReleaseBlockerCount, 0);
assert.equal(report.summary.launchExposureIntentionalExclusionCount > 0, true);
assert.equal(report.summary.boundaryWarningCount, report.launchExposureSemantics.releaseBlockerCount);
assert.doesNotMatch(report.summary.qaLine, /[1-9]\d* module boundary warning/);
assert.match(report.summary.qaLine, /intentional launch exclusion/);

const exclusions = new Map(report.launchExposureSemantics.intentionalExclusions.map((entry) => [
  entry.moduleId,
  entry,
]));

for (const moduleId of ['reading', 'fitness']) {
  const entry = exclusions.get(moduleId);
  assert.equal(entry?.reason, 'not_in_public_launch_surface', `${moduleId} must be an intentional launch exclusion`);
  assert.equal(entry.releaseBlocker, false, `${moduleId} must not be a release blocker`);
  assert.equal(entry.resolverSource, 'resolveLaunchSurfaceState');
  assert.equal(entry.evidenceFields.includes('launchSurface.public.shellAction'), true);
}


for (const warning of report.boundaries.boundaryWarnings) {
  assert.notEqual(warning.reason, 'Static route validation requires public/index for local static modules.');
}

assert.deepEqual(report.boundaries.publicLaunchEmbeddedModules, ['inventory']);
assert.equal(report.boundaries.syncedEmbeddedModules.includes('reading'), false);

console.log('report-module-registry launch exposure semantics tests passed');
