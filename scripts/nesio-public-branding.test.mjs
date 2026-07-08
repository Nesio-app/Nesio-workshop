import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const layout = readFileSync(join(root, 'app', 'layout.tsx'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const portalConfig = JSON.parse(readFileSync(join(root, 'public', 'portal-config.json'), 'utf8'));
const i18n = readFileSync(join(root, 'lib', 'portal', 'i18n.ts'), 'utf8');
const zhI18n = i18n.slice(i18n.indexOf('  zh: {'), i18n.indexOf('  en: {'));
const onboarding = readFileSync(join(root, 'components', 'portal', 'PortalOnboarding.tsx'), 'utf8');
const bottomNav = readFileSync(join(root, 'components', 'portal', 'PortalBottomNav.tsx'), 'utf8');
const toolsTreasureSheet = readFileSync(join(root, 'components', 'portal', 'ToolsTreasureSheet.tsx'), 'utf8');
const personalizationInsights = readFileSync(join(root, 'lib', 'portal', 'personalization-insights.ts'), 'utf8');
const calendarRoute = readFileSync(join(root, 'app', 'api', 'portal', 'calendar', 'route.ts'), 'utf8');
const moduleManagerCore = readFileSync(join(root, 'lib', 'portal', 'module-manager-core.mjs'), 'utf8');
const moduleManagerTs = readFileSync(join(root, 'lib', 'portal', 'module-manager.ts'), 'utf8');
const webSurfaceContract = readFileSync(join(root, 'lib', 'portal', 'contracts', 'web-surface-contract-v0.mjs'), 'utf8');
const appApiContract = readFileSync(join(root, 'lib', 'portal', 'contracts', 'app-api-contract-v0.mjs'), 'utf8');

assert.match(layout, /title:\s*'Nesio\b/, 'App metadata title must use the public product name Nesio.');
assert.match(layout, /appleWebApp:[\s\S]*title:\s*'Nesio'/, 'Apple Web App title must use Nesio.');
assert.equal(manifest.name, 'Nesio', 'PWA manifest name must be Nesio.');
assert.equal(manifest.short_name, 'Nesio', 'PWA manifest short_name must be Nesio.');
assert.match(manifest.description, /^Nesio\b/, 'PWA manifest description must start with Nesio.');
assert.equal(portalConfig.meta?.title, 'Nesio', 'Portal config public title must be Nesio.');
assert.match(i18n, /shellBrand:\s*'Nesio'/, 'English shell brand must be Nesio.');
assert.match(i18n, /portalBottomNavHome:\s*'Nesio'/, 'English bottom-nav home label must be Nesio.');
for (const key of [
  'settingsBack',
  'openTreasure',
  'shellBrand',
  'shellTreasurePopupAriaLabel',
  'shellTreasureTitleTemplate',
  'portalBottomNavHome',
  'portalAppearanceHint',
  'accountSettingsAppearanceHint',
  'accountSettingsLearnedTitle',
  'accountSettingsMemoryEmpty',
]) {
  const zhEntry = new RegExp(`${key}:\\s*'[^']*Nesio[^']*'`);
  assert.match(zhI18n, zhEntry, `Chinese i18n public brand key ${key} must use Nesio.`);
}
assert.doesNotMatch(layout, /title:\s*'宝盒|title:\s*'Treasure Box/, 'Public app metadata must not expose the old product name.');
assert.doesNotMatch(
  JSON.stringify(manifest),
  /宝盒|Treasure Box|TreasureBox/,
  'PWA manifest must not expose old product names.',
);
assert.doesNotMatch(onboarding, /Baohe|Treasure Box|TreasureBox|Nosio/, 'Public onboarding copy must use Nesio naming.');
assert.doesNotMatch(calendarRoute, /TreasureBox|Treasure Box|Nosio/, 'External-facing calendar User-Agent must use Nesio naming.');
assert.doesNotMatch(
  moduleManagerCore,
  /firstScreenHint:\s*'宝盒|dialogTitlePattern:\s*'宝盒|appName:\s*'宝盒'/,
  'Runtime/report shell contract labels must use Nesio, not 宝盒.',
);
assert.doesNotMatch(
  moduleManagerTs,
  /meta:\s*\{\s*title:\s*'宝盒'/,
  'Portal module fallback shell metadata must use Nesio, not 宝盒.',
);
assert.doesNotMatch(
  webSurfaceContract,
  /Baohe v0\.1 is a mobile-first personal toolbox/,
  'Public web-surface positioning must use Nesio naming.',
);
assert.doesNotMatch(appApiContract, /Baohe Local Demo/, 'Local API fixture display name must use Nesio naming.');
assert.doesNotMatch(moduleManagerCore, /config\.meta\?\.title \|\| '宝盒'/, 'Shell fallback name must use Nesio naming.');
for (const [name, source] of [
  ['PortalOnboarding', onboarding],
  ['PortalBottomNav', bottomNav],
  ['ToolsTreasureSheet', toolsTreasureSheet],
  ['personalization-insights', personalizationInsights],
]) {
  assert.doesNotMatch(source, /宝盒/, `${name} public-facing copy must use Nesio instead of 宝盒.`);
}
assert.match(onboarding, /Nesio/, 'Public onboarding copy should mention Nesio.');
assert.match(webSurfaceContract, /Nesio v0\.1 is a mobile-first personal toolbox/, 'Web-surface positioning should mention Nesio.');
assert.match(appApiContract, /Nesio Local Demo/, 'Local API fixture display name should mention Nesio.');
assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-public-branding/,
  'test:contracts must include public Nesio branding coverage.',
);

console.log('Nesio public branding contract OK');
