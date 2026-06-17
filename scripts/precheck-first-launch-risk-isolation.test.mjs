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

for (const id of ['secretary', 'quiz', 'psychoanalysis', 'sanctuary', 'health', 'finance', 'lifesim']) {
  assert.match(launchSafety, new RegExp(`['"]${id}['"]`), `${id} must be launch-gated`);
  const tool = portalConfig.tools.find((item) => item.id === id);
  assert.equal(tool?.ready, false, `${id} must not be ready in first-launch config`);
  assert.equal(tool?.status, 'gated', `${id} must be marked gated in first-launch config`);
}

for (const path of [
  '/secretary',
  '/inner-shelter',
  '/health',
  '/api/secretary',
  '/api/inner-shelter',
  '/api/adhd-flow',
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

const secretaryRoute = read('app/api/secretary/chat/route.ts');
assert.match(secretaryRoute, /launchUnavailablePayload\('api:secretary:chat'/, 'secretary chat must fail closed before provider calls');

const innerShelterRoute = readIfExists('app/api/inner-shelter/chat/route.ts');
if (innerShelterRoute) {
  assert.match(innerShelterRoute, /launchUnavailablePayload\('api:inner-shelter:chat'/, 'inner-shelter chat must fail closed before provider calls');
}

for (const path of ['public/adhd-flow/app.js', 'adhd-flow-ios/web/app.js']) {
  const source = read(path);
  assert.match(source, /FIRST_LAUNCH_EXTERNAL_AUTH_ENABLED\s*=\s*false/, `${path} must disable external auth`);
  assert.doesNotMatch(source, /window\.open\(makeGCalURL/, `${path} must not open Google Calendar`);
  assert.match(source, /FIRST_LAUNCH_AI_ENABLED\s*=\s*false/, `${path} must disable AI runtime`);
}

for (const path of ['public/fitness/app.js', 'fitness/web/app.js']) {
  const source = read(path);
  assert.match(source, /FIRST_LAUNCH_AI_ENABLED\s*=\s*false/, `${path} must disable fitness AI runtime`);
  assert.doesNotMatch(source, /fetch\(apiBase\+'\/api\/fitness\/chat'/, `${path} must not call fitness chat API`);
}

const storageConfig = read('public/storage/config.js');
assert.doesNotMatch(storageConfig, /storage-kohl\.vercel\.app/, 'storage default external API must be disconnected');
const storageSourceConfig = read('storage-web/config.js');
assert.doesNotMatch(storageSourceConfig, /storage-kohl\.vercel\.app/, 'storage source default external API must be disconnected');

const storageApp = read('public/storage/app.js');
assert.match(storageApp, /FIRST_LAUNCH_IMAGE_AI_ENABLED\s*=\s*false/, 'storage image AI must be disabled');
assert.match(storageApp, /if \(!FIRST_LAUNCH_IMAGE_AI_ENABLED\) \{[\s\S]*?return;[\s\S]*?\}/, 'storage image AI must return before external identify API');

const storageSourceApp = read('storage-web/app.js');
assert.match(storageSourceApp, /FIRST_LAUNCH_IMAGE_AI_ENABLED\s*=\s*false/, 'storage source image AI must be disabled');
assert.match(storageSourceApp, /if \(!FIRST_LAUNCH_IMAGE_AI_ENABLED\) \{[\s\S]*?return;[\s\S]*?\}/, 'storage source image AI must return before external identify API');

const storageGuard = read('public/storage/guard.js');
assert.match(storageGuard, /FIRST_LAUNCH_NOTIFICATIONS_ENABLED\s*=\s*false/, 'runtime notifications must be disabled');
assert.match(storageGuard, /if \(!FIRST_LAUNCH_NOTIFICATIONS_ENABLED\) return;/, 'notification permission prompt must be gated before request');

const storageSourceGuard = read('storage-web/guard.js');
assert.match(storageSourceGuard, /FIRST_LAUNCH_NOTIFICATIONS_ENABLED\s*=\s*false/, 'runtime source notifications must be disabled');
assert.match(storageSourceGuard, /if \(!FIRST_LAUNCH_NOTIFICATIONS_ENABLED\) return;/, 'source notification permission prompt must be gated before request');

console.log('PASS first launch high-risk runtime isolation precheck');
