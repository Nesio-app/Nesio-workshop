import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'portal', 'app-api-client.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  'ProductionRuntimeHealthResponse',
  'AuthStartProvider',
  'AuthStartResponse',
  'AuthSessionResponse',
  'AuthLogoutResponse',
  'SecretaryChatProvider',
  'SecretaryChatResponse',
  'fetchProductionRuntimeHealth',
  'startAuth',
  'fetchAuthSession',
  'logoutAuth',
  'sendSecretaryMessage',
]) {
  assert.ok(source.includes(marker), `missing production runtime client marker: ${marker}`);
}

for (const endpoint of ['/api/portal/production/health', '/api/auth/start', '/api/auth/session', '/api/auth/logout', '/api/secretary/chat']) {
  assert.ok(source.includes(endpoint), `missing production runtime endpoint: ${endpoint}`);
}

assert.ok(source.includes('safePublicStatus'), 'production runtime client must model safe public status');
assert.ok(source.includes('secretsRedacted'), 'production runtime client must model secret redaction');
assert.ok(source.includes('provider_not_configured'), 'auth client must preserve fail-closed auth errors for UI display');
assert.ok(source.includes('loggedIn'), 'auth session client must expose loggedIn status');
assert.ok(source.includes('signedOut'), 'auth logout client must expose signedOut status');
assert.ok(source.includes("method: 'POST'"), 'auth logout client must use POST');
assert.ok(source.includes("provider: SecretaryChatProvider"), 'secretary chat client must require a typed provider');
assert.ok(source.includes("'x-baohe-access-mode'"), 'secretary chat client must preserve personal lab access header');
assert.ok(source.includes('maxTokens'), 'secretary chat client must support bounded output length');

assert.equal(
  packageJson.scripts['test:app-api-client-production-runtime'],
  'node scripts/app-api-client-production-runtime.test.mjs',
  'package.json must expose the app API client production runtime test',
);

console.log('App API client production runtime tests passed');
