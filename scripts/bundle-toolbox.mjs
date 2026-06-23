import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import { resolveLaunchSurfaceState } from '../lib/portal/launch-surface.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeSandbox = args.includes('--include-sandbox');
const outDirArgIndex = args.indexOf('--out-dir');
const publicRoot = outDirArgIndex >= 0
  ? (isAbsolute(args[outDirArgIndex + 1] || '')
      ? args[outDirArgIndex + 1]
      : resolve(process.cwd(), args[outDirArgIndex + 1] || ''))
  : join(repoRoot, 'public');

const PACKAGE_SOURCES = Object.freeze({
  secretary: {
    sourceDir: 'tools/secretary',
    publicPath: 'secretary',
  },
  plan: {
    sourceDir: 'adhd-flow-ios/web',
    publicPath: 'adhd-flow',
    generatedConfig: "window.ADHD_FLOW_API = window.ADHD_FLOW_API || '';\n",
  },
  inventory: {
    sourceDir: 'storage-web',
    publicPath: 'storage',
  },
  fitness: {
    sourceDir: 'fitness/web',
    publicPath: 'fitness',
    generatedConfig: "window.FITNESS_API = window.FITNESS_API || '';\n",
  },
  health: {
    sourceDir: 'health-web',
    publicPath: 'health',
  },
  reading: {
    sourceDir: 'public/reading',
    publicPath: 'reading',
  },
});

function assertInsidePublic(targetPath) {
  const rel = relative(publicRoot, targetPath);
  if (rel.startsWith('..') || rel === '') {
    throw new Error(`Refusing to write outside bundle output root: ${targetPath}`);
  }
}

function buildBundlePlan() {
  const registry = buildModuleRegistry(config);
  const manifestById = new Map(registry.toolManifest.manifests.map((manifest) => [manifest.moduleId, manifest]));
  const allEntries = Object.entries(PACKAGE_SOURCES).map(([moduleId, packageSource]) => {
    const manifest = manifestById.get(moduleId);
    const tool = registry.modules.find((entry) => entry.id === moduleId) || { id: moduleId, ready: false };
    const launchSurface = resolveLaunchSurfaceState({
      ...tool,
      launchStatus: manifest?.launchStatus || tool.launchStatus,
      prodExposure: manifest?.prodExposure || tool.prodExposure,
      toolLifecycle: manifest?.toolLifecycle || tool.toolLifecycle,
      approvalRequiredActions: manifest?.approvalRequiredActions || tool.approvalRequiredActions || [],
      entitlementPolicy: manifest?.entitlementPolicy || tool.entitlementPolicy,
    }, { viewerRole: 'public' });
    const generatedConfig = packageSource.generatedConfig || null;
    return {
      moduleId,
      manifestVersion: manifest?.version || null,
      launchStatus: manifest?.launchStatus || null,
      prodExposure: manifest?.prodExposure || null,
      shellAction: launchSurface.shellAction,
      visibleForPublic: launchSurface.visible,
      appStoreMentionAllowed: launchSurface.appStoreMentionAllowed,
      mobileStrategy: manifest?.mobileStrategy || null,
      sourceDir: packageSource.sourceDir,
      publicPath: packageSource.publicPath,
      sourceExists: existsSync(join(repoRoot, packageSource.sourceDir)),
      generatedConfigFile: generatedConfig ? 'config.js' : null,
      generatedConfigHasExternalUrl: generatedConfig ? /https?:\/\//i.test(generatedConfig) : false,
    };
  });
  const entries = allEntries.filter((entry) => {
    if (entry.moduleId === 'secretary') return true;
    if (includeSandbox) return entry.launchStatus !== 'hidden' && entry.launchStatus !== 'gated';
    return entry.launchStatus === 'launchable' && entry.prodExposure === 'public' && entry.shellAction === 'open';
  });
  const excludedEntries = allEntries.filter((entry) => !entries.some((included) => included.moduleId === entry.moduleId));

  return {
    version: 'toolbox-bundle-plan-v0',
    implementation: 'local-manifest-driven-static-bundler',
    boundaries: {
      copiesLocalStaticAssets: true,
      noExternalServiceCalls: true,
      noRealDataMigration: true,
      noRuntimePluginLoading: true,
      noCloudSync: true,
      noPaymentRuntime: true,
    },
    exposureMode: includeSandbox ? 'sandbox_explicit' : 'public_launch_only',
    outputRoot: publicRoot,
    entries,
    excludedEntries,
  };
}

function ensureStaticAppBaseHref(entry, targetDir) {
  const indexPath = join(targetDir, 'index.html');
  if (!existsSync(indexPath)) return;
  const baseHref = `/${entry.publicPath}/`;
  let html = readFileSync(indexPath, 'utf8');
  if (new RegExp(`<base\\s+href=["']${baseHref.replace('/', '\\/')}["']`, 'i').test(html)) {
    return;
  }
  if (/<base\s/i.test(html)) {
    html = html.replace(/<base[^>]*>/i, `<base href="${baseHref}">`);
  } else {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${baseHref}">`);
  }
  html = html
    .replace(/\b(href|src)="\/(app\.js|config\.js|styles\.css|portal-back\.css|manifest\.json|icon\.svg)"/g, `$1="${baseHref}$2"`)
    .replace(/\b(href|src)='\/(app\.js|config\.js|styles\.css|portal-back\.css|manifest\.json|icon\.svg)'/g, `$1='${baseHref}$2'`);
  writeFileSync(indexPath, html, 'utf8');
}

function shouldCopyBundleEntry(sourcePath) {
  return !/[\\/][^\\/]+ 2\.[^\\/]+$/.test(sourcePath);
}

function applyBundle(plan) {
  for (const entry of plan.excludedEntries || []) {
    const targetDir = join(publicRoot, entry.publicPath);
    assertInsidePublic(targetDir);
    rmSync(targetDir, { recursive: true, force: true });
  }

  for (const entry of plan.entries) {
    if (!entry.sourceExists) {
      throw new Error(`Missing source directory for ${entry.moduleId}: ${entry.sourceDir}`);
    }
    const sourceDir = join(repoRoot, entry.sourceDir);
    const targetDir = join(publicRoot, entry.publicPath);
    assertInsidePublic(targetDir);
    if (resolve(sourceDir) === resolve(targetDir)) {
      continue;
    }
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true, filter: shouldCopyBundleEntry });

    const packageSource = PACKAGE_SOURCES[entry.moduleId];
    if (packageSource.generatedConfig) {
      writeFileSync(join(targetDir, 'config.js'), packageSource.generatedConfig, 'utf8');
    }
    ensureStaticAppBaseHref(entry, targetDir);
  }
}

const plan = buildBundlePlan();
if (!dryRun) {
  applyBundle(plan);
}

console.log(JSON.stringify({
  ...plan,
  applied: !dryRun,
}, null, 2));

export {
  buildBundlePlan,
};
