import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import { buildToolManifestRegistryV0 } from '../lib/portal/tool-manifest-v0.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const config = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));

const sandboxTool = {
  id: 'sandbox_probe',
  name: '沙盒探针',
  nameEn: 'Sandbox Probe',
  description: 'Manifest-only sandbox registration probe',
  url: '/sandbox-probe/',
  zone: 'kinetic',
  hotkey: 'x',
  command: '/sandbox-probe',
  featured: false,
  icon: '🧪',
  ready: false,
  status: 'gated',
  integrationMode: 'contract-only',
  toolLifecycle: 'sandbox',
  launchStatus: 'internal_registry_only',
  prodExposure: 'tester_only',
  dataNamespace: 'tester_sandbox',
  routeKind: 'local-static-module',
  openHref: '/sandbox-probe/',
  returnHref: '/',
  ownedData: ['sandbox_probe_notes'],
  consumedData: ['launch_context'],
  emittedEvents: ['sandbox_probe.opened'],
  approvalRequiredActions: ['leave_shell'],
  entitlementPolicy: {
    required: false,
    paywallState: 'free',
  },
  mobileStrategy: 'native_bridge_deferred',
  deprecationPolicy: {
    policy: 'none',
  },
  owner: 'Qiao',
  maintainer: 'Qiao',
  responsibleAgent: 'Qiao',
  evidenceOwner: 'Sina',
  gateOwner: 'CEO',
};

const sandboxConfig = {
  ...config,
  tools: [...config.tools, sandboxTool],
};

const manifestRegistry = buildToolManifestRegistryV0(sandboxConfig);
assert.equal(manifestRegistry.version, 'tool-manifest-v0');
assert.equal(manifestRegistry.summary.moduleCount, sandboxConfig.tools.length);
assert.equal(manifestRegistry.summary.missingRequiredFieldCount, 0);
assert.equal(manifestRegistry.summary.sandboxModuleCount >= 1, true);

const requiredFields = [
  'moduleId',
  'displayName',
  'toolLifecycle',
  'launchStatus',
  'prodExposure',
  'dataNamespace',
  'routeKind',
  'openHref',
  'returnHref',
  'ownedData',
  'consumedData',
  'emittedEvents',
  'approvalRequiredActions',
  'entitlementPolicy',
  'mobileStrategy',
  'deprecationPolicy',
];

for (const manifest of manifestRegistry.manifests) {
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(manifest, field), `${manifest.moduleId} missing ${field}`);
  }
}

const manifestById = new Map(manifestRegistry.manifests.map((manifest) => [manifest.moduleId, manifest]));
// inventory 已原生化,不再有工具清单
assert.equal(manifestById.has('inventory'), false);

for (const moduleId of ['finance', 'health', 'psychoanalysis']) {
  const manifest = manifestById.get(moduleId);
  assert.notEqual(manifest.launchStatus, 'launchable', `${moduleId} must not be launchable`);
  assert.notEqual(manifest.prodExposure, 'public', `${moduleId} must not be public`);
}

const sandboxManifest = manifestById.get('sandbox_probe');
assert.equal(sandboxManifest.toolLifecycle, 'sandbox');
assert.equal(sandboxManifest.launchStatus, 'internal_registry_only');
assert.equal(sandboxManifest.prodExposure, 'tester_only');
assert.equal(sandboxManifest.dataNamespace, 'tester_sandbox');
assert.deepEqual(sandboxManifest.ownedData, ['sandbox_probe_notes']);
assert.equal(sandboxManifest.entitlementPolicy.required, false);
assert.equal(sandboxManifest.deprecationPolicy.policy, 'none');

const moduleRegistry = buildModuleRegistry(sandboxConfig);
const sandboxModule = moduleRegistry.modules.find((module) => module.id === 'sandbox_probe');
assert.ok(sandboxModule, 'sandbox probe must be represented in module registry');
assert.equal(sandboxModule.toolManifest.version, 'tool-manifest-v0');
assert.equal(sandboxModule.toolLifecycle, 'sandbox');
assert.equal(sandboxModule.launchStatus, 'internal_registry_only');
assert.equal(sandboxModule.prodExposure, 'tester_only');
assert.equal(sandboxModule.dataNamespace, 'tester_sandbox');
assert.deepEqual(sandboxModule.ownedData, ['sandbox_probe_notes']);
assert.deepEqual(sandboxModule.approvalRequiredActions, ['leave_shell']);

const report = JSON.parse(execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
}));
assert.equal(report.toolManifest.version, 'tool-manifest-v0');
assert.equal(report.toolManifest.summary.moduleCount, 8);
assert.equal(report.toolManifest.summary.missingRequiredFieldCount, 0);
assert.equal(report.toolManifest.summary.publicModuleCount, 0);
assert.equal(report.toolManifest.manifests.length, 8);
assert.ok(report.toolManifest.manifests.every((manifest) => manifest.version === 'tool-manifest-v0'));

console.log('tool manifest v0 tests passed');
