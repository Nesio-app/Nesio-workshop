import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const args = new Set(process.argv.slice(2));

function execText(command, args, fallback = '') {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 20,
    }).trim();
  } catch {
    return fallback;
  }
}

function readLaunchReadiness() {
  const output = execText('node', [join(scriptDir, 'report-launch-readiness-summary.mjs')], '{}');
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

function buildReleaseStatus(readiness = readLaunchReadiness()) {
  const branch = execText('git', ['branch', '--show-current'], 'unknown');
  const commit = execText('git', ['rev-parse', '--short', 'HEAD'], 'unknown');
  const dirty = execText('git', ['status', '--short'], '').length > 0;

  const fallbackQaDomain = 'https://treasurebox-nu.vercel.app';
  const canonicalDomain = 'https://www.nesio.app';
  const blocker =
    'DNS for www.nesio.app still routes outside Vercel until the A record or Vercel nameservers are changed.';

  return {
    version: 'release-status-v0',
    generatedFrom: ['report-launch-readiness-summary.mjs', 'domain-routing-runbook.md'],
    launchScope: readiness.firstLaunchPromise || 'Shell + Inventory / purchase-memory + Todo',
    releaseStatus: 'qa_ready_on_fallback_domain',
    canonicalDomain,
    canonicalDomainStatus: 'blocked_by_dns',
    fallbackQaDomain,
    fallbackDomainStatus: 'ready_for_qa',
    appStoreSubmissionReady: false,
    testFlightSubmissionReady: false,
    needsCeoGateForPublicRelease: true,
    noExternalSideEffects: true,
    git: {
      branch,
      commit,
      dirty,
    },
    commands: {
      canonicalDomainPrecheck: 'npm run precheck:domain-routing',
      fallbackDomainPrecheck: `BAOHE_DOMAIN_PRECHECK_URL=${fallbackQaDomain} npm run precheck:domain-routing`,
      fallbackRuntimeCanary: `BAOHE_CANARY_BASE_URL=${fallbackQaDomain} npm run canary:production-runtime`,
      latestGithubRuns: 'gh run list --branch main --limit 3',
      releaseStaticQa: 'npm run test:qa:static',
      releaseBuild: 'npm run build',
    },
    blockers: [blocker],
    nextActions: [
      'Use treasurebox-nu.vercel.app for QA until canonical DNS is fixed.',
      'Update DNS: set A record for www.nesio.app to 76.76.21.21 or move nameservers to Vercel DNS.',
      'Run canonical domain precheck after DNS propagation.',
    ],
    qaEvidenceExpected: [
      'fallback domain precheck passes',
      'production runtime canary passes on fallback domain',
      'GitHub Actions Release Verification passes on main',
    ],
  };
}

function renderMarkdown(status) {
  return [
    '# Baohe Release Status v0',
    '',
    `Release status: ${status.releaseStatus}`,
    `Launch scope: ${status.launchScope}`,
    `Canonical domain: ${status.canonicalDomain} (${status.canonicalDomainStatus})`,
    `Fallback QA domain: ${status.fallbackQaDomain} (${status.fallbackDomainStatus})`,
    `App Store submission ready: ${status.appStoreSubmissionReady}`,
    `TestFlight submission ready: ${status.testFlightSubmissionReady}`,
    `CEO gate needed for public release: ${status.needsCeoGateForPublicRelease}`,
    '',
    '## Git',
    '',
    `Branch: ${status.git.branch}`,
    `Commit: ${status.git.commit}`,
    `Dirty worktree: ${status.git.dirty}`,
    '',
    '## Commands',
    '',
    ...Object.entries(status.commands).map(([key, command]) => `- ${key}: \`${command}\``),
    '',
    '## Blockers',
    '',
    ...status.blockers.map((blocker) => `- ${blocker}`),
    '',
    '## Next Actions',
    '',
    ...status.nextActions.map((action) => `- ${action}`),
    '',
  ].join('\n');
}

const status = buildReleaseStatus();

if (args.has('--markdown')) {
  console.log(renderMarkdown(status));
} else {
  console.log(JSON.stringify(status, null, 2));
}

export { buildReleaseStatus, renderMarkdown };
