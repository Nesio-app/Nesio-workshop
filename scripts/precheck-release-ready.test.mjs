import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const scriptPath = join(root, 'scripts', 'precheck-release-ready.mjs');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const script = readFileSync(scriptPath, 'utf8');

assert.equal(
  packageJson.scripts['precheck:release-ready'],
  'node scripts/precheck-release-ready.mjs',
  'package.json must expose precheck:release-ready',
);
assert.equal(
  packageJson.scripts['test:release-ready-precheck'],
  'node scripts/precheck-release-ready.test.mjs',
  'package.json must expose test:release-ready-precheck',
);

for (const marker of [
  'release-ready',
  'BAOHE_RELEASE_READY_URL',
  'https://www.nesio.app',
  'report-release-status.mjs',
  'precheck-domain-routing.mjs',
  'canonicalDomainStatus',
  'blocked_by_dns',
  'treasurebox-nu.vercel.app',
  'process.exit(1)',
]) {
  assert.ok(script.includes(marker), `missing release-ready precheck marker: ${marker}`);
}

console.log('release-ready precheck contract passed');
