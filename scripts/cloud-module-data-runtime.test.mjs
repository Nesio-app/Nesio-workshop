/**
 * 行为契约:记录级模块同步路由 /api/cloud/module-data。
 * 锁死:GET 拉本账号全部模块行、POST upsert(on_conflict identity_key,module_key)、门禁 + 鉴权、
 * 单模块体积上限、绝不外泄 service role/Authorization。表 schema 存在且进 schema 束。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'app', 'api', 'cloud', 'module-data', 'route.ts');
const schemaPath = path.join(root, 'database', 'schema', 'supabase-user-module-data-v1.sql');
const clientPath = path.join(root, 'lib', 'portal', 'cloud-module-sync.ts');
const portalPath = path.join(root, 'components', 'portal', 'Portal.tsx');
const packagePath = path.join(root, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected route at app/api/cloud/module-data/route.ts');
assert.ok(fs.existsSync(schemaPath), 'expected schema at database/schema/supabase-user-module-data-v1.sql');

const route = [
  fs.readFileSync(routePath, 'utf8'),
  fs.readFileSync(path.join(root, 'lib', 'portal', 'cloud-server-runtime.ts'), 'utf8'),
].join('\n');

for (const marker of [
  'export async function GET',
  'export async function POST',
  '/rest/v1/user_module_data',
  'on_conflict',
  'identity_key,module_key',
  'module_key',
  'getSignedInUser',
  'deriveCloudIdentity',
  'not_signed_in',
  'cloud_not_configured',
  'MAX_DATA_BYTES',
  'setRefreshedAuthCookies',
  'safePublicStatus',
]) {
  assert.ok(route.includes(marker), `module-data route missing marker: ${marker}`);
}

// 绝不外泄 service role / Authorization 到响应体
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,180}NextResponse\.json/, 'must never serialize service role');
assert.doesNotMatch(route, /Authorization[\s\S]{0,120}NextResponse\.json/, 'must never serialize Authorization');

// schema:表 + RLS + 主键
const schema = fs.readFileSync(schemaPath, 'utf8');
for (const marker of ['CREATE TABLE', 'user_module_data', 'PRIMARY KEY (identity_key, module_key)', 'ROW LEVEL SECURITY', 'auth.uid() = user_id']) {
  assert.ok(schema.includes(marker), `schema missing: ${marker}`);
}

// 客户端引擎:逐模块行、gz 压缩、排除记忆图、LWW、新设备 reload
const client = fs.readFileSync(clientPath, 'utf8');
for (const marker of ['pushModulesToCloud', 'pullModulesFromCloud', 'autoSyncModulesWithCloud', 'gzipSync', 'LIFE_GRAPH_KEY', 'newlyAdded', 'reload']) {
  assert.ok(client.includes(marker), `module-sync client missing: ${marker}`);
}
assert.match(client, /restoreCombinedBackup\(backup, 'replace'\)/, '落地复用 restoreCombinedBackup(replace 覆盖选中 key)');

// Portal 顶层触发(mount + visibility)
const portal = fs.readFileSync(portalPath, 'utf8');
assert.match(portal, /import \{ autoSyncModulesWithCloud \} from '@\/lib\/portal\/cloud-module-sync'/, 'Portal 引入模块同步');
assert.match(portal, /canUsePrivateRuntime\)\s*return;[\s\S]*?autoSyncModulesWithCloud\(\)/, 'Portal 登录后触发模块同步');
assert.match(portal, /visibilityState === 'visible'[\s\S]{0,320}autoSyncModulesWithCloud\(\)/, 'Portal 回前台也触发模块同步');

// package.json 注册
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert.equal(pkg.scripts['test:cloud-module-data-runtime'], 'node scripts/cloud-module-data-runtime.test.mjs', 'package.json 暴露 test:cloud-module-data-runtime');
assert.match(pkg.scripts['test:contracts'], /test:cloud-module-data-runtime/, 'test:contracts 含 module-data 路由测试');
assert.match(pkg.scripts['test:contracts'], /test:cloud-module-sync/, 'test:contracts 含 module-sync 引擎测试');

console.log('cloud-module-data runtime contract passed');
