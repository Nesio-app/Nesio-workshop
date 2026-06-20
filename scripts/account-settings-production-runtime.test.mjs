import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'components', 'portal', 'AccountSettings.tsx'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  'createAppApiClient',
  'fetchProductionRuntimeHealth',
  'providerActionMatrix',
  'providerActionsById',
  'formatProviderActionStatus',
  'formatProviderActionDetail',
  'onOpenProviderAction',
  'portal-settings-provider-action',
  'fetchAuthSession',
  'fetchCloudProfileSettings',
  'saveCloudProfileSettings',
  'startAuth',
  'logoutAuth',
  'runtimeStatus',
  'authSession',
  'cloudProfileStatus',
  'syncCloudProfileSettings',
  'authFeedback',
  'authEmail',
  'authPhone',
  'onInspectServerProviderAction',
  'formatProviderActionButtonLabel',
  'isProviderActionDisabled',
]) {
  assert.ok(source.includes(marker), `AccountSettings must wire production runtime marker: ${marker}`);
}

for (const provider of ['email', 'google', 'wechat', 'phone']) {
  assert.ok(source.includes(`onStartAuth('${provider}')`), `AccountSettings must expose ${provider} auth start`);
}

for (const providerId of ['email', 'google', 'wechat', 'phone', 'cloud_database', 'cloud_storage', 'gemini', 'google_calendar', 'flomo']) {
  assert.ok(source.includes(`providerActionsById.${providerId}`), `AccountSettings must consume provider action matrix for ${providerId}`);
}

for (const label of ['Gemini', 'Google Calendar', 'Cloud DB', 'Email', 'Google', 'WeChat', 'Phone']) {
  assert.ok(source.includes(label), `AccountSettings must display production status label: ${label}`);
}

assert.ok(source.includes('provider_not_configured'), 'AccountSettings must surface fail-closed auth errors');
assert.ok(source.includes('window.location.assign'), 'OAuth auth start must be able to navigate to redirect URL');
assert.ok(source.includes('window.location.href = provider.startEndpoint'), 'Provider action rows must be able to navigate to real runtime endpoints');
assert.ok(source.includes('provider.serverOnly'), 'Provider action rows must distinguish server-only capabilities');
assert.ok(source.includes('onInspectServerProviderAction(provider)'), 'Server-only provider actions must be clickable diagnostics, not disabled dead buttons');
assert.ok(!source.includes(`disabled={!row.provider || row.provider.serverOnly || row.provider.actionStatus !== 'ready'}`), 'Server-only provider action buttons must not be disabled just because they are server-only');
assert.ok(source.includes("provider.actionStatus !== 'ready' && provider.actionStatus !== 'server_ready'"), 'Provider action rows must only disable when runtime is neither ready nor server_ready');
assert.ok(source.includes('disabled={isProviderActionDisabled(row.provider)}'), 'Provider action row disabled state must use shared ready/server_ready resolver');
assert.ok(source.includes('authSession?.loggedIn'), 'AccountSettings must display real session login status');
assert.ok(source.includes('onLogoutAuth'), 'AccountSettings must expose a logout action');
assert.ok(source.includes('saveProfileSettings(nextProfile)'), 'AccountSettings must persist merged cloud profile settings locally');
assert.ok(source.includes('await client.saveCloudProfileSettings'), 'AccountSettings must write profile edits to cloud profile settings');
assert.ok(source.includes("setCloudProfileStatus('local_only')"), 'AccountSettings must fall back to local-only when cloud profile sync is unavailable');
assert.ok(source.includes("setCloudProfileStatus('synced')"), 'AccountSettings must surface synced cloud profile state');
assert.match(source, /catch[\s\S]*setCloudProfileStatus\('local_only'\)/, 'Cloud profile failures must not block local settings');
assert.ok(source.includes('退出登录'), 'AccountSettings must render a logout button label');
assert.ok(!source.includes('disabled={!authSession?.loggedIn}'), 'Logout must remain clickable so signed-out users get immediate local feedback');
assert.ok(source.includes('当前未登录，无需退出。'), 'Logout must explain locally when the user is already signed out');
assert.match(source, /type="email"/, 'AccountSettings must provide an email input before starting email auth');
assert.match(source, /type="tel"/, 'AccountSettings must provide a phone input before starting phone auth');
assert.ok(source.includes('email: authEmail.trim()'), 'AccountSettings must send the email value to auth start');
assert.ok(source.includes('phone: authPhone.trim()'), 'AccountSettings must send the phone value to auth start');

assert.equal(
  packageJson.scripts['test:account-settings-production-runtime'],
  'node scripts/account-settings-production-runtime.test.mjs',
  'package.json must expose AccountSettings production runtime test',
);

console.log('AccountSettings production runtime tests passed');
