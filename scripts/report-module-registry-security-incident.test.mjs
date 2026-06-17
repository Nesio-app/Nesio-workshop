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

assert.equal(report.securityIncidentReadiness.version, 'security-incident-readiness-contract-v0');
assert.equal(report.securityIncidentReadiness.implementation, 'emergency-plan-contract-only');
assert.deepEqual(report.securityIncidentReadiness.severityVocabulary, ['sev0', 'sev1', 'sev2', 'sev3']);
assert.equal(report.securityIncidentReadiness.boundaries.sendsNotifications, false);
assert.equal(report.securityIncidentReadiness.boundaries.deletesRealData, false);
assert.equal(report.securityIncidentReadiness.boundaries.revokesRealTokens, false);
assert.equal(report.securityIncidentReadiness.boundaries.processesRefunds, false);
assert.equal(report.securityIncidentReadiness.boundaries.rollsBackProduction, false);
assert.equal(report.securityIncidentReadiness.boundaries.makesLegalStatement, false);
assert.equal(report.securityIncidentReadiness.boundaries.userNoticeRequiresCeoVeraGate, true);
assert.equal(report.securityIncidentReadiness.boundaries.realTokenRevokeRequiresCeoGate, true);
assert.equal(report.securityIncidentReadiness.boundaries.realDataDeleteRequiresCeoGate, true);
assert.equal(report.securityIncidentReadiness.boundaries.refundRequiresCeoGate, true);

assert.equal(report.securityIncidentReadiness.modules.length, report.summary.moduleCount);
assert.equal(report.securityIncidentReadiness.summary.moduleCount, report.summary.moduleCount);
assert.equal(report.securityIncidentReadiness.summary.planOnlyModuleCount, report.summary.moduleCount);
assert.equal(report.securityIncidentReadiness.summary.realActionEnabledCount, 0);
assert.equal(report.securityIncidentReadiness.summary.warningCount, 0);
assert.equal(report.summary.securityIncidentReadinessVersion, 'security-incident-readiness-contract-v0');
assert.equal(report.summary.securityIncidentRealActionEnabledCount, 0);

const featureControlByModule = new Map(report.featureControl.modules.map((entry) => [entry.moduleId, entry]));
const byModule = new Map(report.securityIncidentReadiness.modules.map((entry) => [entry.moduleId, entry]));

for (const [moduleId, entry] of byModule) {
  assert.ok(entry.affectedModule === moduleId);
  assert.equal(entry.disableTool.killSwitchKey, featureControlByModule.get(moduleId).killSwitchKey);
  assert.equal(entry.disableTool.planOnly, true);
  assert.equal(entry.revokeTokenPlan.planOnly, true);
  assert.equal(entry.dataExportResponse.planOnly, true);
  assert.equal(entry.dataDeleteResponse.planOnly, true);
  assert.equal(entry.userNoticeTrigger.requiresCeoVeraGate, true);
  assert.equal(entry.rollbackBuild.planOnly, true);
  assert.equal(entry.postIncidentArtifact.required, true);
  assert.equal(entry.realActionsEnabled, false);
}

for (const moduleId of ['finance', 'health', 'psychoanalysis', 'secretary']) {
  const entry = byModule.get(moduleId);
  assert.ok(entry.incidentOwner, `${moduleId} must have incident owner`);
  assert.equal(entry.defaultSeverity, 'sev1', `${moduleId} must default high-risk incidents to sev1`);
  assert.equal(entry.ceoLegalGate.required, true, `${moduleId} must require CEO/legal gate`);
}

console.log('report-module-registry security incident tests passed');
