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

function git(args) {
  try {
    const output = execFileSync('git', args, {
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

function gitStatusShort() {
  try {
    const output = execFileSync('git', ['status', '--short'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function gitDiffNumstat() {
  try {
    const output = execFileSync('git', ['diff', '--numstat'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function parseNumstatCount(value) {
  return value === '-' ? 0 : Number(value);
}

function getTrackedDirtyDiffStats() {
  return Object.fromEntries(
    gitDiffNumstat().map((line) => {
      const [added, removed, file] = line.split('\t');
      const addedLineCount = parseNumstatCount(added);
      const removedLineCount = parseNumstatCount(removed);
      return [
        file,
        {
          addedLineCount,
          removedLineCount,
          diffLineCount: addedLineCount + removedLineCount,
        },
      ];
    }),
  );
}

function classifyTrackedDirtyFile(file) {
  if (/^(components|app|public|storage-web)\//.test(file)) {
    return {
      category: 'ui_or_runtime_surface',
      releaseRisk: 'review_before_release',
      recommendedNextAction: 'Inspect as a user-visible or runtime behavior change; commit only with focused QA evidence or restore after owner approval.',
    };
  }
  if (/^lib\/portal\//.test(file)) {
    return {
      category: 'portal_contract_or_runtime',
      releaseRisk: 'contract_review_required',
      recommendedNextAction: 'Verify affected report/runtime contracts before committing; do not bundle with unrelated UI changes.',
    };
  }
  if (/^(scripts|e2e)\//.test(file)) {
    return {
      category: 'verification_tooling',
      releaseRisk: 'low_if_tests_pass',
      recommendedNextAction: 'Run the relevant test command and commit as a focused verification-tooling change.',
    };
  }
  if (/^(docs|outputs)\//.test(file)) {
    return {
      category: 'artifact_or_documentation',
      releaseRisk: 'documentation_review',
      recommendedNextAction: 'Confirm the artifact is intentional evidence before committing.',
    };
  }
  return {
    category: 'unclassified_tracked_change',
    releaseRisk: 'needs_owner_review',
    recommendedNextAction: 'Inspect the diff and assign an owner before committing or restoring.',
  };
}

function countBy(entries, key) {
  return entries.reduce((counts, entry) => {
    counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
    return counts;
  }, {});
}

function countDuplicateNoiseByTopLevel(files) {
  return files.reduce((counts, file) => {
    const [topLevel] = file.split('/');
    counts[topLevel] = (counts[topLevel] ?? 0) + 1;
    return counts;
  }, {});
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

function detectLocalDuplicateNoise() {
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  const duplicateNoiseFiles = untracked.filter((file) => /(?:^|\/)[^/]+ \d+\.[^/]+$/.test(file));
  const trackedDirtyDiffStats = getTrackedDirtyDiffStats();
  const trackedDirtyFiles = gitStatusShort()
    .filter((line) => !line.startsWith('??') && !line.startsWith('!!'))
    .map((line) => {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      return {
        status,
        file,
        ...(trackedDirtyDiffStats[file] ?? {
          addedLineCount: 0,
          removedLineCount: 0,
          diffLineCount: 0,
        }),
        ...classifyTrackedDirtyFile(file),
      };
    });
  const trackedDirtyByCategory = countBy(trackedDirtyFiles, 'category');
  const trackedDirtyByReleaseRisk = countBy(trackedDirtyFiles, 'releaseRisk');
  const hasLocalHygieneNoise = duplicateNoiseFiles.length > 0 || trackedDirtyFiles.length > 0;
  return {
    duplicateNoisePattern: 'space-number-copy',
    localDuplicateNoiseCount: duplicateNoiseFiles.length,
    localDuplicateNoiseFiles: duplicateNoiseFiles,
    duplicateNoiseSummary: {
      cleanupCandidateCount: duplicateNoiseFiles.length,
      byTopLevel: countDuplicateNoiseByTopLevel(duplicateNoiseFiles),
      cleanupPolicy: 'explicit_owner_approval_required',
      destructiveCleanupPerformed: false,
    },
    trackedDirtyFileCount: trackedDirtyFiles.length,
    trackedDirtySummary: {
      byCategory: trackedDirtyByCategory,
      byReleaseRisk: trackedDirtyByReleaseRisk,
      uiOrRuntimeSurfaceCount: trackedDirtyByCategory.ui_or_runtime_surface ?? 0,
      reviewBeforeReleaseCount: trackedDirtyByReleaseRisk.review_before_release ?? 0,
    },
    trackedDirtyFiles,
    trackedDirtyPolicy: 'report_only_no_restore',
    status: hasLocalHygieneNoise ? 'needs_local_cleanup' : 'clean',
    readOnly: true,
    recommendedNextAction: hasLocalHygieneNoise
      ? 'Review duplicate copy files and tracked dirty files separately; delete or restore only after explicit owner approval.'
      : 'No local duplicate copy files detected.',
  };
}

const submoduleClassification = {
  'storage-ios': {
    state: 'active_launch_dependency',
    launchSurface: 'inventory_lineage_only',
  },
  'psych-tool-ios': {
    state: 'contract_reference',
    launchSurface: 'not_public_launch_surface',
  },
  'questionbank-ios': {
    state: 'sandbox_reference',
    launchSurface: 'not_public_launch_surface',
  },
  'reading-ios': {
    state: 'sandbox_reference',
    launchSurface: 'not_public_launch_surface',
  },
  'weaver-ai': {
    state: 'contract_reference',
    launchSurface: 'not_public_launch_surface',
  },
};

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

const submodules = parseGitmodules(read('.gitmodules')).map((entry) => ({
  ...entry,
  ...(submoduleClassification[entry.path] ?? {
    state: 'unclassified',
    launchSurface: 'not_public_launch_surface',
  }),
}));

const hygiene = detectLocalDuplicateNoise();
const boundaryBlockers = [];
if (runtimeReferences.length > 0) boundaryBlockers.push('memory_runtime_references_present');
if (deploymentReferences.length > 0) boundaryBlockers.push('deployment_references_need_decision');
const localHygieneBlockers = [];
if (hygiene.localDuplicateNoiseCount > 0 || hygiene.trackedDirtyFileCount > 0) {
  localHygieneBlockers.push('local_hygiene_needs_cleanup');
}

const report = {
  version: 'repository-boundary-report-v0',
  status: boundaryBlockers.length === 0 ? 'pass' : 'needs_decision',
  releaseReadiness: {
    ready: boundaryBlockers.length === 0 && localHygieneBlockers.length === 0,
    contractStatus: boundaryBlockers.length === 0 ? 'pass' : 'needs_decision',
    localHygieneStatus: hygiene.status,
    blockers: [...boundaryBlockers, ...localHygieneBlockers],
    recommendedNextAction: localHygieneBlockers.length > 0
      ? 'Do not treat this local checkout as release-ready until duplicate copy files and tracked dirty files are reviewed or cleaned.'
      : 'Repository boundary report has no local hygiene blockers.',
  },
  boundaries: {
    noRuntimeDependencyOnMemory: runtimeReferences.length === 0,
    memoryIndependentAppShape: memoryIndicators.length >= 3,
    doesNotModifyMemory: true,
    doesNotModifySubmodules: true,
    doesNotChangeDeployment: true,
    doesNotDeleteLocalNoise: hygiene.readOnly,
    doesNotRestoreTrackedDirtyFiles: hygiene.trackedDirtyPolicy === 'report_only_no_restore',
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
    doctorCommand: 'npm run doctor:submodules',
    initCommand: 'git submodule update --init --recursive',
    policy: {
      updateAllCasuallyBeforeRelease: false,
      requiresIntentionalReason: true,
      launchSurfaceImpliedBySubmodule: false,
      migrateAllToTurborepoNow: false,
    },
  },
  hygiene,
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
