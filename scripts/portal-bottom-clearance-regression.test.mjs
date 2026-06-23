import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  css,
  /\.portal-bottom-nav\s*\{[\s\S]*?display:\s*none\s*!important;/,
  'legacy bottom nav must stay hidden on the V14 runtime surface.',
);

assert.match(
  css,
  /\.portal-ai-thread\s*\{[\s\S]*?padding-bottom:\s*calc\(5\.8rem \+ env\(safe-area-inset-bottom\)\) !important;/,
  'AI Friends thread must reserve only fixed-composer space without the Shell bottom nav.',
);

assert.match(
  css,
  /\.portal-ai-preview--screen\s*\{[\s\S]*?scroll-padding-bottom:\s*calc\(5\.2rem \+ env\(safe-area-inset-bottom\)\) !important;/,
  'AI Friends screen scroll position must keep focused content above its composer without old bottom navigation clearance.',
);

assert.match(
  css,
  /\.portal-treasure-package-list\s*\{[\s\S]*?padding-bottom:\s*calc\(2\.5rem \+ env\(safe-area-inset-bottom\)\) !important;/,
  'Toolbox package list must keep the last package above the mobile safe area without the old bottom nav.',
);

assert.match(
  css,
  /\.portal-treasure-screen\s*\{[\s\S]*?scroll-padding-bottom:\s*calc\(2rem \+ env\(safe-area-inset-bottom\)\) !important;/,
  'Toolbox screen must use mobile safe-area clearance for scrollIntoView and keyboard focus.',
);

assert.equal(
  pkg.scripts['test:portal-bottom-clearance'],
  'node scripts/portal-bottom-clearance-regression.test.mjs',
  'package.json must expose test:portal-bottom-clearance.',
);

assert.match(
  pkg.scripts['test:contracts'],
  /test:portal-bottom-clearance/,
  'test:contracts must include test:portal-bottom-clearance.',
);

console.log('portal bottom clearance regression checks passed');
