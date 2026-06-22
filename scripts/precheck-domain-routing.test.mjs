import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const script = readFileSync(join(root, 'scripts', 'precheck-domain-routing.mjs'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const marker of [
  'BAOHE_DOMAIN_PRECHECK_URL',
  'https://www.nesio.app',
  '/api/portal/production/health',
  'A www.nesio.app 76.76.21.21',
  'ns1.vercel-dns.com',
  'ns2.vercel-dns.com',
  'domain-routing',
  'x-matched-path',
  'Vercel',
  'process.exit(1)',
]) {
  assert.ok(script.includes(marker), `missing domain routing precheck marker: ${marker}`);
}

assert.equal(
  packageJson.scripts['precheck:domain-routing'],
  'node scripts/precheck-domain-routing.mjs',
  'package.json must expose precheck:domain-routing',
);
assert.equal(
  packageJson.scripts['test:domain-routing-precheck'],
  'node scripts/precheck-domain-routing.test.mjs',
  'package.json must expose test:domain-routing-precheck',
);

console.log('domain routing precheck contract passed');
