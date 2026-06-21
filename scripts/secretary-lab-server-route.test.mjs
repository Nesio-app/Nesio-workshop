import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const routePath = 'app/secretary/[[...path]]/route.ts';
const packageJson = JSON.parse(read('package.json'));

assert.equal(existsSync(join(root, 'public', 'secretary')), false, 'secretary must remain outside public static assets.');
assert.equal(existsSync(join(root, 'tools', 'secretary', 'index.html')), true, 'gated secretary source must remain available.');
assert.equal(existsSync(join(root, routePath)), true, 'secretary must have a server-gated route for lab access.');

const route = read(routePath);

assert.match(route, /isSecretaryPageRequestAllowed/, 'server route must use the existing secretary page gate.');
assert.match(route, /tools['"],\s*['"]secretary/, 'server route must serve from tools/secretary, not public/secretary.');
assert.match(route, /launchUnavailablePayload\('page:secretary'/, 'server route must fail closed for public visitors.');
assert.match(route, /status:\s*403/, 'server route must return 403 for public visitors.');
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
