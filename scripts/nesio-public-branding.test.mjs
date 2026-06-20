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
const storageSourceHome = readFileSync(join(root, 'storage-web', 'index.html'), 'utf8');
const storageHome = readFileSync(join(root, 'public', 'storage', 'index.html'), 'utf8');
const calendarRoute = readFileSync(join(root, 'app', 'api', 'portal', 'calendar', 'route.ts'), 'utf8');
const secretaryList = readFileSync(join(root, 'public', 'secretary', 'index.html'), 'utf8');
const secretaryListJs = readFileSync(join(root, 'public', 'secretary', 'list.js'), 'utf8');
const secretaryApi = readFileSync(join(root, 'public', 'secretary', 'api.js'), 'utf8');

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
assert.doesNotMatch(storageSourceHome, /Baohe|Treasure Box|TreasureBox|Nosio/, 'Inventory source first-launch copy must use Nesio naming.');
assert.doesNotMatch(storageHome, /Baohe|Treasure Box|TreasureBox|Nosio/, 'Public Inventory first-launch copy must use Nesio naming.');
assert.doesNotMatch(calendarRoute, /TreasureBox|Treasure Box|Nosio/, 'External-facing calendar User-Agent must use Nesio naming.');
assert.doesNotMatch(secretaryList, /宝盒工具|>宝盒<|Baohe|Treasure Box|TreasureBox|Nosio/, 'Public Secretary list chrome must use Nesio naming.');
assert.doesNotMatch(secretaryListJs, /返回宝盒|Baohe|Treasure Box|TreasureBox|Nosio/, 'Public Secretary actions must use Nesio naming.');
assert.doesNotMatch(secretaryApi, /treasurebox-nu\.vercel\.app|Nosio/, 'Secretary API public fallback must use the Nesio domain.');
assert.match(onboarding, /Nesio/, 'Public onboarding copy should mention Nesio.');
assert.match(storageSourceHome, /Nesio Purchase Memory/, 'Inventory source first-launch kicker should mention Nesio.');
assert.match(storageHome, /Nesio Purchase Memory/, 'Inventory first-launch kicker should mention Nesio.');
assert.match(secretaryList, /Nesio/, 'Public Secretary list chrome should mention Nesio.');
assert.match(secretaryListJs, /返回 Nesio/, 'Public Secretary dock should return to Nesio.');
assert.match(secretaryApi, /https:\/\/www\.nesio\.app/, 'Secretary API public fallback should use www.nesio.app.');
assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-public-branding/,
  'test:contracts must include public Nesio branding coverage.',
);

console.log('Nesio public branding contract OK');
