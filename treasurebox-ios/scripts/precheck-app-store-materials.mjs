import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const iosRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(iosRoot, 'ios', 'App');
const infoPlist = join(appRoot, 'App', 'Info.plist');
const projectFile = join(appRoot, 'App.xcodeproj', 'project.pbxproj');
const iconPath = join(appRoot, 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const launchStoryboard = join(appRoot, 'App', 'Base.lproj', 'LaunchScreen.storyboard');
const shellHtml = join(iosRoot, 'www', 'index.html');
const inventoryHtml = join(iosRoot, 'www', 'storage', 'index.html');
const storageConfig = join(iosRoot, 'www', 'storage', 'config.js');
const storageGuard = join(iosRoot, 'www', 'storage', 'guard.js');

const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], {
  encoding: 'utf8',
}));
const project = readFileSync(projectFile, 'utf8');
const shell = readFileSync(shellHtml, 'utf8');
const inventory = readFileSync(inventoryHtml, 'utf8');
const config = readFileSync(storageConfig, 'utf8');
const guard = readFileSync(storageGuard, 'utf8');

assert.equal(plist.CFBundleDisplayName, '宝盒', 'App Store app name must match local shell');
assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.jiuxiao\.treasurebox;/, 'Bundle ID must be stable for review prep');
assert.equal(existsSync(iconPath), true, 'Icon placeholder asset must exist');
assert.equal(existsSync(launchStoryboard), true, 'Launch screen must exist');
assert.equal(statSync(iconPath).size > 0, true, 'Icon placeholder must be non-empty');
assert.match(shell, /首发 iOS 本地壳/, 'Shell copy must frame this as first-launch local iOS shell');
assert.match(shell, /进入收纳 Inventory/, 'Shell must point users to Inventory');
assert.match(shell, /其他工具保留在内部 registry/, 'Shell must not publicly promise the other registry modules');
assert.match(inventory, /chooseFirstLaunchMode\('demo'\)/, 'Demo mode must be available for review');
assert.match(inventory, /chooseFirstLaunchMode\('personal'\)/, 'Blank local start must be available for review');
assert.match(inventory, /exportInventory\(\)/, 'Review notes may mention local export');
assert.match(inventory, /clearPersonalData\(\)/, 'Review notes may mention local personal delete');
assert.match(config, /window\.STORAGE_API\s*=\s*window\.STORAGE_API\s*\|\|\s*''/, 'No hidden storage API endpoint should be configured');
assert.match(guard, /FIRST_LAUNCH_NOTIFICATIONS_ENABLED\s*=\s*false/, 'Notifications must stay disabled for first launch');

for (const forbidden of [
  'NSCameraUsageDescription',
  'NSHealthShareUsageDescription',
  'NSHealthUpdateUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NFCReaderUsageDescription',
]) {
  assert.equal(forbidden in plist, false, `${forbidden} must not appear in first-launch privacy permissions`);
}

for (const forbiddenCopy of [
  /medical advice/i,
  /mental health treatment/i,
  /financial advice/i,
  /AI assistant can execute/i,
  /payment/i,
  /subscription/i,
]) {
  assert.equal(forbiddenCopy.test(shell), false, `Shell must not contain forbidden App Store claim: ${forbiddenCopy}`);
  assert.equal(forbiddenCopy.test(inventory), false, `Inventory must not contain forbidden App Store claim: ${forbiddenCopy}`);
}

const result = {
  ok: true,
  version: 'app-store-materials-precheck-v0',
  appStoreMaterials: {
    appName: '宝盒',
    bundleId: 'com.jiuxiao.treasurebox',
    firstLaunchPromise: 'Shell + Inventory / purchase-memory',
    iconPlaceholderPresent: true,
    iconPlaceholderAcceptableForTestFlight: true,
    iconPlaceholderAcceptableForPublicAppStore: false,
    screenshotSurfaceStable: true,
    reviewNotesCanDescribe: [
      'mobile-first local personal toolbox',
      'Inventory / purchase-memory local demo and personal modes',
      'local export and local delete controls',
      'no cloud sync, no external auth, no payment, no AI runtime',
    ],
    reviewNotesMustNotClaim: [
      'medical or health advice',
      'mental health treatment or diagnosis',
      'financial advice or real account access',
      'AI automatic execution',
      'paid subscription or StoreKit purchase',
      'all 11 tools are publicly available',
    ],
    privacyLabelInputs: {
      cloudSync: false,
      accountSystem: false,
      externalAuth: false,
      payment: false,
      aiRuntime: false,
      cameraPermissionDeclared: false,
      healthPermissionDeclared: false,
      dataStoredLocally: true,
      exportDeleteLocalControls: true,
    },
  },
};

console.log(JSON.stringify(result, null, 2));
