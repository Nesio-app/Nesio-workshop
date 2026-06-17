import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outDirArgIndex = args.indexOf('--out-dir');
const publicRoot = outDirArgIndex >= 0
  ? (isAbsolute(args[outDirArgIndex + 1] || '')
      ? args[outDirArgIndex + 1]
      : resolve(process.cwd(), args[outDirArgIndex + 1] || ''))
  : join(repoRoot, 'public');

const PACKAGE_SOURCES = Object.freeze({
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
  const entries = Object.entries(PACKAGE_SOURCES).map(([moduleId, packageSource]) => {
    const manifest = manifestById.get(moduleId);
    const generatedConfig = packageSource.generatedConfig || null;
    return {
      moduleId,
      manifestVersion: manifest?.version || null,
      launchStatus: manifest?.launchStatus || null,
      prodExposure: manifest?.prodExposure || null,
      mobileStrategy: manifest?.mobileStrategy || null,
      sourceDir: packageSource.sourceDir,
      publicPath: packageSource.publicPath,
      sourceExists: existsSync(join(repoRoot, packageSource.sourceDir)),
      generatedConfigFile: generatedConfig ? 'config.js' : null,
      generatedConfigHasExternalUrl: generatedConfig ? /https?:\/\//i.test(generatedConfig) : false,
    };
  });

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
    outputRoot: publicRoot,
    entries,
  };
}

function applyBundle(plan) {
  for (const entry of plan.entries) {
    if (!entry.sourceExists) {
      throw new Error(`Missing source directory for ${entry.moduleId}: ${entry.sourceDir}`);
    }
    const sourceDir = join(repoRoot, entry.sourceDir);
    const targetDir = join(publicRoot, entry.publicPath);
    assertInsidePublic(targetDir);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true });

    const packageSource = PACKAGE_SOURCES[entry.moduleId];
    if (packageSource.generatedConfig) {
      writeFileSync(join(targetDir, 'config.js'), packageSource.generatedConfig, 'utf8');
    }
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
