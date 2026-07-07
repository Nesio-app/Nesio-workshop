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

assert.equal(report.permissionConsent.version, 'permission-consent-versioning-v0');
assert.equal(report.permissionConsent.privacyPolicy.version, 'privacy-policy-draft-v0');
assert.equal(report.permissionConsent.boundaries.realConsentModalEnabled, false);
assert.equal(report.permissionConsent.boundaries.legalCommitmentGenerated, false);
assert.equal(report.permissionConsent.boundaries.realSensitiveProcessingEnabled, false);

assert.deepEqual(
  report.permissionConsent.reConsentTriggers,
  [
    'new_data_type',
    'new_external_service',
    'new_ai_processing',
    'new_health_sensitive_capability',
    'new_finance_sensitive_capability',
    'new_psychoanalysis_sensitive_capability',
    'privacy_policy_version_change',
    'permission_purpose_version_change',
  ],
);

// inventory 已原生化,权限同意边界随注册表条目移除
assert.equal(report.permissionConsent.tools.some((entry) => entry.moduleId === 'inventory'), false);

for (const moduleId of ['health', 'finance', 'psychoanalysis']) {
  const boundary = report.permissionConsent.tools.find((entry) => entry.moduleId === moduleId);
  assert.ok(boundary, `${moduleId} consent boundary must be reported`);
  assert.equal(boundary.consentRequired, true, `${moduleId} must require consent`);
  assert.equal(boundary.runtimeEnabled, false, `${moduleId} sensitive runtime must be disabled`);
  assert.equal(boundary.defaultConsentState, 'not_requested', `${moduleId} must not be pre-consented`);
  assert.equal(boundary.auditSafeSummaryIncludesContent, false, `${moduleId} summary must not include content`);
  assert.ok(boundary.sensitiveCapabilities.length > 0, `${moduleId} must list sensitive capabilities`);
}

assert.equal(report.summary.permissionConsentToolCount, report.summary.moduleCount);
assert.equal(report.summary.permissionConsentSensitiveDisabledCount >= 3, true);
assert.equal(report.summary.privacyPolicyVersion, 'privacy-policy-draft-v0');

console.log('report-module-registry permission/consent tests passed');
