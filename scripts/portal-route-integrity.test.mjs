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

// 静态 /storage/(收纳)与 /adhd-flow/ 已解绑为原生功能:不允许残留 rewrite
for (const gone of ['/storage', '/storage/', '/adhd-flow', '/adhd-flow/']) {
  assert.ok(
    !vercelJson.rewrites?.some((rewrite) => rewrite.source === gone),
    `Unbound static app rewrite must stay removed: ${gone}`,
  );
}

assert.doesNotMatch(
  middleware,
  /\?:html\|css\|js\|json\|svg\|png\|jpg\|jpeg\|webp\|ico/,
  'Ungated extension-based bypass must stay removed (launch privacy QA blocker, commit 9099b06).',
);

assert.doesNotMatch(
  middleware,
  /['"]\/storage['"]/,
  'Middleware must not keep a matcher for the unbound /storage static app.',
);
assert.equal(
  fs.existsSync(path.join(root, 'public/storage')),
  false,
  'public/storage must stay removed (inventory went native).',
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
