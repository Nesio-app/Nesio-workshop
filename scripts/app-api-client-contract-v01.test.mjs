import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const source = fs.readFileSync(clientPath, 'utf8');

const requiredExports = [
  'createAppApiClient',
  'fetchModules',
  'fetchInventory',
  'fetchEntitlements',
  'exportUserData',
  'deleteUserData',
];

for (const marker of requiredExports) {
  assert.ok(source.includes(marker), `missing API client marker: ${marker}`);
}

for (const endpoint of [
  '/api/modules',
  '/api/inventory',
  '/api/entitlements',
  '/api/user-data/export',
  '/api/user-data/delete',
]) {
  assert.ok(source.includes(endpoint), `missing endpoint: ${endpoint}`);
}

assert.ok(source.includes('type AppApiFetch'), 'client must expose typed fetch boundary');
assert.ok(source.includes('local_profile'), 'client types must model local profile boundary');

console.log('App API client contract v0.1 passed');
