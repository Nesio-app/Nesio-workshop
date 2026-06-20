import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const css = read('storage-web/styles.css');
const guard = read('storage-web/guard.js');

for (const token of [
  '--modal-backdrop-bg',
  '--modal-backdrop-blur',
  '--modal-card-bg',
  '--modal-card-blur',
  '--modal-card-saturate',
  '--tap-min',
]) {
  assert.match(css, new RegExp(`${token}\\s*:`), `storage-web/styles.css must define ${token}.`);
}

assert.match(
  css,
  /\.storage-guard-guide__card[\s\S]*background:\s*var\(--modal-card-bg\)/,
  'Storage guard card must use the shared modal card background token.',
);
assert.match(
  css,
  /\.storage-guard-guide__card[\s\S]*blur\(var\(--modal-card-blur\)\)\s*saturate\(var\(--modal-card-saturate\)\)/,
  'Storage guard card must use shared modal blur and saturation tokens.',
);
assert.match(
  css,
  /\.storage-guard-guide__close[\s\S]*width:\s*var\(--tap-min\)/,
  'Storage guard close button must use the shared 44px tap target token.',
);
assert.match(
  css,
  /\.storage-guard-guide__close[\s\S]*height:\s*var\(--tap-min\)/,
  'Storage guard close button must use the shared 44px tap target token.',
);
assert.match(
  guard,
  /data-storage-guard-guide/,
  'Storage guard runtime must keep the QA marker for the in-app guidance panel.',
);

assert.equal(
  packageJson.scripts['test:storage-guard-design-system'],
  'node scripts/storage-guard-design-system.test.mjs',
  'package.json must expose test:storage-guard-design-system.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:storage-guard-design-system/,
  'test:contracts must include storage guard design-system coverage.',
);

console.log('storage-guard-design-system checks passed');
