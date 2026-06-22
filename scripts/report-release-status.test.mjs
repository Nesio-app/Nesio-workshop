import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.equal(
  packageJson.scripts['report:release-status'],
  'node scripts/report-release-status.mjs',
  'package.json must expose report:release-status',
);
assert.equal(
  packageJson.scripts['test:release-status-report'],
  'node scripts/report-release-status.test.mjs',
  'package.json must expose test:release-status-report',
);

const output = execFileSync('node', [join(scriptDir, 'report-release-status.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const status = JSON.parse(output);

assert.equal(status.version, 'release-status-v0');
assert.equal(status.canonicalDomain, 'https://www.nesio.app');
assert.equal(status.fallbackQaDomain, 'https://treasurebox-nu.vercel.app');
assert.equal(status.launchScope, 'Shell + Inventory / purchase-memory + Todo');
assert.equal(status.releaseStatus, 'qa_ready_on_fallback_domain');
assert.equal(status.canonicalDomainStatus, 'blocked_by_dns');
assert.equal(status.fallbackDomainStatus, 'ready_for_qa');
assert.equal(status.appStoreSubmissionReady, false);
assert.equal(status.testFlightSubmissionReady, false);
assert.equal(status.needsCeoGateForPublicRelease, true);
assert.equal(status.commands.canonicalDomainPrecheck, 'npm run precheck:domain-routing');
assert.equal(
  status.commands.fallbackDomainPrecheck,
  'BAOHE_DOMAIN_PRECHECK_URL=https://treasurebox-nu.vercel.app npm run precheck:domain-routing',
);
assert.equal(
  status.commands.fallbackRuntimeCanary,
  'BAOHE_CANARY_BASE_URL=https://treasurebox-nu.vercel.app npm run canary:production-runtime',
);
assert.equal(status.blockers.includes('DNS for www.nesio.app still routes outside Vercel until the A record or Vercel nameservers are changed.'), true);
assert.equal(status.noExternalSideEffects, true);
assert.equal(status.git.branch.length > 0, true);
assert.equal(typeof status.git.commit, 'string');

const markdown = execFileSync('node', [join(scriptDir, 'report-release-status.mjs'), '--markdown'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});

assert.match(markdown, /Baohe Release Status v0/);
assert.match(markdown, /qa_ready_on_fallback_domain/);
assert.match(markdown, /blocked_by_dns/);
assert.match(markdown, /treasurebox-nu\.vercel\.app/);

console.log('release status report tests passed');
