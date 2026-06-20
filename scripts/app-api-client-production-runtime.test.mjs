import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'portal', 'app-api-client.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  'ProductionRuntimeHealthResponse',
  'AuthStartProvider',
  'AuthStartResponse',
  'fetchProductionRuntimeHealth',
  'startAuth',
]) {
  assert.ok(source.includes(marker), `missing production runtime client marker: ${marker}`);
}

for (const endpoint of ['/api/portal/production/health', '/api/auth/start']) {
  assert.ok(source.includes(endpoint), `missing production runtime endpoint: ${endpoint}`);
}

assert.ok(source.includes('safePublicStatus'), 'production runtime client must model safe public status');
assert.ok(source.includes('secretsRedacted'), 'production runtime client must model secret redaction');
assert.ok(source.includes('provider_not_configured'), 'auth client must preserve fail-closed auth errors for UI display');

assert.equal(
  packageJson.scripts['test:app-api-client-production-runtime'],
  'node scripts/app-api-client-production-runtime.test.mjs',
  'package.json must expose the app API client production runtime test',
);

console.log('App API client production runtime tests passed');
