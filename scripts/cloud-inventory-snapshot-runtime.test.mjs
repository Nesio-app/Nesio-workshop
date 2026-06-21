import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'cloud', 'inventory', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected cloud inventory snapshot route at app/api/cloud/inventory/route.ts');

const route = fs.readFileSync(routePath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'export async function GET',
  'export async function POST',
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'baohe_auth_provider',
  'baohe_wechat_openid',
  'wechat_openid:',
  '/auth/v1/user',
  'grant_type=refresh_token',
  '/rest/v1/inventory_items',
  'cloud_not_configured',
  'not_signed_in',
  'cloud_read_failed',
  'cloud_write_failed',
  'safePublicStatus',
  'secretsRedacted',
  'readsCloud',
  'writesCloud',
  'cloudInventorySnapshot',
  'LocalInventoryItem@v1',
  'setRefreshedAuthCookies',
]) {
  assert.ok(route.includes(marker), `cloud inventory route missing marker: ${marker}`);
}

assert.ok(
  /allowedInventoryItemKeys[\s\S]*id[\s\S]*name[\s\S]*category[\s\S]*locationHint[\s\S]*purchaseMemory[\s\S]*mode/.test(route),
  'route must sanitize inventory items through an allowedInventoryItemKeys allowlist',
);
for (const forbidden of ['paymentMethod', 'receiptImport', 'bankAccount', 'cardLast4', 'financialAdvice']) {
  assert.ok(route.includes(forbidden), `route must explicitly reject forbidden purchaseMemory field ${forbidden}`);
}
assert.ok(route.includes("mode !== 'personal'"), 'cloud inventory route must reject demo or unknown modes.');
assert.ok(route.includes('on_conflict'), 'cloud inventory writes must upsert by user and local id.');
assert.ok(route.includes('deleteMissing === true'), 'cloud inventory route must support explicit delete-missing cloud snapshot cleanup.');
assert.ok(!/SERVICE_ROLE_KEY[\s\S]{0,160}NextResponse\.json/.test(route), 'route must never serialize service role secrets.');

for (const marker of [
  'CloudInventorySnapshotResponse',
  'cloudInventory',
  '/api/cloud/inventory',
  'fetchCloudInventorySnapshot',
  'saveCloudInventorySnapshot',
  'writesCloud',
  'readsCloud',
]) {
  assert.ok(client.includes(marker), `app-api-client missing marker: ${marker}`);
}

assert.equal(
  pkg.scripts['test:cloud-inventory-snapshot-runtime'],
  'node scripts/cloud-inventory-snapshot-runtime.test.mjs',
  'package.json must expose test:cloud-inventory-snapshot-runtime',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-inventory-snapshot-runtime/,
  'test:contracts must include cloud inventory snapshot runtime test',
);

console.log('cloud inventory snapshot runtime contract passed');
