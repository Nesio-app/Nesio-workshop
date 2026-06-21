import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

const secretary = report.tools.find((entry) => entry.id === 'secretary');
assert.equal(secretary?.publicIndex, true, 'secretary static page must be preserved for the home chat button');
assert.equal(
  report.boundaries.publicLaunchEmbeddedModules.includes('secretary'),
  false,
  'secretary must not be part of the public launch embedded module surface',
);
assert.equal(
  report.boundaries.syncedEmbeddedModules.includes('secretary'),
  false,
  'secretary must not be treated as a public synced embedded tool',
);
assert.equal(secretary?.shellEntitlement?.blockedByApprovalGate, true, 'secretary remains gated at module contract level');

for (const warning of report.boundaries.boundaryWarnings) {
  assert.notEqual(warning.reason, 'Static route validation requires public/index for local static modules.');
}

assert.deepEqual(report.boundaries.publicLaunchEmbeddedModules, ['plan', 'inventory']);
assert.equal(report.boundaries.syncedEmbeddedModules.includes('reading'), false);

console.log('report-module-registry launch exposure semantics tests passed');
