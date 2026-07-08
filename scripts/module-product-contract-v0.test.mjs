import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import {
  buildCoreObjectModelContractV0,
  buildModuleProductContractV0,
  resolveEntitlementApprovalState,
  resolveShellDisplayState,
  validateModuleProductContractV0,
} from '../lib/portal/contracts/module-product-contract-v0.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const config = JSON.parse(readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'));
const registry = buildModuleRegistry(config);
const contract = buildModuleProductContractV0(registry.modules);
const validation = validateModuleProductContractV0(contract);

assert.equal(contract.version, 'module-product-contract-v0');
assert.equal(contract.implementation, 'static-product-contract-only');
assert.equal(contract.boundaries.changesUI, false);
assert.equal(contract.boundaries.readsRealData, false);
assert.equal(contract.boundaries.writesRealData, false);
assert.equal(contract.modules.length, registry.modules.length);
assert.equal(contract.summary.moduleCount, registry.modules.length);
assert.equal(validation.ok, true);
assert.equal(validation.warningCount, 0);

const byModule = new Map(contract.modules.map((entry) => [entry.moduleId, entry]));
const requiredFields = [
  'moduleId',
  'launchCohort',
  'primaryUser',
  'openMoment',
  'primaryUseCase',
  'primaryAction',
  'publicPromise',
  'doNotPromise',
  'riskTier',
  'trustBoundary',
  'dataObjects',
  'firstRunPath',
  'readinessBlockers',
  'monetizationStatus',
  'appStore',
  'shellDisplay',
];

for (const entry of contract.modules) {
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(entry, field), `${entry.moduleId} missing product field ${field}`);
  }
  assert.ok(Array.isArray(entry.publicPromise), `${entry.moduleId} publicPromise must be an array`);
  assert.ok(Array.isArray(entry.doNotPromise), `${entry.moduleId} doNotPromise must be an array`);
  assert.equal(typeof entry.trustBoundary.canStoreLocalData, 'boolean');
  assert.equal(typeof entry.trustBoundary.requiresCEOApproval, 'boolean');
}

// inventory 已原生化,不再出现在模块产品契约中(coreObjectModels.storage 业务定义仍保留)
assert.equal(byModule.has('inventory'), false);

for (const moduleId of ['reading', 'sanctuary']) {
  const entry = byModule.get(moduleId);
  assert.equal(entry.launchCohort, 'sandbox', `${moduleId} should stay sandbox`);
  assert.equal(entry.appStore.publicVisible, false, `${moduleId} should not be public visible`);
  assert.equal(entry.appStore.appStoreMentionAllowed, false, `${moduleId} should not be App Store mentionable`);
  assert.equal(entry.shellDisplay.stateLabel, '建设中');
}

for (const moduleId of ['finance', 'health', 'psychoanalysis', 'lifesim']) {
  const entry = byModule.get(moduleId);
  assert.notEqual(entry.launchCohort, 'first_launch', `${moduleId} must not be first launch`);
  assert.equal(entry.appStore.publicVisible, false, `${moduleId} must not be public visible`);
  assert.equal(entry.appStore.appStoreMentionAllowed, false, `${moduleId} must not be App Store mentionable`);
  assert.equal(entry.trustBoundary.requiresCEOApproval, true, `${moduleId} must require CEO approval`);
  assert.equal(resolveEntitlementApprovalState(entry).approvalGatePriority, 'before_paywall');
}

assert.ok(byModule.get('health').doNotPromise.some((text) => text.includes('医疗建议')));
assert.ok(byModule.get('finance').doNotPromise.some((text) => text.includes('真实金融建议')));
assert.ok(byModule.get('psychoanalysis').doNotPromise.some((text) => text.includes('诊断')));
assert.ok(byModule.get('sanctuary').doNotPromise.some((text) => text.includes('治疗')));
assert.ok(byModule.get('lifesim').doNotPromise.some((text) => text.includes('预测人生')));
assert.ok(byModule.get('fitness').doNotPromise.some((text) => text.includes('AI 私教')));

const objectModels = buildCoreObjectModelContractV0();
assert.deepEqual(objectModels.groups.dailyCore.objects, [
  'FlowTask',
  'RecoveryStep',
  'ReadingPosition',
  'ShelterSession',
]);
assert.deepEqual(objectModels.groups.storage.objects, [
  'InventoryItem',
  'PurchaseMemory',
  'LocationAnchor',
  'FreezeIntent',
  'ExpirySignal',
]);
assert.deepEqual(objectModels.groups.learning.objects, [
  'Source',
  'Highlight',
  'Concept',
  'Question',
  'Attempt',
  'ReviewCard',
]);
assert.equal(objectModels.boundaries.cloudDatabaseEnabled, false);
assert.equal(objectModels.boundaries.externalServiceEnabled, false);

assert.equal(contract.moduleTrustBoundary.summary.moduleCount, registry.modules.length);
assert.equal(contract.moduleTrustBoundary.modules.find((entry) => entry.moduleId === 'finance').requiresCEOApproval, true);
assert.equal(contract.moduleTrustBoundary.modules.find((entry) => entry.moduleId === 'health').canMentionHealth, true);
assert.equal(contract.moduleTrustBoundary.modules.find((entry) => entry.moduleId === 'psychoanalysis').canMentionMentalHealth, true);

assert.equal(resolveShellDisplayState(byModule.get('finance')).stateLabel, '需要确认');
assert.equal(resolveShellDisplayState(byModule.get('quiz')).stateLabel, '会离开宝盒');
assert.equal(resolveShellDisplayState(byModule.get('reading')).stateLabel, '建设中');

console.log('module product contract v0 tests passed');
