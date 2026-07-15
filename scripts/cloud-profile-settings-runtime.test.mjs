import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const routePath = path.join(repoRoot, 'app', 'api', 'cloud', 'profile-settings', 'route.ts');
const clientPath = path.join(repoRoot, 'lib', 'portal', 'app-api-client.ts');
const packagePath = path.join(repoRoot, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected cloud profile settings route at app/api/cloud/profile-settings/route.ts');

// Cloud 配置/鉴权已重构进共享服务端运行时(lib/portal/cloud-server-runtime),
// route 委托调用;marker 对聚合源断言(能力仍必须可达)。
const route = [
  fs.readFileSync(routePath, 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'lib', 'portal', 'cloud-server-runtime.ts'), 'utf8'),
].join('\n');
const client = fs.readFileSync(clientPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'export async function GET',
  'export async function POST',
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'baohe_auth_access',
  'baohe_auth_refresh',
  'baohe_auth_provider',
  'baohe_wechat_openid',
  'wechat_openid:',
  '/auth/v1/user',
  'grant_type=refresh_token',
  '/rest/v1/profile_settings',
  'cloud_not_configured',
  'not_signed_in',
  'cloud_read_failed',
  'cloud_write_failed',
  'safePublicStatus',
  'secretsRedacted',
  'writesCloud',
  'readsCloud',
  'setRefreshedAuthCookies',
]) {
  assert.ok(route.includes(marker), `route missing marker: ${marker}`);
}

assert.ok(
  /allowedSettingsKeys[\s\S]*displayName[\s\S]*locale[\s\S]*coachStyle[\s\S]*calendarUrl[\s\S]*observationPushEnabled/.test(route),
  'route must sanitize profile settings through an allowedSettingsKeys allowlist',
);
assert.ok(!/SERVICE_ROLE_KEY[\s\S]{0,120}NextResponse\.json/.test(route), 'route must never serialize the service role key');

// 批次203 回归:profile_settings upsert 的 on_conflict 必须 = 表的主键(identity_key)。
// 曾误设 on_conflict=user_id(user_id 无唯一约束)→ PostgREST upsert 永久报错 → 云写从不成功,
// 名字/头像/mirror 全都同步不了。锁死:on_conflict 与 schema 主键一致,且绝不是 user_id。
const schema = fs.readFileSync(path.join(repoRoot, 'database', 'schema', 'supabase-profile-settings-v1.sql'), 'utf8');
const pkCol = (schema.match(/(\w+)\s+text\s+PRIMARY KEY/i) || [, 'identity_key'])[1];
assert.equal(pkCol, 'identity_key', 'profile_settings 主键应为 identity_key');
assert.match(route, new RegExp(`on_conflict['"],\\s*['"]${pkCol}['"]`), `profile_settings upsert 的 on_conflict 必须 = 主键 ${pkCol}`);
assert.ok(!/on_conflict['"],\s*['"]user_id['"]/.test(route), 'on_conflict 不能用 user_id(非唯一键 → upsert 永久失败)');

for (const marker of [
  'CloudProfileSettings',
  'observationPushEnabled?: boolean',
  'CloudProfileSettingsResponse',
  'cloudProfileSettings',
  '/api/cloud/profile-settings',
  'fetchCloudProfileSettings',
  'saveCloudProfileSettings',
  'writesCloud',
  'readsCloud',
]) {
  assert.ok(client.includes(marker), `client missing marker: ${marker}`);
}

assert.equal(
  pkg.scripts['test:cloud-profile-settings-runtime'],
  'node scripts/cloud-profile-settings-runtime.test.mjs',
  'package.json must expose test:cloud-profile-settings-runtime',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:cloud-profile-settings-runtime/,
  'test:contracts must include cloud profile settings runtime test',
);

console.log('cloud profile settings runtime contract passed');
