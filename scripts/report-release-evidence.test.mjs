import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.equal(
  packageJson.scripts['report:release-evidence'],
  'node scripts/report-release-evidence.mjs',
  'package.json must expose report:release-evidence',
);
assert.equal(
  packageJson.scripts['test:release-evidence-report'],
  'node scripts/report-release-evidence.test.mjs',
  'package.json must expose test:release-evidence-report',
);

const output = execFileSync('node', [join(scriptDir, 'report-release-evidence.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const evidence = JSON.parse(output);

assert.equal(evidence.version, 'release-evidence-v0');
assert.equal(evidence.releaseStatus.version, 'release-status-v0');
assert.equal(evidence.releaseStatus.canonicalDomain, 'https://www.nesio.app');
assert.equal(evidence.releaseStatus.canonicalDomainStatus, 'blocked_by_dns');
assert.equal(evidence.releaseStatus.fallbackQaDomain, 'https://treasurebox-nu.vercel.app');
assert.equal(evidence.decision.publicReleaseReady, false);
assert.equal(evidence.decision.fallbackQaReady, true);
assert.equal(evidence.decision.requiredBeforePublicRelease.includes('npm run precheck:release-ready'), true);
assert.equal(evidence.evidenceCommands.includes('npm run test:security'), true);
assert.equal(evidence.evidenceCommands.includes('npm run build'), true);
assert.equal(
  evidence.evidenceCommands.includes('BAOHE_RELEASE_READY_URL=https://treasurebox-nu.vercel.app npm run precheck:release-ready'),
  true,
);
assert.equal(evidence.blockers.length > 0, true);
assert.equal(evidence.git.branch.length > 0, true);
assert.equal(typeof evidence.git.commit, 'string');

const markdown = execFileSync('node', [join(scriptDir, 'report-release-evidence.mjs'), '--markdown'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});

assert.match(markdown, /Baohe Release Evidence v0/);
assert.match(markdown, /Public release ready: false/);
assert.match(markdown, /Fallback QA ready: true/);
assert.match(markdown, /www\.nesio\.app/);

console.log('release evidence report tests passed');
