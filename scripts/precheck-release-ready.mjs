import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const releaseReadyUrl = (process.env.BAOHE_RELEASE_READY_URL || 'https://www.nesio.app').replace(/\/$/, '');
const fallbackQaUrl = 'https://treasurebox-nu.vercel.app';

function runNodeScript(scriptName, args = [], env = {}) {
  const result = spawnSync(process.execPath, [join(scriptDir, scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const releaseStatusResult = runNodeScript('report-release-status.mjs');
const releaseStatus = parseJson(releaseStatusResult.stdout) || {};
const domainRoutingResult = runNodeScript('precheck-domain-routing.mjs', [releaseReadyUrl], {
  BAOHE_DOMAIN_PRECHECK_URL: releaseReadyUrl,
});
const domainRouting =
  parseJson(domainRoutingResult.stdout) || parseJson(domainRoutingResult.stderr) || {
    ok: false,
    rawOutput: `${domainRoutingResult.stdout}${domainRoutingResult.stderr}`.trim(),
  };

const ok = releaseStatusResult.status === 0 && domainRoutingResult.status === 0 && domainRouting.ok === true;

const output = {
  ok,
  check: 'release-ready',
  baseUrl: releaseReadyUrl,
  strictCanonical: releaseReadyUrl === 'https://www.nesio.app',
  releaseStatus: {
    version: releaseStatus.version,
    releaseStatus: releaseStatus.releaseStatus,
    canonicalDomain: releaseStatus.canonicalDomain,
    canonicalDomainStatus: releaseStatus.canonicalDomainStatus || 'blocked_by_dns',
    fallbackQaDomain: releaseStatus.fallbackQaDomain || fallbackQaUrl,
    fallbackDomainStatus: releaseStatus.fallbackDomainStatus,
    appStoreSubmissionReady: releaseStatus.appStoreSubmissionReady,
    testFlightSubmissionReady: releaseStatus.testFlightSubmissionReady,
  },
  domainRouting,
  nextAction: ok
    ? 'Release-ready precheck passed for the selected URL. Continue QA evidence review before public release.'
    : releaseReadyUrl === 'https://www.nesio.app'
      ? 'Canonical release is not ready. Fix DNS for www.nesio.app, then rerun npm run precheck:release-ready.'
      : 'Selected release-ready URL did not pass. Check the Vercel deployment and production health endpoint.',
  fallbackQaCommand: `BAOHE_RELEASE_READY_URL=${fallbackQaUrl} npm run precheck:release-ready`,
};

const stream = ok ? process.stdout : process.stderr;
stream.write(`${JSON.stringify(output, null, 2)}\n`);

if (!ok) {
  process.exit(1);
}
