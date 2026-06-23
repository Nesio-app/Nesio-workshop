import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const artifactDir = resolve(process.argv[2] || 'release-evidence');
const jsonPath = resolve(artifactDir, 'release-evidence.json');
const markdownPath = resolve(artifactDir, 'release-evidence.md');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireFile(path) {
  if (!existsSync(path)) {
    fail(`Missing required release evidence artifact file: ${path}`);
  }
}

requireFile(jsonPath);
requireFile(markdownPath);

let evidence;
try {
  evidence = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (error) {
  fail(`Invalid release-evidence.json: ${error.message}`);
}

const markdown = readFileSync(markdownPath, 'utf8');

const checks = [
  [evidence.version === 'release-evidence-v0', 'release-evidence.json must use release-evidence-v0.'],
  [evidence.releaseStatus?.canonicalDomain === 'https://www.nesio.app', 'canonical domain must be www.nesio.app.'],
  [
    evidence.releaseStatus?.canonicalDomainStatus === 'blocked_by_dns',
    'canonical domain must remain marked blocked_by_dns until public release precheck passes.',
  ],
  [
    evidence.releaseStatus?.fallbackQaDomain === 'https://treasurebox-nu.vercel.app',
    'fallback QA domain must be treasurebox-nu.vercel.app.',
  ],
  [evidence.decision?.publicReleaseReady === false, 'publicReleaseReady must be false before canonical DNS passes.'],
  [evidence.decision?.fallbackQaReady === true, 'fallbackQaReady must be true for Ming QA handoff.'],
  [
    evidence.decision?.needsCeoGateForPublicRelease === true,
    'needsCeoGateForPublicRelease must stay true for public release.',
  ],
  [
    Array.isArray(evidence.blockers) && evidence.blockers.length > 0,
    'release evidence must include at least one blocker while canonical DNS is unresolved.',
  ],
  [
    evidence.evidenceCommands?.includes('gh run download <run-id> --name release-evidence --dir release-evidence'),
    'release evidence must include the CI artifact download command.',
  ],
  [/Baohe Release Evidence v0/.test(markdown), 'release-evidence.md must include the evidence title.'],
  [/Public release ready: false/.test(markdown), 'release-evidence.md must keep public release marked false.'],
  [/Fallback QA ready: true/.test(markdown), 'release-evidence.md must keep fallback QA marked true.'],
  [
    /gh run download <run-id> --name release-evidence --dir release-evidence/.test(markdown),
    'release-evidence.md must include the artifact download command.',
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    fail(message);
  }
}

console.log('release evidence artifact verification passed');
console.log(`- ${jsonPath}`);
console.log(`- ${markdownPath}`);
