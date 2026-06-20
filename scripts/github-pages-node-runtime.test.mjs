import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const workflow = read('.github/workflows/deploy.yml');
const decDataApi = read('lib/portal/dec-data-api.mjs');
const moduleDataNetworkDb = read('lib/portal/module-data-network-db.mjs');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  `${decDataApi}\n${moduleDataNetworkDb}`,
  /node:sqlite/,
  'server-side data APIs currently use node:sqlite and require a Node runtime that supports it.',
);

const nodeVersionMatch = workflow.match(/node-version:\s*['"]?(\d+)/);
assert.ok(nodeVersionMatch, 'GitHub Pages deploy workflow must pin an explicit Node version.');
assert.ok(
  Number(nodeVersionMatch[1]) >= 22,
  'GitHub Pages deploy workflow must use Node 22+ while build-time routes import node:sqlite.',
);
assert.equal(
  packageJson.scripts['test:github-pages-node-runtime'],
  'node scripts/github-pages-node-runtime.test.mjs',
  'package.json must expose the GitHub Pages Node runtime regression test.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:github-pages-node-runtime/,
  'test:security must include GitHub Pages Node runtime coverage.',
);

console.log('github pages node runtime tests passed');
