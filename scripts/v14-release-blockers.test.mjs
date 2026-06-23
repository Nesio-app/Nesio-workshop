import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const middleware = readFileSync(join(root, 'middleware.ts'), 'utf8');
const bundler = readFileSync(join(root, 'scripts', 'bundle-toolbox.mjs'), 'utf8');
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
const aiFriends = readFileSync(join(root, 'components', 'portal', 'PortalAiFriendsPreview.tsx'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  middleware,
  /pathname === '\/secretary'[\s\S]{0,320}\/secretary\/index\.html/,
  'V14 Secretary must have a direct page rewrite instead of showing the first-launch 403 gate.',
);

assert.match(
  middleware,
  /pathname === '\/secretary\/chat'[\s\S]{0,220}\/secretary\/chat\.html/,
  'V14 Secretary chat must rewrite to the static chat page.',
);

assert.ok(
  middleware.includes("/^\\/secretary\\/[^?]+\\.(?:css|js|json|svg|png|jpg|jpeg|webp|ico)$/i.test(pathname)") &&
    middleware.includes('return NextResponse.next();'),
  'V14 Secretary static assets must bypass the first-launch page gate.',
);

assert.match(
  middleware,
  /pathname === '\/adhd-flow'[\s\S]{0,320}\/adhd-flow\/index\.html/,
  'V14 ADHD Flow must have a direct static app rewrite so extensionless URLs keep assets scoped.',
);

assert.match(
  bundler,
  /moduleId === 'secretary'[\s\S]{0,180}return true/,
  'V14 toolbox bundle must include the Secretary static app because 智友 is an active runtime route.',
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

assert.match(
  aiFriends,
  /setCallSheetOpen\(true\);[\s\S]{0,220}if \(!readiness\.ready\)/,
  'AI Friends video/live call button must open a visible surface even when provider readiness is degraded.',
);

assert.match(
  aiFriends,
  /setAudioCallOpen\(true\);[\s\S]{0,220}if \(!readiness\.ready\)/,
  'AI Friends audio call button must open a visible surface even when provider readiness is degraded.',
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
  const adhdHtml = readFileSync(join(tempRoot, 'adhd-flow', 'index.html'), 'utf8');
  const secretaryHtml = readFileSync(join(tempRoot, 'secretary', 'index.html'), 'utf8');
  assert.match(adhdHtml, /<base href="\/adhd-flow\/">/, 'ADHD Flow bundle must include scoped base href.');
  assert.doesNotMatch(adhdHtml, /(href|src)="\/(app\.js|config\.js|styles\.css|portal-back\.css|manifest\.json|icon\.svg)"/, 'ADHD Flow bundle must not request local assets from the site root.');
  assert.match(adhdHtml, /href="\/adhd-flow\/styles\.css"/, 'ADHD Flow styles must load from /adhd-flow/styles.css.');
  assert.match(secretaryHtml, /<base href="\/secretary\/">/, 'Secretary bundle must include scoped base href.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('V14 release blocker regression checks passed');
