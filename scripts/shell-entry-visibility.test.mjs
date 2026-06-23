import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const css = read('app/globals.css');
const dashboard = read('components/portal/DashboardHome.tsx');
const portal = read('components/portal/Portal.tsx');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  `${dashboard}\n${portal}`,
  /portal-quote-treasure/,
  'Dashboard must keep the treasure entry button mounted for shell discovery.',
);

assert.match(
  css,
  /\.portal-bottom-nav\s*\{[\s\S]*?display:\s*none\s*!important;/,
  'V14 must hide the legacy bottom nav now that home and toolbox own their screen entry points.',
);

const treasureBoxBlocks = [...css.matchAll(/\.portal-quote-treasure-box\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);
assert.ok(treasureBoxBlocks.length > 0, 'treasure entry box styles must exist.');
assert.ok(
  treasureBoxBlocks.some((block) => /background:\s*rgba\(/.test(block) && /border:\s*1px solid/.test(block)),
  'treasure entry box must retain a visible glass hit target for mobile shell discovery.',
);
assert.ok(
  !treasureBoxBlocks.some((block) => /background:\s*transparent\s*!important/.test(block)),
  'treasure entry box must not be globally forced transparent.',
);
assert.equal(
  packageJson.scripts['test:shell-entry-visibility'],
  'node scripts/shell-entry-visibility.test.mjs',
  'package.json must expose the shell entry visibility regression test.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:shell-entry-visibility/,
  'test:contracts must include shell entry visibility coverage.',
);

console.log('shell entry visibility tests passed');
