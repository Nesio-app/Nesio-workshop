import assert from 'node:assert/strict';
import { buildUserIdentityUpgradeContract } from '../lib/portal/user-identity-upgrade-contract.mjs';

const contract = buildUserIdentityUpgradeContract({
  env: {
    BAOHE_AUTH_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    WECHAT_APP_ID: 'wechat-app',
    WECHAT_APP_SECRET: 'wechat-secret',
    SMS_PROVIDER: 'twilio',
    SMS_PROVIDER_API_KEY: 'sms-key',
  },
});

assert.equal(contract.summary.accountSystemEnabled, true);
assert.equal(contract.summary.supportedAuthProviderCount, 4);
assert.equal(contract.summary.configuredAuthProviderCount, 4);
assert.equal(contract.summary.enabledAuthProviderCount, 4);
assert.equal(contract.currentIdentity.realAuthEnabled, true);
assert.equal(contract.currentIdentity.sourceOfTruth, 'runtime_auth_provider');
assert.equal(contract.boundaries.oauthEnabled, true);
assert.equal(contract.boundaries.cloudIdentityEnabled, true);
assert.equal(contract.runtimeAuthReadiness.providers.email.enabled, true);
assert.equal(contract.runtimeAuthReadiness.providers.google.enabled, true);
assert.equal(contract.runtimeAuthReadiness.providers.wechat.enabled, true);
assert.equal(contract.runtimeAuthReadiness.providers.phone.enabled, true);
assert.equal(contract.runtimeAuthReadiness.providers.google.secretsRedacted, true);

console.log('user identity runtime env tests passed');
