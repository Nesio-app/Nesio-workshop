import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'cloud', 'memory', 'route.ts');
const clientPath = path.join(root, 'lib', 'portal', 'app-api-client.ts');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected cloud memory route at app/api/cloud/memory/route.ts');

// Cloud 配置/鉴权已重构进共享服务端运行时(lib/portal/cloud-server-runtime),
// route 委托调用;marker 对聚合源断言(能力仍必须可达)。
const route = [
  fs.readFileSync(routePath, 'utf8'),
  fs.readFileSync(path.join(root, 'lib', 'portal', 'cloud-server-runtime.ts'), 'utf8'),
].join('\n');
const client = fs.readFileSync(clientPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'export async function GET',
  'export async function POST',
  'export async function DELETE',
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
  '/rest/v1/memory_nodes',
  'cloud_not_configured',
  'not_signed_in',
  'cloud_read_failed',
  'cloud_write_failed',
  'invalid_json',
  'safePublicStatus',
  'secretsRedacted',
  'readsCloud',
  'writesCloud',
  'cloudMemorySnapshot',
  'LifeNode@v1',
  'setRefreshedAuthCookies',
]) {
  assert.ok(route.includes(marker), `cloud memory route missing marker: ${marker}`);
}

assert.ok(
  /allowedMemoryNodeKeys[\s\S]*id[\s\S]*type[\s\S]*name[\s\S]*attributes[\s\S]*source[\s\S]*relations[\s\S]*tags[\s\S]*rawInput/.test(route),
  'route must sanitize memory nodes through an allowedMemoryNodeKeys allowlist',
);
assert.ok(route.includes('deleteAll === true'), 'cloud memory route must support explicit delete-all with confirmation.');
assert.ok(route.includes('exportOnly === true'), 'cloud memory route must support export-only reads.');
assert.ok(route.includes('source !=='), 'cloud memory route must validate source/type boundaries.');
assert.ok(!/SERVICE_ROLE_KEY[\s\S]{0,180}NextResponse\.json/.test(route), 'route must never serialize service role secrets.');

for (const marker of [
  'CloudMemorySnapshotResponse',
  'cloudMemory',
  '/api/cloud/memory',
  'fetchCloudMemorySnapshot',
  'saveCloudMemorySnapshot',
  'deleteCloudMemorySnapshot',
  'writesCloud',
  'readsCloud',
]) {
  assert.ok(client.includes(marker), `app-api-client missing marker: ${marker}`);
}

assert.equal(
  pkg.scripts['test:cloud-memory-runtime'],
  'node scripts/cloud-memory-runtime.test.mjs',
  'package.json must expose test:cloud-memory-runtime',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-memory-runtime/,
  'test:contracts must include cloud memory runtime test',
);

console.log('cloud memory runtime contract passed');
