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

assert.equal(report.userIdentityUpgrade.version, 'user-identity-upgrade-contract-v0');
assert.equal(report.userIdentityUpgrade.implementation, 'runtime-aware-contract');
assert.equal(report.userIdentityUpgrade.currentIdentity.profileKind, 'local_profile');
assert.equal(report.userIdentityUpgrade.currentIdentity.accountSystemEnabled, false);
assert.equal(report.userIdentityUpgrade.currentIdentity.serverUserId, null);
assert.equal(report.userIdentityUpgrade.currentIdentity.realAuthEnabled, false);
assert.equal(report.userIdentityUpgrade.boundaries.appleSignInEnabled, false);
assert.equal(report.userIdentityUpgrade.boundaries.oauthEnabled, false);
assert.equal(report.userIdentityUpgrade.boundaries.cloudIdentityEnabled, false);
assert.equal(report.userIdentityUpgrade.boundaries.createsUsersTable, false);
assert.equal(report.userIdentityUpgrade.boundaries.realAccountLinkingEnabled, false);
assert.equal(report.userIdentityUpgrade.boundaries.realAuthRequiresCeoGate, true);
assert.deepEqual(
  report.userIdentityUpgrade.supportedAuthProviders,
  ['email', 'google', 'wechat', 'phone'],
);
assert.equal(report.userIdentityUpgrade.runtimeAuthReadiness.providerCount, 4);
for (const provider of ['email', 'google', 'wechat', 'phone']) {
  assert.equal(report.userIdentityUpgrade.runtimeAuthReadiness.providers[provider].startEndpoint, '/api/auth/start');
  assert.equal(report.userIdentityUpgrade.runtimeAuthReadiness.providers[provider].secretsRedacted, true);
}
assert.equal(report.userIdentityUpgrade.identityBoundaryReport.authStartEndpoint, '/api/auth/start');
assert.equal(report.userIdentityUpgrade.summary.supportedAuthProviderCount, 4);

assert.equal(report.summary.accountSystemEnabled, false);
assert.equal(report.summary.supportedAuthProviderCount, 4);
assert.equal(report.summary.currentProfileKind, 'local_profile');
assert.equal(report.summary.serverUserIdEnabled, false);
assert.equal(report.summary.identityUpgradePathReadable, true);

assert.deepEqual(
  report.userIdentityUpgrade.profileKinds,
  ['local_profile', 'anonymous_profile', 'apple_sign_in_profile'],
);

assert.equal(report.userIdentityUpgrade.futureAppleSignIn.status, 'future_ceo_gated');
assert.equal(report.userIdentityUpgrade.futureAppleSignIn.enabledNow, false);
assert.equal(report.userIdentityUpgrade.accountLinking.enabledNow, false);
assert.equal(report.userIdentityUpgrade.accountLinking.strategy, 'local_profile_to_account_link_after_ceo_gate');

assert.equal(report.userIdentityUpgrade.localDataMerge.enabledNow, false);
assert.equal(report.userIdentityUpgrade.localDataMerge.planKind, 'contract_only_future_merge');
assert.equal(report.userIdentityUpgrade.localDataMerge.defaultPolicy, 'manual_review_before_merge');
assert.equal(report.userIdentityUpgrade.localDataMerge.mergeRequiresCeoGate, true);

assert.equal(report.userIdentityUpgrade.deleteLocalData.scope, 'device_local_data_only');
assert.equal(report.userIdentityUpgrade.deleteAccount.scope, 'future_server_account_and_cloud_data');
assert.equal(report.userIdentityUpgrade.deleteAccount.enabledNow, false);
assert.notEqual(report.userIdentityUpgrade.deleteLocalData.scope, report.userIdentityUpgrade.deleteAccount.scope);

assert.equal(report.userIdentityUpgrade.multiDeviceConflict.enabledNow, false);
assert.equal(report.userIdentityUpgrade.multiDeviceConflict.defaultResolution, 'manual_review_required');

console.log('report-module-registry user identity upgrade tests passed');
