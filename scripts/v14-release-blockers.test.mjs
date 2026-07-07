import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const middleware = readFileSync(join(root, 'middleware.ts'), 'utf8');
const bundler = readFileSync(join(root, 'scripts', 'bundle-toolbox.mjs'), 'utf8');
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
// AI 好友(secretary)模块已解绑,相关回归断言随组件一并移除
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// secretary(智友)模块已解绑:middleware 不得再出现 secretary 网关
assert.doesNotMatch(
  middleware,
  /secretary/i,
  'Middleware must not reference the unbound secretary module.',
);

assert.match(
  bundler,
  /ensureStaticAppBaseHref[\s\S]*base href="\$\{baseHref\}"/,
  'Static toolbox bundle must inject a scoped base href so /adhd-flow loads /adhd-flow assets.',
);

assert.match(
  bundler,
  /href\|src\)="\\\/\(app\\\.js\|config\\\.js\|styles\\\.css/,
  'Static toolbox bundle must rewrite root-relative local asset URLs into the module public path.',
);

assert.match(
  css,
  /\.portal-bottom-nav\s*\{[\s\S]*?display:\s*none\s*!important;/,
  'V14 must hide the legacy bottom nav on home, toolbox, and AI Friends.',
);

assert.equal(
  pkg.scripts['test:v14-release-blockers'],
  'node scripts/v14-release-blockers.test.mjs',
  'package.json must expose test:v14-release-blockers.',
);

const tempRoot = mkdtempSync(join(tmpdir(), 'baohe-v14-blockers-'));
try {
  execFileSync('node', [join(root, 'scripts', 'bundle-toolbox.mjs'), '--out-dir', tempRoot], {
    cwd: root,
    stdio: 'pipe',
  });
  // 静态 /storage/ 已解绑:公共 bundle 不得再产出它
  assert.equal(existsSync(join(tempRoot, 'storage')), false, 'Unbound storage app must not be emitted by the public bundle.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('V14 release blocker regression checks passed');
