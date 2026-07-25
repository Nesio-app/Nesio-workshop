import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'cloud', 'assets', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const packagePath = path.join(root, 'package.json');
const statusPath = path.join(root, 'app', 'api', 'cloud', 'status', 'route.ts');

assert.ok(fs.existsSync(routePath), 'expected cloud assets route at app/api/cloud/assets/route.ts');

// Cloud 配置/鉴权已重构进共享服务端运行时(lib/portal/cloud-server-runtime),
// route 委托调用;marker 对聚合源断言(能力仍必须可达)。
const route = [
  fs.readFileSync(routePath, 'utf8'),
  fs.readFileSync(path.join(root, 'lib', 'portal', 'cloud-server-runtime.ts'), 'utf8'),
].join('\n');
const client = fs.readFileSync(clientPath, 'utf8');
const statusRoute = fs.readFileSync(statusPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'export async function POST',
  'export async function GET',
  'CLOUD_STORAGE_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'baohe_auth_provider',
  'baohe_wechat_openid',
  'wechat_openid:',
  '/auth/v1/user',
  'grant_type=refresh_token',
  '/storage/v1/object/',
  '/storage/v1/object/sign/',
  'deriveCloudIdentity',
  'FormData',
  'File',
  'MAX_UPLOAD_BYTES',
  'allowedAssetMimeTypes',
  'cloud_storage_not_configured',
  'not_signed_in',
  'invalid_form_data',
  'unsupported_file_type',
  'file_too_large',
  'cloud_asset_upload_failed',
  'missing_storage_path',
  'forbidden_storage_path',
  'cloud_asset_read_failed',
  'isStoragePathOwnedByIdentity',
  'safePublicStatus',
  'secretsRedacted',
  'cloudAssetUpload',
  'cloudAssetRead',
  'storagePath',
  'signedUrl',
  'requiresSignedUrl',
  'expiresIn',
  'setRefreshedAuthCookies',
  // 「按账号找最新备份」GET 模式(跨浏览器同步命门):列出 {identity}/backup/、回最新那份签名 URL
  'cloudBackupList',
  'pickLatestBackupObject',
  'listStorageObjects',
  '/storage/v1/object/list/',
]) {
  assert.ok(route.includes(marker), `cloud assets route missing marker: ${marker}`);
}

assert.doesNotMatch(
  route,
  /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,180}NextResponse\.json/,
  'cloud assets route must never serialize service role secrets.',
);
assert.doesNotMatch(
  route,
  /Authorization[\s\S]{0,120}NextResponse\.json/,
  'cloud assets route must never serialize Authorization headers.',
);
assert.doesNotMatch(
  route,
  /object\/public/,
  'cloud assets upload route must not generate public object URLs for private product data.',
);
assert.doesNotMatch(
  route,
  /assetUrl/,
  'cloud assets upload route must not return public assetUrl; callers must use signed URL reads.',
);

for (const marker of [
  'CloudAssetUploadResponse',
  'CloudAssetReadResponse',
  'cloudAssets',
  '/api/cloud/assets',
  'uploadCloudAsset',
  'fetchCloudAssetReadUrl',
  'storagePath',
  'requiresSignedUrl',
]) {
  assert.ok(client.includes(marker), `app-api-client missing marker: ${marker}`);
}
assert.ok(statusRoute.includes("assetsEndpoint: '/api/cloud/assets'"), 'cloud status must expose the cloud assets endpoint.');
assert.equal(
  pkg.scripts['test:cloud-assets-runtime'],
  'node scripts/cloud-assets-runtime.test.mjs',
  'package.json must expose test:cloud-assets-runtime',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-assets-runtime/,
  'test:contracts must include cloud assets runtime test',
);

console.log('cloud assets runtime contract passed');
