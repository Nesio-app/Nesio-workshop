import assert from 'node:assert/strict';
import { buildCloudReadinessContract } from '../lib/portal/cloud-readiness-contract.mjs';

const contract = buildCloudReadinessContract({
  env: {
    CLOUD_DB_ENABLED: 'true',
    CLOUD_STORAGE_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_STORAGE_BUCKET: 'baohe-files',
  },
});

assert.equal(contract.implementation, 'runtime-aware-contract');
assert.equal(contract.boundaries.cloudEnabled, true);
assert.equal(contract.boundaries.realCloudProviderConnected, true);
assert.equal(contract.boundaries.networkRequestsEnabled, true);
assert.equal(contract.boundaries.readsCloudData, true);
assert.equal(contract.boundaries.writesCloudData, true);
assert.equal(contract.boundaries.environmentSecretsRequiredNow, true);
assert.equal(contract.boundaries.realCloudRequiresCeoGate, true);

assert.equal(contract.runtimeCloudReadiness.providerCount, 2);
assert.equal(contract.runtimeCloudReadiness.configuredProviderCount, 2);
assert.equal(contract.runtimeCloudReadiness.enabledProviderCount, 2);
assert.equal(contract.runtimeCloudReadiness.providers.database.id, 'cloud_database');
assert.equal(contract.runtimeCloudReadiness.providers.database.configured, true);
assert.equal(contract.runtimeCloudReadiness.providers.database.enabled, true);
assert.equal(contract.runtimeCloudReadiness.providers.database.serverOnly, true);
assert.equal(contract.runtimeCloudReadiness.providers.database.startEndpoint, null);
assert.equal(contract.runtimeCloudReadiness.providers.database.secretsRedacted, true);
assert.equal(contract.runtimeCloudReadiness.providers.storage.id, 'cloud_storage');
assert.equal(contract.runtimeCloudReadiness.providers.storage.configured, true);
assert.equal(contract.runtimeCloudReadiness.providers.storage.enabled, true);
assert.equal(contract.runtimeCloudReadiness.providers.storage.serverOnly, true);

assert.equal(contract.inventoryCloudSchemaDraft.enabledNow, true);
assert.equal(contract.userIdentityBoundary.cloudIdentityEnabled, true);
assert.equal(contract.summary.cloudEnabled, true);
assert.equal(contract.summary.realCloudProviderConnected, true);
assert.equal(contract.summary.cloudProviderCandidateCount, 5);
assert.equal(contract.summary.configuredCloudProviderCount, 2);
assert.equal(contract.summary.enabledCloudProviderCount, 2);

console.log('cloud readiness runtime env tests passed');
