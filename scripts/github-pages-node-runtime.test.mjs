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
  /require\(['"]node:sqlite['"]\)|import\(['"]node:sqlite['"]\)/,
  'server-side data APIs may use node:sqlite only through runtime lazy loading.',
);
assert.doesNotMatch(
  `${decDataApi}\n${moduleDataNetworkDb}`,
  /import\s+\{?\s*DatabaseSync[\s\S]{0,80}from ['"]node:sqlite['"]/,
  'server-side data APIs must not statically import node:sqlite during Next page data collection.',
);

const nodeVersionMatch = workflow.match(/node-version:\s*['"]?(\d+)/);
assert.ok(nodeVersionMatch, 'release workflow must pin an explicit Node version.');
assert.ok(
  Number(nodeVersionMatch[1]) >= 22,
  'release workflow must use Node 22+ for runtime sqlite support when DB mode is enabled.',
);
assert.match(
  workflow,
  /pull_request:\s*\n\s*branches:\s*\[main\]/,
  'release verification must run on PRs to main so runtime/build regressions are visible before merge.',
);
assert.doesNotMatch(
  workflow,
  /actions\/deploy-pages|actions\/upload-pages-artifact/,
  'server-runtime builds must not be deployed through GitHub Pages; use Vercel for runtime APIs.',
);
assert.doesNotMatch(
  workflow,
  /Build .*static export/i,
  'workflow must not describe the runtime build as a static export.',
);
assert.match(
  workflow,
  /run:\s*npm run bundle:toolbox[\s\S]*?run:\s*npm run test:security/,
  'release workflow must generate toolbox static config before security prechecks read public tool assets.',
);
assert.equal(
  packageJson.scripts['test:github-pages-node-runtime'],
  'node scripts/github-pages-node-runtime.test.mjs',
  'package.json must expose the release Node/runtime regression test.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:release-contracts[\s\S]*test:github-pages-node-runtime/,
  'test:security must include release contracts before GitHub Pages Node runtime coverage.',
);
assert.match(
  packageJson.scripts['test:security'],
  /test:github-pages-node-runtime/,
  'test:security must include GitHub Pages Node runtime coverage.',
);

console.log('github pages node runtime tests passed');
