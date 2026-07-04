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

assert.deepEqual(
  (vercelJson.rewrites || []).filter((rewrite) => String(rewrite.source || '').startsWith('/secretary')),
  [],
  'Secretary must not be exposed by public Vercel rewrites; middleware/lab gate owns this route.',
);

// 9099b06(2026-06-28 隐私 QA 阻断)收紧:无门的扩展名直通会把 gated 的
// secretary 页面泄露给公众,已移除。静态资源只在 lab gate 内放行。
assert.match(
  middleware,
  /isSecretaryPageRequestAllowed\(request\)[\s\S]*NextResponse\.next\(\)/,
  'Secretary static assets must only pass through inside the lab gate (isSecretaryPageRequestAllowed).',
);
assert.doesNotMatch(
  middleware,
  /\?:html\|css\|js\|json\|svg\|png\|jpg\|jpeg\|webp\|ico/,
  'Ungated extension-based bypass must stay removed (launch privacy QA blocker, commit 9099b06).',
);

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

const secretaryIndex = read('tools/secretary/index.html');
const secretaryList = read('tools/secretary/list.js');
const secretaryChat = read('tools/secretary/chat.js');
const secretaryGroup = read('tools/secretary/group.js');
const storageIndex = read('public/storage/index.html');

for (const [name, source] of [
  ['tools/secretary/index.html', secretaryIndex],
  ['tools/secretary/list.js', secretaryList],
  ['tools/secretary/chat.js', secretaryChat],
  ['tools/secretary/group.js', secretaryGroup],
  ['public/storage/index.html', storageIndex],
]) {
  assert.doesNotMatch(source, /\/index\.html\b/, `${name} must not navigate to /index.html`);
  assert.doesNotMatch(source, /href=["']#|javascript:void|about:blank/, `${name} must not expose fake navigation links`);
}

assert.doesNotMatch(
  secretaryIndex,
  /wx-tabbar|aria-label="底部导航"|href="\/secretary\/chat\?friend=gemini"/,
  'Secretary list page must not keep the removed bottom navigation or fixed Gemini tab link.',
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
