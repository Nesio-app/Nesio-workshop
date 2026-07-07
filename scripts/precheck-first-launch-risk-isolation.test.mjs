import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function readIfExists(path) {
  const absolutePath = join(repoRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
}

const launchSafety = read('lib/portal/launch-safety.ts');
const middleware = read('middleware.ts');
const portalConfig = JSON.parse(read('public/portal-config.json'));

for (const id of ['quiz', 'psychoanalysis', 'sanctuary', 'health', 'finance', 'lifesim']) {
  assert.match(launchSafety, new RegExp(`['"]${id}['"]`), `${id} must be launch-gated`);
  const tool = portalConfig.tools.find((item) => item.id === id);
  assert.equal(tool?.ready, false, `${id} must not be ready in first-launch config`);
  assert.equal(tool?.status, 'gated', `${id} must be marked gated in first-launch config`);
}

for (const path of [
  '/inner-shelter',
  '/health',
  '/api/inner-shelter',
  '/api/fitness',
  '/api/identify',
  '/api/payments',
  '/api/storekit',
  '/api/subscriptions',
]) {
  assert.match(launchSafety, new RegExp(`['"]${path.replaceAll('/', '\\/')}['"]`), `${path} must be listed`);
}

assert.match(middleware, /isFirstLaunchBlockedPath/, 'middleware must use launch path gate');
assert.match(middleware, /launchUnavailablePayload/, 'middleware must emit launch-gated payload');

const innerShelterRoute = readIfExists('app/api/inner-shelter/chat/route.ts');
if (innerShelterRoute) {
  assert.match(innerShelterRoute, /launchUnavailablePayload\('api:inner-shelter:chat'/, 'inner-shelter chat must fail closed before provider calls');
}


for (const path of ['public/fitness/app.js', 'fitness/web/app.js']) {
  const source = path.startsWith('public/') ? readIfExists(path) : read(path);
  if (!source) continue;
  assert.match(source, /FIRST_LAUNCH_AI_ENABLED\s*=\s*false/, `${path} must disable fitness AI runtime`);
  assert.doesNotMatch(source, /fetch\(apiBase\+'\/api\/fitness\/chat'/, `${path} must not call fitness chat API`);
}

// 静态 /storage/ 收纳 app 已解绑(原生收纳走 life-graph,无独立外部 API/图像 AI/通知运行时)
assert.equal(existsSync(join(repoRoot, 'public', 'storage')), false, 'public/storage must stay removed');
assert.equal(existsSync(join(repoRoot, 'storage-web')), false, 'storage-web must stay removed');

console.log('PASS first launch high-risk runtime isolation precheck');
