import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));

const SUBMODULE_CLASSIFICATION = {
  'storage-ios': {
    state: 'active_launch_dependency',
    launchSurface: 'inventory_lineage_only',
    policyNote: 'Inventory lineage reference. It can inform launch Inventory behavior, but public launch still ships from the main Baohe PWA surface.',
  },
  'psych-tool-ios': {
    state: 'contract_reference',
    launchSurface: 'not_public_launch_surface',
    policyNote: 'High-trust psychology/mental-health adjacent reference. Keep gated and do not treat as first-launch public product.',
  },
  'questionbank-ios': {
    state: 'sandbox_reference',
    launchSurface: 'not_public_launch_surface',
    policyNote: 'Learning sandbox reference. Useful for future module work, but not a release blocker for Shell + Inventory.',
  },
  'reading-ios': {
    state: 'sandbox_reference',
    launchSurface: 'not_public_launch_surface',
    policyNote: 'Reading sandbox reference. Keep available for future learning flow work without exposing it as launch scope.',
  },
  'weaver-ai': {
    state: 'contract_reference',
    launchSurface: 'not_public_launch_surface',
    policyNote: 'AI/strategy module reference. Must remain gated unless CEO-approved product and AI runtime boundaries change.',
  },
};

function read(file) {
  const path = join(repoRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
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
  return modules.filter((entry) => entry.path && entry.url);
}

function hasInitializedGitDir(path) {
  return existsSync(join(repoRoot, path, '.git'));
}

const submodules = parseGitmodules(read('.gitmodules')).map((entry) => {
  const classification = SUBMODULE_CLASSIFICATION[entry.path] ?? {
    state: 'unclassified',
    launchSurface: 'not_public_launch_surface',
    policyNote: 'Unclassified submodule. Add an explicit state before using it as a release dependency.',
  };
  return {
    ...entry,
    ...classification,
    initialized: hasInitializedGitDir(entry.path),
    existsOnDisk: existsSync(join(repoRoot, entry.path)),
  };
});

const missing = submodules.filter((entry) => !entry.existsOnDisk || !entry.initialized);
const unclassified = submodules.filter((entry) => entry.state === 'unclassified');
const activeLaunchDependencyCount = submodules.filter((entry) => entry.state === 'active_launch_dependency').length;

const report = {
  version: 'baohe-submodule-doctor-v0',
  status: missing.length === 0 && unclassified.length === 0 ? 'pass' : 'needs_attention',
  summary: {
    totalSubmoduleCount: submodules.length,
    initializedSubmoduleCount: submodules.length - missing.length,
    missingOrUninitializedCount: missing.length,
    activeLaunchDependencyCount,
    sandboxReferenceCount: submodules.filter((entry) => entry.state === 'sandbox_reference').length,
    contractReferenceCount: submodules.filter((entry) => entry.state === 'contract_reference').length,
    unclassifiedCount: unclassified.length,
    publicLaunchSurfaceImpliedBySubmodule: false,
  },
  policy: {
    shouldMigrateToTurborepoNow: false,
    shouldUseSubmodulesAsLaunchPromise: false,
    updateAllCasuallyBeforeRelease: false,
    recommendedNearTermAction: 'Keep submodules, but require doctor checks and explicit classification before release work.',
  },
  remediation: {
    initCommand: 'git submodule update --init --recursive',
    statusCommand: 'npm run doctor:submodules',
    migrationNote: 'Consider selective migration only after a tool becomes launchable or monetized and shares enough build/runtime code with Baohe.',
  },
  submodules,
};

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Baohe submodule doctor: ${report.status}`);
  console.log(`Submodules: ${report.summary.initializedSubmoduleCount}/${report.summary.totalSubmoduleCount} initialized`);
  for (const entry of submodules) {
    const mark = entry.initialized ? 'ok' : 'missing';
    console.log(`- ${mark} ${entry.path}: ${entry.state} (${entry.launchSurface})`);
  }
  if (missing.length > 0) {
    console.log(`\nRun: ${report.remediation.initCommand}`);
  }
}
