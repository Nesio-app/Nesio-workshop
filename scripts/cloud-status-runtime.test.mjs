import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'cloud', 'status', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const pkgPath = path.join(root, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected cloud status route at app/api/cloud/status/route.ts');

const route = fs.readFileSync(routePath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

for (const marker of [
  'export async function GET',
  'buildProductionRuntimeStatus',
  'cloud_database',
  'cloud_storage',
  'profile_settings',
  '/api/cloud/profile-settings',
  '/api/cloud/assets',
  'assetStorage',
  'productDataBackend',
  'accountProfile',
  'profileSettings',
  'memoryGraph',
  'assetStorage',
  'productEvents',
  'userDataExport',
  'userDataDelete',
  'localFirst',
  'cloudOptional',
  'explicitUserActionRequired',
  'supportsUpload',
  'supportsSignedRead',
  'signedReadEndpoint',
  'requiresSignedInUser',
  'identityScopedStoragePath',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'safePublicStatus',
  'secretsRedacted',
  'readsCloud: false',
  'writesCloud: false',
  'cloudStatus',
  'setupTaskMatrix',
]) {
  assert.ok(route.includes(marker), `cloud status route missing marker: ${marker}`);
}

assert.doesNotMatch(
  route,
  /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/,
  'cloud status route must not serialize service role secrets.',
);
assert.doesNotMatch(
  route,
  /\/rest\/v1\//,
  'cloud status route must not read Supabase REST data.',
);

for (const marker of [
  'CloudStatusResponse',
  'cloudStatus',
  '/api/cloud/status',
  'fetchCloudStatus',
  'profileSettingsEndpoint',
  'assetStorage',
  'productDataBackend',
  'capabilityKey',
  'backendStatus',
  'requiresCloudDatabase',
  'requiresCloudStorage',
  'supportsCloudRead',
  'supportsCloudWrite',
  'anonymousAccess',
  'realDataBoundary',
  'supportsSignedRead',
]) {
  assert.ok(client.includes(marker), `app-api-client missing marker: ${marker}`);
}

assert.equal(
  pkg.scripts['test:cloud-status-runtime'],
  'node scripts/cloud-status-runtime.test.mjs',
  'package.json must expose test:cloud-status-runtime',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-status-runtime/,
  'test:contracts must include cloud status runtime test',
);

console.log('cloud status runtime contract passed');
