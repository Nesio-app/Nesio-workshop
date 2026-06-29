#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exportRoutePath = path.join(root, 'app', 'api', 'user-data', 'export', 'route.ts');
const deleteRoutePath = path.join(root, 'app', 'api', 'user-data', 'delete', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const readmePath = path.join(root, 'database', 'README.md');
const packagePath = path.join(root, 'package.json');

const exportRoute = fs.readFileSync(exportRoutePath, 'utf8');
const deleteRoute = fs.readFileSync(deleteRoutePath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'buildCloudUserDataExportResponse',
  'setRefreshedAuthCookies',
  'refreshedSession',
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'deriveCloudIdentity',
  '/auth/v1/user',
  '/rest/v1/user_profiles',
  '/rest/v1/memory_nodes',
  '/rest/v1/memory_edges',
  '/rest/v1/memory_assets',
  '/rest/v1/inventory_items',
  '/rest/v1/product_events',
  '/rest/v1/profile_settings',
  'cloud-product-data-export',
  'supabase-product-data-v1',
  'includesRealUserData: true',
  'readsCloud: true',
  'writesCloud: false',
  'buildUserDataExportResponse',
  'accountProfiles',
  'profileSettings',
  'inventoryItems',
  'productEvents',
  'storageObjects',
  'avatarStoragePath',
  'asset->>storagePath',
]) {
  assert.ok(exportRoute.includes(marker), `user data export route missing marker: ${marker}`);
}

for (const marker of [
  'buildCloudUserDataDeleteResponse',
  'setRefreshedAuthCookies',
  'refreshedSession',
  'CLOUD_DB_ENABLED',
  'CLOUD_STORAGE_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'deriveCloudIdentity',
  '/auth/v1/user',
  '/rest/v1/user_profiles',
  '/rest/v1/memory_nodes',
  '/rest/v1/memory_edges',
  '/rest/v1/memory_assets',
  '/rest/v1/inventory_items',
  '/rest/v1/product_events',
  'cloud-product-data-delete',
  'supabase-product-data-v1',
  'confirmation',
  'DELETE_CLOUD_PRODUCT_DATA',
  'deletesCloudData: true',
  'writesCloud: true',
  'readCloudAssetStoragePaths',
  'readCloudAvatarStoragePaths',
  'deleteCloudStorageObjects',
  '/storage/v1/object/',
  'storageObjects',
  'deletesCloudStorage',
  'storageDeletionReady',
  'storage_bucket_required',
  'asset->>storagePath',
  'avatarStoragePath',
  'buildUserDataDeleteResponse',
  'user_profiles',
  'inventory_items',
  'product_events',
]) {
  assert.ok(deleteRoute.includes(marker), `user data delete route missing marker: ${marker}`);
}

assert.doesNotMatch(exportRoute, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/, 'export route must not serialize service role secrets.');
assert.doesNotMatch(deleteRoute, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/, 'delete route must not serialize service role secrets.');

for (const marker of [
  'cloudExportKind',
  'cloudDeleteKind',
  'confirmation?:',
  'DELETE_CLOUD_PRODUCT_DATA',
]) {
  assert.ok(client.includes(marker), `app-api-client missing cloud user data marker: ${marker}`);
}

assert.doesNotMatch(
  deleteRoute,
  /confirmation\s*===\s*['"]DELETE_CLOUD_MEMORY['"]/,
  'full cloud product-data delete must not accept the legacy memory-only confirmation.',
);
assert.doesNotMatch(
  deleteRoute,
  /legacyConfirmationAccepted/,
  'full cloud product-data delete must not advertise a legacy confirmation.',
);
assert.doesNotMatch(
  client,
  /DELETE_CLOUD_MEMORY/,
  'app-api-client must not offer the legacy memory-only confirmation for full product-data delete.',
);
assert.doesNotMatch(
  readme,
  /DELETE_CLOUD_MEMORY[^。.\n]*(兼容|compatible)/i,
  'database README must not document legacy DELETE_CLOUD_MEMORY as compatible with full product-data delete.',
);

assert.match(readme, /\/api\/user-data\/export/, 'database README must document user-data export backend behavior.');
assert.match(readme, /\/api\/user-data\/delete/, 'database README must document user-data delete backend behavior.');
assert.match(readme, /inventory_items/, 'database README must document inventory_items export/delete coverage.');
assert.match(readme, /product_events/, 'database README must document product_events export/delete coverage.');
assert.match(readme, /Storage object/i, 'database README must document Storage object delete coverage.');
assert.match(readme, /SUPABASE_STORAGE_BUCKET/, 'database README must document the Storage bucket requirement for user-data delete.');
assert.equal(pkg.scripts['test:cloud-user-data-runtime'], 'node scripts/cloud-user-data-runtime.test.mjs');
assert.match(pkg.scripts['test:contracts'], /test:cloud-user-data-runtime/);

console.log('cloud user data runtime contract passed');
