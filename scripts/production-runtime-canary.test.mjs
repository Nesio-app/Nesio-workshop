import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'production-runtime-canary.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

for (const marker of [
  '/api/portal/production/health',
  '/api/auth/start',
  '/secretary',
  '/api/secretary/chat',
  'provider_not_configured',
  'first_launch_gated',
  '宝盒Gemini在线',
  'html_or_non_json_response',
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
