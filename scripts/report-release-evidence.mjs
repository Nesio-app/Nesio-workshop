import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const args = new Set(process.argv.slice(2));

function execText(command, commandArgs, fallback = '') {
  try {
    return execFileSync(command, commandArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 20,
    }).trim();
  } catch {
    return fallback;
  }
}

function readReleaseStatus() {
  const output = execText('node', [join(scriptDir, 'report-release-status.mjs')], '{}');
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

// 分支名:CI 的 actions/checkout 在 PR 事件下是 detached HEAD,`git branch --show-current`
// 返回空串(exit 0,'unknown' 兜底不触发)→ 契约的 branch.length>0 在 PR 构建里挂。
// 回退:当前分支 → CI 环境变量(PR 源分支/推送分支)→ detached 时 abbrev-ref('HEAD')→ unknown。
function resolveBranch() {
  return (
    execText('git', ['branch', '--show-current']) ||
    (process.env.GITHUB_HEAD_REF || '').trim() ||
    (process.env.GITHUB_REF_NAME || '').trim() ||
    execText('git', ['rev-parse', '--abbrev-ref', 'HEAD']) ||
    'unknown'
  );
}

function readGitState() {
  return {
    branch: resolveBranch(),
    commit: execText('git', ['rev-parse', '--short', 'HEAD'], 'unknown'),
    dirty: execText('git', ['status', '--short'], '').length > 0,
  };
}

function buildReleaseEvidence(releaseStatus = readReleaseStatus()) {
  const fallbackQaDomain = releaseStatus.fallbackQaDomain || 'https://treasurebox-nu.vercel.app';
  const canonicalDomain = releaseStatus.canonicalDomain || 'https://www.nesio.app';
  const blockers =
    Array.isArray(releaseStatus.blockers) && releaseStatus.blockers.length > 0
      ? releaseStatus.blockers
      : ['Canonical domain DNS is not verified for Vercel production routing.'];

  return {
    version: 'release-evidence-v0',
    generatedFrom: ['report-release-status.mjs', 'precheck-release-ready.mjs'],
    git: readGitState(),
    releaseStatus: {
      version: releaseStatus.version || 'release-status-v0',
      releaseStatus: releaseStatus.releaseStatus || 'qa_ready_on_fallback_domain',
      launchScope: releaseStatus.launchScope || 'Shell + Inventory / purchase-memory + Todo',
      canonicalDomain,
      canonicalDomainStatus: releaseStatus.canonicalDomainStatus || 'blocked_by_dns',
      fallbackQaDomain,
      fallbackDomainStatus: releaseStatus.fallbackDomainStatus || 'ready_for_qa',
      appStoreSubmissionReady: releaseStatus.appStoreSubmissionReady === true,
      testFlightSubmissionReady: releaseStatus.testFlightSubmissionReady === true,
    },
    decision: {
      publicReleaseReady: false,
      fallbackQaReady: releaseStatus.fallbackDomainStatus === 'ready_for_qa',
      needsCeoGateForPublicRelease: true,
      requiredBeforePublicRelease: [
        'npm run precheck:release-ready',
        'DNS: A www.nesio.app 76.76.21.21 or Vercel nameservers',
        'Ming QA evidence review',
        'CEO approval before public release/TestFlight/App Store',
      ],
    },
    evidenceCommands: [
      'npm run test:security',
      'npm run build',
      'npm run report:release-status',
      'npm run precheck:release-ready',
      `BAOHE_RELEASE_READY_URL=${fallbackQaDomain} npm run precheck:release-ready`,
      `BAOHE_CANARY_BASE_URL=${fallbackQaDomain} npm run canary:production-runtime`,
      'gh run list --branch main --limit 3',
      'gh run download <run-id> --name release-evidence --dir release-evidence',
      'npm run verify:release-evidence-artifact -- release-evidence',
    ],
    blockers,
    handoff: {
      to: 'Ming QA',
      reason: 'Release evidence is ready for fallback-domain QA review while canonical DNS remains blocked.',
      blocker: blockers.join(' '),
    },
  };
}

function renderMarkdown(evidence) {
  return [
    '# Baohe Release Evidence v0',
    '',
    `Public release ready: ${evidence.decision.publicReleaseReady}`,
    `Fallback QA ready: ${evidence.decision.fallbackQaReady}`,
    `CEO gate needed for public release: ${evidence.decision.needsCeoGateForPublicRelease}`,
    '',
    '## Domains',
    '',
    `- Canonical: ${evidence.releaseStatus.canonicalDomain} (${evidence.releaseStatus.canonicalDomainStatus})`,
    `- Fallback QA: ${evidence.releaseStatus.fallbackQaDomain} (${evidence.releaseStatus.fallbackDomainStatus})`,
    '',
    '## Git',
    '',
    `- Branch: ${evidence.git.branch}`,
    `- Commit: ${evidence.git.commit}`,
    `- Dirty worktree: ${evidence.git.dirty}`,
    '',
    '## Evidence Commands',
    '',
    ...evidence.evidenceCommands.map((command) => `- \`${command}\``),
    '',
    '## Required Before Public Release',
    '',
    ...evidence.decision.requiredBeforePublicRelease.map((item) => `- ${item}`),
    '',
    '## Blockers',
    '',
    ...evidence.blockers.map((blocker) => `- ${blocker}`),
    '',
  ].join('\n');
}

const evidence = buildReleaseEvidence();

if (args.has('--markdown')) {
  console.log(renderMarkdown(evidence));
} else {
  console.log(JSON.stringify(evidence, null, 2));
}

export { buildReleaseEvidence, renderMarkdown };
