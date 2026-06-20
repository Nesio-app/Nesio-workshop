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
  ['/secretary', '/secretary/index.html'],
  ['/secretary/', '/secretary/index.html'],
  ['/secretary/chat', '/secretary/chat.html'],
  ['/secretary/group', '/secretary/group.html'],
]) {
  assertRewrite(source, destination);
}

for (const route of [
  '/storage',
  '/secretary',
  '/secretary/chat',
  '/secretary/group',
  '/secretary/:path*',
  '/api/secretary/:path*',
]) {
  assertMiddlewareMatcher(route);
}

const secretaryIndex = read('public/secretary/index.html');
const secretaryList = read('public/secretary/list.js');
const secretaryChat = read('public/secretary/chat.js');
const secretaryGroup = read('public/secretary/group.js');
const storageIndex = read('public/storage/index.html');

for (const [name, source] of [
  ['public/secretary/index.html', secretaryIndex],
  ['public/secretary/list.js', secretaryList],
  ['public/secretary/chat.js', secretaryChat],
  ['public/secretary/group.js', secretaryGroup],
  ['public/storage/index.html', storageIndex],
]) {
  assert.doesNotMatch(source, /\/index\.html\b/, `${name} must not navigate to /index.html`);
  assert.doesNotMatch(source, /href=["']#|javascript:void|about:blank/, `${name} must not expose fake navigation links`);
}

assert.match(
  secretaryIndex,
  /href="\/secretary"/,
  'Secretary list tab should point to the extensionless /secretary route.',
);
assert.match(
  secretaryIndex,
  /href="\/secretary\/chat\?friend=gemini"/,
  'Secretary tab should point to the extensionless chat route.',
);
assert.match(
  secretaryList,
  /href = `\/secretary\/chat\?friend=\$\{encodeURIComponent\(f\.id\)\}`/,
  'Secretary list should build friend chat links through /secretary/chat.',
);
assert.match(
  secretaryList,
  /href = `\/secretary\/group\?group=\$\{encodeURIComponent\(g\.id\)\}`/,
  'Secretary list should build group links through /secretary/group.',
);
assert.doesNotMatch(
  secretaryChat,
  /location\.(?:href|replace)\s*=\s*['"]\/secretary\/chat\?friend=gemini/,
  'Secretary chat must not force visible AI entries back to Gemini.',
);

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
