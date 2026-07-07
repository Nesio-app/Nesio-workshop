import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(repoRoot, 'public');

const allowedPublicToolDirs = new Set([]);
const knownNonLaunchToolDirs = new Set([
  'storage',
  'fitness',
  'health',
  'reading',
]);

const bundlePlan = JSON.parse(execFileSync('node', [join(repoRoot, 'scripts', 'bundle-toolbox.mjs'), '--dry-run'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 4,
}));

assert.equal(bundlePlan.exposureMode, 'public_launch_only');
assert.deepEqual(
  bundlePlan.entries.filter((entry) => entry.visibleForPublic).map((entry) => entry.moduleId),
  [],
);

assert.equal(
  existsSync(join(publicRoot, 'secretary')),
  false,
  'public/secretary must not be present in production public assets (secretary module was removed).',
);

assert.equal(
  existsSync(join(publicRoot, 'storage')),
  false,
  'public/storage must not be present in production public assets (inventory module went native).',
);

const publicDirs = existsSync(publicRoot)
  ? readdirSync(publicRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];
const exposedNonLaunchDirs = publicDirs.filter((dir) => knownNonLaunchToolDirs.has(dir) && !allowedPublicToolDirs.has(dir));

assert.deepEqual(
  exposedNonLaunchDirs,
  [],
  `non-launch tool directories must not be present under public/: ${exposedNonLaunchDirs.join(', ')}`,
);

console.log('public bundle exposure precheck passed');
