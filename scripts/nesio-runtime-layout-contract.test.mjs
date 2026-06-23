import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(
  css,
  /\.portal-bottom-nav\s*\{[\s\S]*?display:\s*none\s*!important;/,
  'Nesio runtime layout must hide the legacy bottom nav on V14 mobile-first surfaces.',
);

for (const selector of ['portal-ai-preview--screen', 'portal-treasure-screen']) {
  assert.match(
    css,
    new RegExp(`\\.${selector}\\s*\\{[\\s\\S]*(?:padding|scroll-padding)(?:-bottom)?\\s*:[^;]*env\\(safe-area-inset-bottom\\)`, 'm'),
    `${selector} must reserve mobile safe-area space without the old bottom nav.`,
  );
}

assert.match(
  css,
  /portal-ai-thread[\s\S]*padding:[^;]*7\.4rem \+ env\(safe-area-inset-bottom\)/,
  'AI thread must reserve composer space without the old bottom nav.',
);

assert.doesNotMatch(
  css,
  /portal-ai-preview--screen[\s\S]{0,180}padding[^;]*(10\.9rem|12\.4rem|13\.5rem)/,
  'AI screen must not hard-code bottom clearance values after the shared token exists.',
);

assert.doesNotMatch(
  css,
  /portal-treasure-screen[\s\S]{0,180}padding-bottom[^;]*(11\.3rem|12\.4rem|14rem)/,
  'Toolbox screen must not hard-code bottom clearance values after the shared token exists.',
);

assert.equal(
  pkg.scripts['test:nesio-runtime-layout'],
  'node scripts/nesio-runtime-layout-contract.test.mjs',
  'package.json must expose test:nesio-runtime-layout.',
);

assert.match(
  pkg.scripts['test:contracts'],
  /test:nesio-runtime-layout/,
  'test:contracts must include test:nesio-runtime-layout.',
);

console.log('Nesio runtime layout contract OK');
