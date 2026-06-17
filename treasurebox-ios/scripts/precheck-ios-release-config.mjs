import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const iosRoot = join(fileURLToPath(new URL('..', import.meta.url)));
const appRoot = join(iosRoot, 'ios', 'App');
const infoPlist = join(appRoot, 'App', 'Info.plist');
const projectFile = join(appRoot, 'App.xcodeproj', 'project.pbxproj');
const launchStoryboard = join(appRoot, 'App', 'Base.lproj', 'LaunchScreen.storyboard');
const appIcon = join(appRoot, 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const splashImageSet = join(appRoot, 'App', 'Assets.xcassets', 'Splash.imageset', 'Contents.json');
const capacitorConfig = join(iosRoot, 'capacitor.config.ts');

const plistJson = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], {
  encoding: 'utf8',
});
const plist = JSON.parse(plistJson);
const project = readFileSync(projectFile, 'utf8');
const capConfig = readFileSync(capacitorConfig, 'utf8');

assert.equal(plist.CFBundleDisplayName, '宝盒', 'App display name must be 宝盒');
assert.equal(plist.CFBundleIdentifier, '$(PRODUCT_BUNDLE_IDENTIFIER)', 'Info.plist should defer bundle id to build settings');
assert.equal(plist.UILaunchStoryboardName, 'LaunchScreen', 'Launch screen storyboard must be configured');
assert.deepEqual(plist.UISupportedInterfaceOrientations, ['UIInterfaceOrientationPortrait'], 'iPhone launch build must stay portrait-only');
assert.equal(existsSync(appIcon), true, 'App icon placeholder must exist');
assert.equal(existsSync(launchStoryboard), true, 'Launch screen storyboard must exist');
assert.equal(existsSync(splashImageSet), true, 'Launch screen image set must exist');

assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.jiuxiao\.treasurebox;/, 'Bundle ID must be com.jiuxiao.treasurebox');
assert.match(project, /Debug/, 'Debug build configuration must exist');
assert.match(project, /Release/, 'Release build configuration must exist');
assert.match(project, /CODE_SIGN_STYLE = Automatic;/, 'Signing style can be prepared but must remain a CEO-gated release step');

for (const forbiddenKey of [
  'NSCameraUsageDescription',
  'NSHealthShareUsageDescription',
  'NSHealthUpdateUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NFCReaderUsageDescription',
]) {
  assert.equal(forbiddenKey in plist, false, `${forbiddenKey} must not be declared for first-launch App Store prep`);
}

for (const forbiddenText of [
  'StoreKit',
  'HealthKit',
  'Camera',
  'AI runtime',
  'finance',
  'payment',
  'subscription',
]) {
  assert.equal(capConfig.includes(forbiddenText), false, `Capacitor config must not declare ${forbiddenText}`);
}

const releaseReadiness = {
  bundleId: 'com.jiuxiao.treasurebox',
  appName: '宝盒',
  iconPlaceholderReady: true,
  launchScreenPlaceholderReady: true,
  orientation: 'portrait',
  declaresCameraPermission: false,
  declaresHealthPermission: false,
  declaresFinancePermission: false,
  declaresAiRuntimePermission: false,
  signingRequiresCeoGate: true,
  testFlightRequiresCeoGate: true,
  appStoreSubmitRequiresCeoGate: true,
  releaseBuildConfigPresent: true,
  debugSimulatorBuildMustPass: true,
};

console.log(JSON.stringify({
  ok: true,
  version: 'ios-release-config-prep-v0',
  releaseReadiness,
}, null, 2));
