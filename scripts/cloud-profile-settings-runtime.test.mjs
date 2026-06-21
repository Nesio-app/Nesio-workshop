import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const routePath = path.join(repoRoot, 'app', 'api', 'cloud', 'profile-settings', 'route.ts');
const clientPath = path.join(repoRoot, 'lib', 'portal', 'app-api-client.ts');
const packagePath = path.join(repoRoot, 'package.json');

assert.ok(fs.existsSync(routePath), 'expected cloud profile settings route at app/api/cloud/profile-settings/route.ts');

const route = fs.readFileSync(routePath, 'utf8');
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
