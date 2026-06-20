import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));

for (const file of ['public/storage/guard.js', 'storage-web/guard.js']) {
  const source = read(file);
  assert.doesNotMatch(
    source,
    /\balert\s*\(/,
    `${file} must not use blocking browser alert for Screen Time guidance.`,
  );
  assert.match(
    source,
    /renderScreenTimeGuide/,
    `${file} must render Screen Time guidance inside the app surface.`,
  );
  assert.match(
    source,
    /data-storage-guard-guide/,
    `${file} must mark the in-app Screen Time guidance panel for QA.`,
  );
  assert.match(
    source,
    /showToast/,
    `${file} must keep non-blocking toast feedback when opening Screen Time guidance.`,
  );
}

assert.equal(
  packageJson.scripts['test:storage-guard-feedback'],
  'node scripts/storage-guard-nonblocking-feedback.test.mjs',
  'package.json must expose test:storage-guard-feedback.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:storage-guard-feedback/,
  'test:contracts must include storage guard feedback coverage.',
);

console.log('storage-guard-nonblocking-feedback checks passed');
