import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();

const runtimeScanTargets = [
  'app',
  'components',
  'lib',
  'scripts',
  'public',
  'storage-web',
  'package.json',
  'next.config.js',
  'next.config.mjs',
  'middleware.ts',
  'tsconfig.json',
].filter((target) => existsSync(join(repoRoot, target)));

const allowedReferenceFiles = new Set([
  'docs/repository-boundary-cleanup.md',
  'README.md',
  'scripts/report-repository-boundaries.mjs',
]);

function read(file) {
  const path = join(repoRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function rg(args) {
  try {
    const output = execFileSync('rg', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function parseGitmodules(raw) {
  const modules = [];
  let current = null;
  for (const line of raw.split('\n')) {
    const header = line.match(/^\[submodule "([^"]+)"\]/);
    if (header) {
      current = { name: header[1], path: '', url: '' };
      modules.push(current);
      continue;
    }
    if (!current) continue;
    const path = line.match(/^\s*path = (.+)$/);
    if (path) current.path = path[1].trim();
    const url = line.match(/^\s*url = (.+)$/);
    if (url) current.url = url[1].trim();
  }
  return modules;
}

const rawRuntimeReferences = rg([
  '-n',
  'memory/|from [\'"]\\.\\.?/memory|from [\'"]memory|require\\([\'"]\\.\\.?/memory|@/memory|/memory',
  ...runtimeScanTargets,
]);

const runtimeReferences = rawRuntimeReferences
  .map((line) => {
    const [file] = line.split(':');
    return { file, line };
  })
  .filter((entry) => !allowedReferenceFiles.has(entry.file));

const workflowPath = '.github/workflows/deploy.yml';
const workflow = read(workflowPath);
const deploymentReferences = [];
if (/memory\/public/.test(workflow) || /out\/memory/.test(workflow)) {
  deploymentReferences.push({
    file: workflowPath,
    kind: 'github_pages_memory_bundle',
    status: 'needs_decision',
    reason: 'GitHub Pages workflow still publishes memory/public to out/memory.',
  });
}
if (/adhd-flow-ios\/web/.test(workflow) || /fitness\/web/.test(workflow)) {
  deploymentReferences.push({
    file: workflowPath,
    kind: 'github_pages_sandbox_tool_bundle',
    status: 'needs_decision',
    reason: 'GitHub Pages workflow still bundles sandbox tool surfaces outside the current launch SKU.',
  });
}

const memoryIndicators = [
  'memory/package.json',
  'memory/next.config.js',
  'memory/middleware.ts',
  'memory/prisma/schema.prisma',
  'memory/DEPLOY.md',
].filter((file) => existsSync(join(repoRoot, file)));

const submodules = parseGitmodules(read('.gitmodules'));

const report = {
  version: 'repository-boundary-report-v0',
  status: runtimeReferences.length === 0 && deploymentReferences.length === 0 ? 'pass' : 'needs_decision',
  boundaries: {
    noRuntimeDependencyOnMemory: runtimeReferences.length === 0,
    memoryIndependentAppShape: memoryIndicators.length >= 3,
    doesNotModifyMemory: true,
    doesNotModifySubmodules: true,
    doesNotChangeDeployment: true,
  },
  memory: {
    path: 'memory',
    independentAppIndicators: memoryIndicators,
    runtimeReferenceCount: runtimeReferences.length,
    runtimeReferences,
    recommendedNextAction: runtimeReferences.length === 0
      ? 'Decide whether memory becomes separate repo, submodule, archive, or explicitly excluded legacy surface.'
      : 'Remove runtime references before moving or archiving memory.',
  },
  submodules: {
    count: submodules.length,
    entries: submodules,
    policy: {
      updateAllCasuallyBeforeRelease: false,
      requiresIntentionalReason: true,
      launchSurfaceImpliedBySubmodule: false,
    },
  },
  deploymentReferences,
  ceoGateRequiredFor: [
    'deleting memory',
    'migrating memory data',
    'changing memory deployment availability',
    'changing public GitHub Pages surface',
    'moving real user data or external auth',
  ],
};

console.log(JSON.stringify(report, null, 2));
