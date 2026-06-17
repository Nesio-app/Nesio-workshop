import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iosRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(iosRoot, '..');
const www = join(iosRoot, 'www');

function read(path) {
  return readFileSync(join(iosRoot, path), 'utf8');
}

assert.ok(existsSync(join(www, 'index.html')), 'www/index.html must exist');
assert.ok(existsSync(join(www, 'storage', 'index.html')), 'www/storage/index.html must exist');
assert.ok(existsSync(join(www, 'portal-config.json')), 'www/portal-config.json must exist');
assert.ok(existsSync(join(www, 'icons', 'treasurebox-pwa-512.png')), 'app icon asset must be copied into www');
assert.equal(existsSync(join(www, 'adhd-flow', 'index.html')), false, 'ADHD Flow must not be copied into first-launch iOS bundle');
assert.equal(existsSync(join(www, 'fitness', 'index.html')), false, 'Fitness must not be copied into first-launch iOS bundle');
assert.equal(existsSync(join(www, 'reading', 'index.html')), false, 'Reading must not be copied into first-launch iOS bundle');

const index = read('www/index.html');
assert.match(index, /宝盒/, 'iOS shell must render Baohe brand');
assert.match(index, /viewport-fit=cover/, 'iOS shell must use mobile safe-area viewport');
assert.match(index, /href="storage\/index\.html"/, 'iOS shell must link to Inventory flow');
assert.match(index, /data-module-id="inventory"/, 'Inventory card must be present');
assert.match(index, /data-status="gated"/, 'gated future modules must be visible as unavailable');
assert.doesNotMatch(index, /https:\/\/[^"']+\.vercel\.app/, 'iOS shell must not embed production module URLs');
assert.doesNotMatch(index, /StoreKit|purchase|payment/i, 'iOS shell must not expose payment runtime');

const iosPortalConfig = read('www/portal-config.json');
assert.doesNotMatch(iosPortalConfig, /https:\/\/[^"']+\.vercel\.app/, 'iOS portal config must not include production module URLs');
const parsedIosPortalConfig = JSON.parse(iosPortalConfig);
for (const tool of parsedIosPortalConfig.tools) {
  if (tool.id === 'inventory') {
    assert.equal(tool.url, 'storage/index.html', 'Inventory must point to local iOS storage bundle');
    assert.equal(tool.ready, true, 'Inventory must be ready in iOS bundle');
  } else {
    assert.equal(tool.url, '#', `${tool.id} must not carry a launch URL in iOS bundle`);
    assert.equal(tool.ready, false, `${tool.id} must be gated in iOS bundle`);
  }
}

const storageConfig = read('www/storage/config.js');
assert.match(storageConfig, /window\.STORAGE_API\s*=\s*window\.STORAGE_API\s*\|\|\s*''/, 'Storage API must default to empty');
assert.doesNotMatch(storageConfig, /https?:\/\//, 'Storage config must not default to remote API');

const storageIndex = read('www/storage/index.html');
assert.match(storageIndex, /href="\.\.\/index\.html"/, 'Inventory back link must return to the local iOS shell bundle');
assert.doesNotMatch(storageIndex, /href="\/"/, 'Inventory back link must not rely on an absolute root path in iOS bundle');
assert.match(storageIndex, /viewport-fit=cover/, 'Inventory must use mobile safe-area viewport');
assert.match(storageIndex, /id="firstLaunch"/, 'Inventory first-launch chooser must be present');
assert.match(storageIndex, /chooseFirstLaunchMode\('demo'\)/, 'Inventory demo first-launch action must be present');
assert.match(storageIndex, /chooseFirstLaunchMode\('personal'\)/, 'Inventory blank personal first-launch action must be present');
assert.match(storageIndex, /id="sh-settings"/, 'Inventory settings sheet must be present');
assert.match(storageIndex, /exportInventory\(\)/, 'Inventory current-mode export action must be present');
assert.match(storageIndex, /clearPersonalData\(\)/, 'Inventory personal local delete action must be present');
assert.match(storageIndex, /deleteAllLocalLaunchData\(\)/, 'Inventory all-local launch delete action must be present');
for (const tabId of ['t-home', 't-stats', 't-scan', 't-impulse']) {
  assert.match(storageIndex, new RegExp(`id="${tabId}"`), `Inventory bottom tab ${tabId} must be present`);
}

const storageApp = read('www/storage/app.js');
assert.match(storageApp, /FIRST_LAUNCH_IMAGE_AI_ENABLED\s*=\s*false/, 'Storage image AI must be disabled in iOS bundle');
for (const marker of [
  'function archiveItem(',
  'function deleteItem(',
  'function saveEdit(',
  'function exportInventory(',
  'function clearPersonalData(',
  'function deleteAllLocalLaunchData(',
  'locationHint',
  'createdAt',
  'updatedAt',
  'no-data-state',
]) {
  assert.match(storageApp, new RegExp(marker.replace(/[()]/g, '\\$&')), `Storage runtime must include marker: ${marker}`);
}

const storageGuard = read('www/storage/guard.js');
assert.match(storageGuard, /FIRST_LAUNCH_NOTIFICATIONS_ENABLED\s*=\s*false/, 'runtime notifications must be disabled in iOS bundle');

const capacitorConfig = read('capacitor.config.ts');
assert.match(capacitorConfig, /webDir:\s*'www'/, 'Capacitor must load local www bundle');
assert.match(capacitorConfig, /appName:\s*'宝盒'/, 'Capacitor app name must be Baohe');
assert.doesNotMatch(capacitorConfig, /SplashScreen|StatusBar/, 'Splash/status-bar plugins must stay deferred in this shell slice');

const spmPackage = read('ios/App/CapApp-SPM/Package.swift');
assert.doesNotMatch(spmPackage, /CapacitorSplashScreen|CapacitorStatusBar/, 'Native splash/status-bar packages must stay deferred');

const portalConfig = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));
const inventory = portalConfig.tools.find((tool) => tool.id === 'inventory');
assert.equal(inventory?.ready, true, 'Inventory must be launch-ready');

for (const id of ['secretary', 'psychoanalysis', 'health', 'finance']) {
  const tool = portalConfig.tools.find((item) => item.id === id);
  assert.equal(tool?.ready, false, `${id} must not be launch-ready`);
  assert.equal(tool?.status, 'gated', `${id} must remain gated`);
}

console.log('PASS treasurebox iOS shell precheck');
