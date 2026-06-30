import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildSignalInputContractV1 } from '../lib/portal/domain-capability-taxonomy-v1.mjs';

const contract = buildSignalInputContractV1();

assert.equal(contract.version, 'signal-input-contract-v1');
assert.equal(contract.boundaries.reportOnly, true);
assert.equal(contract.boundaries.writesRealData, false);
assert.equal(contract.boundaries.migratesRealData, false);
assert.equal(contract.boundaries.changesRuntimeBehavior, false);

for (const surfaceKey of ['voice', 'photo', 'text', 'upload', 'calendar', 'gmail', 'weather', 'health', 'task']) {
  assert.ok(contract.surfaceIndex[surfaceKey], `${surfaceKey} should be represented`);
}

for (const surface of contract.surfaces) {
  assert.equal(surface.normalizeBeforeSignal, true, `${surface.surface} should normalize before signal`);
  assert.equal(surface.writesSignal, true, `${surface.surface} should write signal`);
  assert.equal(surface.signalIsWriteBoundary, true, `${surface.surface} should treat signal as write boundary`);
  assert.equal(surface.requiresUserConfirmationBeforeTrust, true, `${surface.surface} should require confirmation`);

  for (const target of ['memory', 'search', 'reminder', 'insight']) {
    assert.ok(surface.projectionTargets.includes(target), `${surface.surface} should project to ${target}`);
  }
}

assert.equal(contract.surfaceIndex.gmail.externalSource, true);
assert.equal(contract.surfaceIndex.gmail.sensitive, true);
assert.equal(contract.surfaceIndex.health.sensitive, true);
assert.equal(contract.surfaceIndex.health.runtimeStatus, 'contract_only');
assert.equal(contract.summary.warningCount, 0);

const output = execFileSync('node', ['scripts/report-module-registry.mjs'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const report = JSON.parse(output);

assert.equal(report.summary.signalInputContractVersion, 'signal-input-contract-v1');
assert.ok(report.summary.signalInputSurfaceCount >= 9);
assert.equal(report.summary.signalInputWritesSignalSurfaceCount, report.summary.signalInputSurfaceCount);
assert.equal(report.domainCapabilityRegistry.signalInputContract.version, 'signal-input-contract-v1');
assert.equal(report.domainCapabilityRegistry.signalInputContract.surfaceIndex.photo.signalIsWriteBoundary, true);
assert.equal(report.domainCapabilityRegistry.signalInputContract.surfaceIndex.calendar.externalSource, true);

console.log('signal input contract passed');
