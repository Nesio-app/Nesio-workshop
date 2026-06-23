import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const routePath = 'app/secretary/[[...path]]/route.ts';
const packageJson = JSON.parse(read('package.json'));

assert.equal(existsSync(join(root, 'public', 'secretary', 'index.html')), true, 'V14 Secretary static app must be bundled for the active 智友 route.');
assert.equal(existsSync(join(root, 'tools', 'secretary', 'index.html')), true, 'Secretary source must remain available for the static bundle.');
assert.equal(existsSync(join(root, routePath)), true, 'secretary server route must remain as a fallback for non-static lab paths.');

const route = read(routePath);

assert.match(route, /isSecretaryPageRequestAllowed/, 'fallback server route must keep the existing secretary page gate.');
assert.match(route, /tools['"],\s*['"]secretary/, 'fallback server route must serve from tools/secretary if middleware does not handle the static route.');
assert.match(route, /launchUnavailablePayload\('page:secretary'/, 'fallback server route must fail closed when explicitly reached without lab access.');
assert.match(route, /status:\s*403/, 'fallback server route must return 403 when explicitly reached without lab access.');
assert.match(route, /index\.html/, 'server route must default /secretary to the lab list page.');
assert.match(route, /Content-Type/, 'server route must set content type for served lab assets.');
assert.doesNotMatch(route, /writeFile|rmSync|cpSync|mkdirSync/, 'server route must not write files or copy assets at runtime.');

assert.equal(
  packageJson.scripts['test:secretary-lab-server-route'],
  'node scripts/secretary-lab-server-route.test.mjs',
  'package.json must expose secretary lab server route test.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:secretary-lab-server-route/,
  'test:contracts must include secretary lab server route coverage.',
);

console.log('secretary lab server route tests passed');
