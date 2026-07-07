import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const middleware = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertRewrite(source, destination) {
  assert.ok(
    vercelJson.rewrites?.some((rewrite) => rewrite.source === source && rewrite.destination === destination),
    `Expected vercel rewrite ${source} -> ${destination}`,
  );
}

function assertMiddlewareMatcher(route) {
  assert.match(
    middleware,
    new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
    `Expected middleware matcher for ${route}`,
  );
}

for (const [source, destination] of [
  ['/storage', '/storage/index.html'],
  ['/storage/', '/storage/index.html'],
]) {
  assertRewrite(source, destination);
}

assert.doesNotMatch(
  middleware,
  /\?:html\|css\|js\|json\|svg\|png\|jpg\|jpeg\|webp\|ico/,
  'Ungated extension-based bypass must stay removed (launch privacy QA blocker, commit 9099b06).',
);

for (const route of [
  '/storage',
]) {
  assertMiddlewareMatcher(route);
}

const storageIndex = read('public/storage/index.html');

assert.doesNotMatch(storageIndex, /\/index\.html\b/, 'public/storage/index.html must not navigate to /index.html');
assert.doesNotMatch(storageIndex, /href=["']#|javascript:void|about:blank/, 'public/storage/index.html must not expose fake navigation links');

assert.match(storageIndex, /href="\/"/, 'Storage must expose a root return link back to Baohe shell.');
assert.match(
  storageIndex,
  /class="[^"]*portal-back-link[^"]*"/,
  'Storage must keep its portal-back affordance for returning to Baohe shell.',
);

assert.equal(
  packageJson.scripts['test:portal-route-integrity'],
  'node scripts/portal-route-integrity.test.mjs',
  'package.json must expose test:portal-route-integrity.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:portal-route-integrity/,
  'test:contracts must include portal route integrity coverage.',
);

console.log('portal-route-integrity checks passed');
