import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'components', 'portal', 'AccountSettings.tsx'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  'createAppApiClient',
  'fetchProductionRuntimeHealth',
  'startAuth',
  'runtimeStatus',
  'authFeedback',
  'authEmail',
  'authPhone',
]) {
  assert.ok(source.includes(marker), `AccountSettings must wire production runtime marker: ${marker}`);
}

for (const provider of ['email', 'google', 'wechat', 'phone']) {
  assert.ok(source.includes(`onStartAuth('${provider}')`), `AccountSettings must expose ${provider} auth start`);
}

for (const label of ['Gemini', 'Google Calendar', 'Cloud DB', 'Email', 'Google', 'WeChat', 'Phone']) {
  assert.ok(source.includes(label), `AccountSettings must display production status label: ${label}`);
}

assert.ok(source.includes('provider_not_configured'), 'AccountSettings must surface fail-closed auth errors');
assert.ok(source.includes('window.location.assign'), 'OAuth auth start must be able to navigate to redirect URL');
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
