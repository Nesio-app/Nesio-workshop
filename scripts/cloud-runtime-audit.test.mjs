import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const profileRoute = read('app/api/cloud/profile-settings/route.ts');
const inventoryRoute = read('app/api/cloud/inventory/route.ts');
const userDataExportRoute = read('app/api/user-data/export/route.ts');
const userDataDeleteRoute = read('app/api/user-data/delete/route.ts');
const packageJson = JSON.parse(read('package.json'));

for (const [name, route] of [
  ['profile settings', profileRoute],
  ['inventory snapshot', inventoryRoute],
  ['user data export', userDataExportRoute],
  ['user data delete', userDataDeleteRoute],
]) {
  assert.match(route, /createCloudRuntimeAuditId/, `${name} route must create a per-request cloud audit id.`);
  assert.match(route, /cloud_runtime_request/, `${name} route must log redacted cloud request audit events.`);
  assert.match(route, /cloud_runtime_success/, `${name} route must log redacted cloud success audit events.`);
  assert.match(route, /cloud_runtime_failure/, `${name} route must log redacted cloud failure audit events.`);
  assert.match(route, /auditId/, `${name} route responses must include auditId for support/debug correlation.`);
  assert.match(route, /cloud_not_configured/, `${name} route must keep fail-closed cloud_not_configured responses.`);
  assert.match(route, /not_signed_in/, `${name} route must keep fail-closed not_signed_in responses.`);
  assert.doesNotMatch(
    route,
    /console\.(?:info|warn|error)\([^\n]*(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|Authorization|Bearer|apikey|serviceRoleKey|anonKey)/,
    `${name} route audit logs must not print Supabase secrets or auth headers.`,
  );
}

assert.match(profileRoute, /resource: 'profile_settings'/, 'profile route audit events must identify the profile_settings resource.');
assert.match(inventoryRoute, /resource: 'inventory_items'/, 'inventory route audit events must identify the inventory_items resource.');
assert.match(userDataExportRoute, /resource: 'user_data_export'/, 'user-data export route audit events must identify the user_data_export resource.');
assert.match(userDataDeleteRoute, /resource: 'user_data_delete'/, 'user-data delete route audit events must identify the user_data_delete resource.');
assert.match(inventoryRoute, /savedCount/, 'inventory route must continue returning savedCount on writes.');
assert.match(inventoryRoute, /rejectedCount/, 'inventory route must continue returning rejectedCount on sanitized writes.');

assert.equal(
  packageJson.scripts['test:cloud-runtime-audit'],
  'node scripts/cloud-runtime-audit.test.mjs',
  'package.json must expose cloud runtime audit test.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:cloud-runtime-audit/,
  'test:security must include cloud runtime audit coverage.',
);

console.log('cloud runtime audit tests passed');
