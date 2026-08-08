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
const emailClientPath = path.join(root, 'lib', 'portal', 'cloud-email-sync.ts');
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
  // 前缀分流:邮件全文行(email-body:*)与普通模块行分开拉,避免海量邮件卷进模块同步
  'keyPrefix',
  'excludePrefix',
  'not.like.',
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
for (const marker of ['pushModulesToCloud', 'pullModulesFromCloud', 'autoSyncModulesWithCloud', 'gzipAsync', 'isDedicatedSyncKey', 'newlyAdded', 'reload']) {
  assert.ok(client.includes(marker), `module-sync client missing: ${marker}`);
}
// gzip 必须走 Web Worker 异步版(修「大数据同步压缩卡死主线程」)—— 绝不再用同步 gzipSync。
assert.ok(!/gzipSync\(|gunzipSync\(/.test(client), 'module-sync 不得再调用同步 gzipSync/gunzipSync(须走离主线程的 gzipAsync)');
// 增量拉取:GET 带 since 水位,只拉变过的行(修「上云后登录特别慢」)。
assert.match(client, /since=/, 'module-sync GET 用 since 增量拉取(只拉变过的行)');
// 归属排除走单一登记(sync-ownership),不再各写一份 —— 通用同步对专属引擎的 key 一律让路。
assert.match(client, /import \{[^}]*isDedicatedSyncKey[^}]*\} from '\.\/sync-ownership'/, 'module-sync 从 sync-ownership 引入归属判断');
assert.match(client, /restoreCombinedBackup\(backup, 'replace'\)/, '落地复用 restoreCombinedBackup(replace 覆盖选中 key)');
// 模块同步 GET 必须用 excludePrefix 把所有 per-record 专属引擎的行(邮件/书籍…)挡在门外
// (否则 20s 轮询下载数十 MB)。前缀集来自 sync-ownership 单一真源,新增引擎自动被排除。
assert.match(client, /excludePrefix=/, 'module-sync GET 用 excludePrefix 排除 per-record 行');
assert.ok(client.includes('DEDICATED_SYNC_PREFIXES'), 'module-sync 用 sync-ownership 的前缀集(单一真源,新增引擎自动排除)');

// 邮件全文逐封记录级同步引擎:前缀行、gz 压缩、并集补缺、喂全文索引
const emailClient = fs.readFileSync(emailClientPath, 'utf8');
for (const marker of ['pushEmailBodiesToCloud', 'pullEmailBodiesFromCloud', 'autoSyncEmailBodiesWithCloud', 'EMAIL_BODY_MODULE_PREFIX', 'getAllEmailBodies', 'putEmailBodies', 'indexEmailBodies', 'gzipAsync']) {
  assert.ok(emailClient.includes(marker), `email-sync client missing: ${marker}`);
}
assert.ok(!/gzipSync\(|gunzipSync\(/.test(emailClient), 'email-sync 不得再调用同步 gzipSync/gunzipSync(须走离主线程的 gzipAsync)');
assert.match(emailClient, /keyPrefix=/, 'email-sync GET 用 keyPrefix 只取邮件行');
assert.ok(emailClient.includes("EMAIL_BODY_MODULE_PREFIX = 'email-body:'"), 'email 行前缀 = email-body:');

// Portal 顶层触发(mount + visibility)
const portal = fs.readFileSync(portalPath, 'utf8');
assert.match(portal, /import \{ autoSyncModulesWithCloud \} from '@\/lib\/portal\/cloud-module-sync'/, 'Portal 引入模块同步');
// 数据泄露收口(P0):同步门必须在「本机数据归属」核对通过后才开 —— ownerConflict 非空时一律不同步,
// 否则换人登录时上一账号数据会按当前登录人身份上传。
assert.match(portal, /canSyncPrivateData\s*=\s*canUsePrivateRuntime\s*&&\s*ownerConflict === null/, 'Portal 同步门 = 登录 && 归属已核对(防跨账号泄露)');
assert.match(portal, /autoSyncModulesWithCloud/, 'Portal 同步批次含模块同步');
assert.match(portal, /canSyncPrivateData\)\s*return;[\s\S]*?runCloudSyncBatch\(CLOUD_SYNC_TASKS\)/, 'Portal 归属核对通过后才触发同步批次(含模块同步)');
// 重同步批次改经 whenIdle 调度 + isCloudSyncSuspended 闸门(修「同步抢主线程 = 跟练卡死」),
// mount 与回前台都路由到 scheduleHeavySyncBatch,不再在交互帧同步直呼各引擎。
assert.match(portal, /if\s*\(\s*isCloudSyncSuspended\(\)\s*\)\s*\{?\s*return/, 'Portal 重同步批次受暂停闸门早退');
assert.match(portal, /whenIdle\(/, 'Portal 重同步经 whenIdle 空闲调度(不抢交互帧)');
assert.match(portal, /visibilityState === 'visible'[\s\S]{0,160}scheduleHeavySyncBatch\(\)/, 'Portal 回前台经空闲批次触发同步');
// 邮件全文同步也在同步批次内(mount + 回前台经批次触发)
assert.match(portal, /import \{ autoSyncEmailBodiesWithCloud \} from '@\/lib\/portal\/cloud-email-sync'/, 'Portal 引入邮件全文同步');
assert.match(portal, /autoSyncEmailBodiesWithCloud\(\)/, 'Portal 同步批次含邮件全文同步');

// package.json 注册
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert.equal(pkg.scripts['test:cloud-module-data-runtime'], 'node scripts/cloud-module-data-runtime.test.mjs', 'package.json 暴露 test:cloud-module-data-runtime');
assert.match(pkg.scripts['test:contracts'], /test:cloud-module-data-runtime/, 'test:contracts 含 module-data 路由测试');
assert.match(pkg.scripts['test:contracts'], /test:cloud-module-sync/, 'test:contracts 含 module-sync 引擎测试');
assert.equal(pkg.scripts['test:cloud-email-sync'], 'node scripts/cloud-email-sync.test.mjs', 'package.json 暴露 test:cloud-email-sync');
assert.match(pkg.scripts['test:contracts'], /test:cloud-email-sync/, 'test:contracts 含 email-sync 引擎测试');

console.log('cloud-module-data runtime contract passed');
