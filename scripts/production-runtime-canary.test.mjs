import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'production-runtime-canary.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  '/api/portal/production/health',
  '/api/cloud/status',
  '/api/cloud/inventory',
  '/api/cloud/profile-settings',
  '/api/auth/start',
  '/api/auth/session',
  '/api/auth/logout',
  '/api/auth/callback',
  '/api/portal/calendar/connect',
  '/api/portal/flomo',
  '/secretary',
  '/secretary/index.html',
  '/secretary/chat.html',
  '/api/secretary/chat',
  'provider_not_configured',
  'authProviderCanaryMatrix',
  'auth session endpoint returns safe JSON',
  'auth session reports signed-out state without exposing secrets',
  'auth logout endpoint returns safe JSON',
  'auth logout is idempotent for signed-out users',
  'auth callback without code redirects safely',
  'callback_received',
  'Google Calendar connect either redirects when configured or fails closed',
  'Flomo capture endpoint returns safe JSON',
  'Flomo capture validates empty content or fails closed',
  'email auth start is wired and validates input or fails closed',
  'wechat auth start either redirects when configured or fails closed',
  'phone auth start is wired and validates input or fails closed',
  'first_launch_gated',
  '宝盒Gemini在线',
  'html_or_non_json_response',
  'Secretary static deep link is not publicly served',
  'cloud status endpoint returns 2xx',
  'cloud status reports safe read-only diagnostics',
  'cloud inventory snapshot endpoint returns safe JSON',
  'cloud inventory snapshot is ready or fails closed with a clear reason',
  'cloud profile settings endpoint returns safe JSON',
  'cloud profile settings is ready or fails closed with a clear reason',
  'profileSettingsEndpoint',
  'inventoryEndpoint',
  'baseUrl',
  'rawPreview',
]) {
  assert.ok(source.includes(marker), `missing production canary marker: ${marker}`);
}

assert.ok(source.includes('execFileAsync'), 'production canary must perform real HTTP checks through a system command');
assert.ok(source.includes('curl'), 'production canary should use curl for stable Vercel canary networking');
assert.ok(source.includes('catch'), 'production canary must turn network failures into readable failures');
assert.ok(source.includes('process.exitCode = 1'), 'production canary must fail CI on broken checks');

assert.equal(
  packageJson.scripts['canary:production-runtime'],
  'node scripts/production-runtime-canary.mjs',
  'package.json must expose production runtime canary',
);
assert.equal(
  packageJson.scripts['test:production-runtime-canary'],
  'node scripts/production-runtime-canary.test.mjs',
  'package.json must expose production runtime canary test',
);

console.log('production runtime canary tests passed');
