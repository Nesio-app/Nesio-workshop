import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'production-runtime-canary.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  '/api/portal/production/health',
  'fetchHeaders',
  'canonical domain is routed to the Vercel/Next runtime',
  'dns_or_runtime_mismatch',
  '/api/portal/production/activation-checklist',
  '/api/cloud/status',
  '/api/cloud/inventory',
  '/api/cloud/profile-settings',
  '/api/modules',
  '/api/inventory',
  '/api/entitlements',
  '/api/user-data/export',
  '/api/user-data/delete',
  '/api/auth/start',
  '/api/auth/session',
  '/api/auth/logout',
  '/api/auth/callback',
  '/api/portal/calendar/connect',
  '/api/portal/flomo',
  '/api/portal/flomo/upload',
  '/secretary',
  '/secretary/index.html',
  '/secretary/chat.html',
  '/secretary/friends.json',
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
  'Flomo upload endpoint returns safe JSON',
  'Flomo upload validates missing file without calling upload host',
  'email auth start is wired and validates input or fails closed',
  'email auth start dry-run accepts a real email payload without sending OTP',
  'wechat auth start either redirects when configured or fails closed',
  'phone auth start is wired and validates input or fails closed',
  'phone auth start dry-run accepts a real phone payload without sending OTP',
  'fetchText',
  '宝盒Gemini在线',
  'html_or_non_json_response',
  'Secretary page direct URL is publicly available as the production AI friends surface',
  'Secretary page does not expose the removed old bottom nav or local-draft helper copy',
  'Secretary friends catalog exposes connected AI options for the production AI friends surface',
  'Secretary static deep link is served through the production AI friends surface',
  'Secretary static deep link has no removed controls',
  'cloud status endpoint returns 2xx',
  'production activation checklist endpoint returns 2xx',
  'production activation checklist redacts secrets and is safe public status',
  'production activation checklist reports account cloud AI and third party readiness',
  'cloud status reports safe read-only diagnostics',
  'cloud inventory snapshot endpoint returns safe JSON',
  'cloud inventory snapshot is ready or fails closed with a clear reason',
  'cloud profile settings endpoint returns safe JSON',
  'cloud profile settings is ready or fails closed with a clear reason',
  'modules endpoint returns core Shell and launch module contract',
  'inventory endpoint returns demo inventory without personal data reads',
  'entitlements endpoint returns local active Shell and Inventory entitlements',
  'user data export endpoint returns local contract JSON',
  'user data export does not include real user data',
  'user data delete endpoint returns dry-run local contract JSON',
  'user data delete does not delete real or cloud data',
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
