import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  css,
  /--portal-bottom-nav-clearance:\s*calc\(12\.4rem \+ env\(safe-area-inset-bottom\)\)/,
  'global bottom nav clearance token must include the nav, gap, and mobile safe area.',
);

assert.match(
  css,
  /\.portal-ai-thread\s*\{[\s\S]*?padding:\s*0\.15rem 0 calc\(var\(--portal-bottom-nav-clearance\) \+ 8\.5rem\) !important;/,
  'AI Friends thread must reserve space for both the fixed composer and fixed bottom nav.',
);

assert.match(
  css,
  /\.portal-ai-preview--screen\s*\{[\s\S]*?scroll-padding-bottom:\s*calc\(var\(--portal-bottom-nav-clearance\) \+ 8\.5rem\) !important;/,
  'AI Friends screen scroll position must keep focused content above composer and bottom nav.',
);

assert.match(
  css,
  /\.portal-treasure-package-list\s*\{[\s\S]*?padding-bottom:\s*calc\(var\(--portal-bottom-nav-clearance\) \+ 2rem\) !important;/,
  'Toolbox package list must keep the last package above the fixed bottom nav.',
);

assert.match(
  css,
  /\.portal-treasure-screen\s*\{[\s\S]*?scroll-padding-bottom:\s*var\(--portal-bottom-nav-clearance\) !important;/,
  'Toolbox screen must use bottom nav clearance for scrollIntoView and keyboard focus.',
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
