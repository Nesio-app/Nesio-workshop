import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  ['storage-web/app.js', fs.readFileSync(path.join(root, 'storage-web', 'app.js'), 'utf8')],
  ['public/storage/app.js', fs.existsSync(path.join(root, 'public', 'storage', 'app.js'))
    ? fs.readFileSync(path.join(root, 'public', 'storage', 'app.js'), 'utf8')
    : ''],
];

const requiredMarkers = [
  "LOCAL_PROFILE_STORAGE_KEY = 'baohe_local_profile_v01'",
  "LOCAL_PROFILE_SCHEMA_VERSION = 'LocalProfile@v1'",
  "LOCAL_INVENTORY_ITEM_SCHEMA_VERSION = 'LocalInventoryItem@v1'",
  "LOCAL_INVENTORY_STORE_SCHEMA_VERSION = 'LocalInventoryStore@v1'",
  "LOCAL_DATA_ROOT_SCHEMA_VERSION = 'BaoheLocalDataRoot@v1'",
  "LOCAL_DATA_VERSION = 'baohe-local-data-v1'",
  'function createLocalProfile(',
  'function loadLocalProfile(',
  'function saveLocalProfile(',
  'function readInventoryTable(',
  'function writeInventoryTable(',
  'function activeItems(',
  'function archiveItem(',
  'function deleteItem(',
  'function runLocalDataMigrationSmokeCheck(',
  'function assertLaunchCloudFlagsDisabled(',
  'function deleteAllLocalLaunchData(',
  'locationHint',
  'createdAt',
  'updatedAt',
  'status: \'active\'',
  'cloudEnabled: false',
  'cloudSyncEnabled: false',
  'realCloudProviderConnected: false',
  'schemaVersions',
  'migrationSmokeCheck',
  'localProfile',
  'demoPersonalSeparated: true',
  'networkRequired: false',
];

for (const [label, source] of files) {
  assert.notEqual(source, '', `${label} must exist`);
  for (const marker of requiredMarkers) {
    assert.ok(source.includes(marker), `${label} missing marker: ${marker}`);
  }
  assert.equal(/cloudEnabled:\s*true/.test(source), false, `${label} must not enable cloudEnabled`);
  assert.equal(/cloudSyncEnabled:\s*true/.test(source), false, `${label} must not enable cloudSyncEnabled`);
  assert.equal(/realCloudProviderConnected:\s*true/.test(source), false, `${label} must not connect real cloud provider`);
}

console.log('local data launch readiness precheck passed');
