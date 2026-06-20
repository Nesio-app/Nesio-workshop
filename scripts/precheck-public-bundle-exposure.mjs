import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(repoRoot, 'public');

const allowedPublicToolDirs = new Set(['adhd-flow', 'storage', 'secretary']);
const knownNonLaunchToolDirs = new Set([
  'fitness',
  'health',
  'reading',
  'secretary',
]);

const bundlePlan = JSON.parse(execFileSync('node', [join(repoRoot, 'scripts', 'bundle-toolbox.mjs'), '--dry-run'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 4,
}));

assert.equal(bundlePlan.exposureMode, 'public_launch_only');
assert.deepEqual(
  bundlePlan.entries.filter((entry) => entry.visibleForPublic).map((entry) => entry.moduleId),
  ['plan', 'inventory'],
);
const secretaryEntry = bundlePlan.entries.find((entry) => entry.moduleId === 'secretary');
assert.equal(secretaryEntry?.visibleForPublic, false, 'secretary may be preserved as a direct chat page but must not be public toolbox surface');
assert.equal(secretaryEntry?.shellAction, 'hide_for_public');

const launchSafety = execFileSync('node', ['-e', "const fs=require('fs'); process.stdout.write(fs.readFileSync('lib/portal/launch-safety.ts','utf8'))"], {
  cwd: repoRoot,
  encoding: 'utf8',
});
const middleware = execFileSync('node', ['-e', "const fs=require('fs'); process.stdout.write(fs.readFileSync('middleware.ts','utf8'))"], {
  cwd: repoRoot,
  encoding: 'utf8',
});
assert.match(launchSafety, /['"]\/secretary['"]/, 'secretary direct URL must be first-launch blocked');
assert.match(
  middleware,
  /pathname\.startsWith\(['"]\/secretary['"]\)\s*&&\s*isSecretaryPageRequestAllowed\(request\)/,
  'middleware may only expose /secretary when the explicit personal/lab page gate allows it',
);
const secretaryGateIndex = middleware.indexOf('isSecretaryPageRequestAllowed(request)');
const secretaryRewriteIndex = middleware.indexOf("url.pathname = '/secretary/index.html'");
assert.ok(
  secretaryGateIndex >= 0 && secretaryRewriteIndex > secretaryGateIndex,
  'middleware must only rewrite /secretary after the explicit personal/lab page gate check',
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
