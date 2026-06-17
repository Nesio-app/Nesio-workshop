import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_CONTRACT_BOUNDARIES_V0,
  buildEntitlementsResponse,
  buildInventoryResponse,
  buildModulesResponse,
  buildUserDataDeleteResponse,
  buildUserDataExportResponse,
} from '../lib/portal/app-api-contract-v0.mjs';
import { buildAiProviderRouterContract } from '../lib/portal/ai-provider-router-contract.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function assertFalse(value, label) {
  assert.equal(value, false, `${label} must be false`);
}

function assertNoRealSecret(content, path) {
  assert.equal(/sk-[A-Za-z0-9_-]{20,}/.test(content), false, `${path} must not contain an OpenAI-like key`);
  assert.equal(/AIza[A-Za-z0-9_-]{20,}/.test(content), false, `${path} must not contain a Gemini-like key`);
  assert.equal(/postgres(?:ql)?:\/\/[^\\s]*:[^\\s]*@/i.test(content), false, `${path} must not contain a DB URL with credentials`);
}

for (const [key, value] of Object.entries(API_CONTRACT_BOUNDARIES_V0)) {
  if (key === 'implementation' || key === 'dataSource') continue;
  assertFalse(value, `api boundary ${key}`);
}

const responses = [
  buildModulesResponse(),
  buildInventoryResponse(),
  buildEntitlementsResponse(),
  buildUserDataExportResponse(),
  buildUserDataDeleteResponse(),
];

for (const response of responses) {
  assert.equal(response.ok, true, `${response.endpoint} should be ok`);
  assert.equal(response.boundaries.dataSource, 'mock-local-fixture');
  assertFalse(response.boundaries.readsRealUserData, `${response.endpoint} readsRealUserData`);
  assertFalse(response.boundaries.writesRealUserData, `${response.endpoint} writesRealUserData`);
  assertFalse(response.boundaries.usesRealAuth, `${response.endpoint} usesRealAuth`);
  assertFalse(response.boundaries.writesCloud, `${response.endpoint} writesCloud`);
  assertFalse(response.boundaries.authorizesExternalServices, `${response.endpoint} authorizesExternalServices`);
}

const aiContract = buildAiProviderRouterContract();
assertFalse(aiContract.boundaries.appStoreLaunchEnabled, 'AI appStoreLaunchEnabled');
assertFalse(aiContract.boundaries.shellAiEnabled, 'AI shellAiEnabled');
assertFalse(aiContract.boundaries.inventoryAiEnabled, 'AI inventoryAiEnabled');
assertFalse(aiContract.boundaries.realProviderCallsEnabled, 'AI realProviderCallsEnabled');
assertFalse(aiContract.boundaries.readsRealUserData, 'AI readsRealUserData');
assertFalse(aiContract.boundaries.authorizesExternalProviders, 'AI authorizesExternalProviders');

const envFiles = ['.env.example', '.env.staging.example'];
for (const file of envFiles) {
  assertNoRealSecret(readRepoFile(file), file);
}

const migration = readRepoFile('database/migrations/0008_app_contract_schema.sql');
assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS local_profile'), true);
assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS modules'), true);
assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS inventory_items'), true);
assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS entitlements'), true);
assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS audit_events'), true);
assert.equal(/CREATE TABLE IF NOT EXISTS users\\b/i.test(migration), false, 'v0 must not create real users table');
assert.equal(/reads_real_user_data INTEGER NOT NULL DEFAULT 1/i.test(migration), false);
assert.equal(/writes_real_user_data INTEGER NOT NULL DEFAULT 1/i.test(migration), false);

console.log('no-real-data precheck passed');
