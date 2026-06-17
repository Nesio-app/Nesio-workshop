import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildDemoInventoryResetContract,
  buildInventoryFirstLaunchContract,
  buildLocalInventoryDeleteContract,
  buildLocalInventoryExportContract,
  readInventoryItemsForMode,
} from '../lib/portal/inventory-first-launch-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

const contract = buildInventoryFirstLaunchContract();

assert.equal(contract.version, 'inventory-first-launch-data-contract-v0');
assert.equal(contract.moduleId, 'inventory');
assert.equal(contract.launchFlow, 'purchase-memory');
assert.equal(contract.implementation, 'local-demo-contract-only');
assert.deepEqual(contract.schema.fields, [
  'id',
  'schemaVersion',
  'name',
  'category',
  'locationHint',
  'notes',
  'purchaseMemory',
  'createdAt',
  'updatedAt',
  'mode',
]);
assert.equal(contract.schema.schemaVersion, 'LocalInventoryItem@v1');
assert.equal(contract.schema.tableSchemaVersions.local_profile, 'LocalProfile@v1');
assert.equal(contract.schema.tableSchemaVersions.inventory_items, 'LocalInventoryItem@v1');
assert.equal(contract.schema.tableSchemaVersions.inventory_store, 'LocalInventoryStore@v1');
assert.equal(contract.schema.tableSchemaVersions.local_data_root, 'BaoheLocalDataRoot@v1');
assert.equal(contract.schema.dataVersion, 'baohe-local-data-v1');

assert.equal(contract.schema.purchaseMemory.allowedPurpose, 'ordinary_purchase_memory_only');
assert.equal(contract.schema.purchaseMemory.financialAdviceAllowed, false);
assert.equal(contract.schema.purchaseMemory.forbiddenFields.includes('paymentMethod'), true);
assert.equal(contract.schema.purchaseMemory.forbiddenFields.includes('receiptImport'), true);
assert.equal(contract.schema.purchaseMemory.forbiddenFields.includes('bankAccount'), true);
assert.equal(contract.schema.purchaseMemory.forbiddenFields.includes('cardLast4'), true);
assert.equal(contract.schema.purchaseMemory.forbiddenFields.includes('financialAdvice'), true);

assert.equal(contract.boundaries.readsRealData, false);
assert.equal(contract.boundaries.writesRealData, false);
assert.equal(contract.boundaries.cloudSyncEnabled, false);
assert.equal(contract.boundaries.externalAuthEnabled, false);
assert.equal(contract.boundaries.paymentIntegrationEnabled, false);
assert.equal(contract.boundaries.receiptImportEnabled, false);
assert.equal(contract.boundaries.bankCardDataAllowed, false);
assert.equal(contract.boundaries.externalSideEffects, false);

assert.equal(contract.demo.isolatedFromPersonal, true);
assert.equal(contract.demo.personalDataSource, 'not_read');
assert.equal(contract.demo.items.length >= 3, true);
for (const item of contract.demo.items) {
  assert.equal(item.mode, 'demo');
  assert.equal(Object.keys(item).sort().join(','), contract.schema.fields.slice().sort().join(','));
  for (const forbiddenField of contract.schema.purchaseMemory.forbiddenFields) {
    assert.equal(forbiddenField in item.purchaseMemory, false, `demo item should not include ${forbiddenField}`);
  }
}

const personalSentinel = [{
  id: 'personal-secret-001',
  name: 'Personal record must not appear in demo',
  category: 'private',
  locationHint: 'private drawer',
  notes: 'sentinel',
  purchaseMemory: {
    purchasedAt: '2026-01-01',
    reason: 'private',
    worthIt: 'unknown',
    memoryNote: 'private',
  },
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
  mode: 'personal',
}];

const demoItems = readInventoryItemsForMode({ mode: 'demo', personalItems: personalSentinel });
assert.equal(demoItems.some((item) => item.id === personalSentinel[0].id), false);
assert.equal(demoItems.every((item) => item.mode === 'demo'), true);

const personalItems = readInventoryItemsForMode({ mode: 'personal', personalItems: personalSentinel });
assert.equal(personalItems.length, 1);
assert.equal(personalItems[0].id, personalSentinel[0].id);
assert.notEqual(personalItems[0], personalSentinel[0], 'personal read should return a cloned item');

const exportContract = buildLocalInventoryExportContract({ mode: 'demo' });
assert.equal(exportContract.action, 'local_inventory_export');
assert.equal(exportContract.schemaVersion, 'LocalInventoryItem@v1');
assert.equal(exportContract.dataVersion, 'baohe-local-data-v1');
assert.equal(exportContract.coversLocalProfile, true);
assert.equal(exportContract.coversInventoryTables, true);
assert.equal(exportContract.externalSideEffects, false);
assert.equal(exportContract.cloudSyncEnabled, false);
assert.equal(exportContract.externalAuthEnabled, false);
assert.equal(exportContract.paymentIntegrationEnabled, false);
assert.equal(exportContract.readsRealData, false);
assert.equal(exportContract.writesRealData, false);

const deleteContract = buildLocalInventoryDeleteContract({ mode: 'personal' });
assert.equal(deleteContract.action, 'local_inventory_delete');
assert.equal(deleteContract.schemaVersion, 'LocalInventoryItem@v1');
assert.equal(deleteContract.dataVersion, 'baohe-local-data-v1');
assert.equal(deleteContract.coversLocalProfile, true);
assert.equal(deleteContract.coversInventoryTables, true);
assert.equal(deleteContract.externalSideEffects, false);
assert.equal(deleteContract.cloudSyncEnabled, false);
assert.equal(deleteContract.externalAuthEnabled, false);
assert.equal(deleteContract.paymentIntegrationEnabled, false);
assert.equal(deleteContract.readsRealData, false);
assert.equal(deleteContract.writesRealData, false);

const resetContract = buildDemoInventoryResetContract();
assert.equal(resetContract.action, 'demo_inventory_reset');
assert.equal(resetContract.readsPersonalData, false);
assert.equal(resetContract.writesPersonalData, false);
assert.equal(resetContract.externalSideEffects, false);

assert.equal(contract.localProfile.profileKind, 'local_profile');
assert.equal(contract.localProfile.accountSystemEnabled, false);
assert.equal(contract.localProfile.serverUserIdEnabled, false);
assert.equal(contract.localProfile.schemaVersion, 'LocalProfile@v1');
assert.equal(contract.migrationSmokeCheck.enabled, true);
assert.equal(contract.migrationSmokeCheck.autoMigratesRealUserData, false);
assert.equal(contract.migrationSmokeCheck.rollbackSafe, true);
assert.equal(contract.cloudGuard.cloudEnabled, false);
assert.equal(contract.cloudGuard.cloudSyncEnabled, false);
assert.equal(contract.cloudGuard.realCloudProviderConnected, false);
assert.equal(contract.reinstallRefreshGuarantee.emptyLocalStorageCreatesFreshProfile, true);
assert.equal(contract.reinstallRefreshGuarantee.refreshPreservesRootStore, true);

const reportOutput = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(reportOutput);
assert.equal(report.inventoryFirstLaunch.contract.version, contract.version);
assert.equal(report.inventoryFirstLaunch.summary.moduleId, 'inventory');
assert.equal(report.inventoryFirstLaunch.summary.demoIsolatedFromPersonal, true);
assert.equal(report.inventoryFirstLaunch.summary.readsRealData, false);
assert.equal(report.inventoryFirstLaunch.summary.writesRealData, false);
assert.equal(report.inventoryFirstLaunch.summary.cloudSyncEnabled, false);
assert.equal(report.inventoryFirstLaunch.summary.externalAuthEnabled, false);
assert.equal(report.inventoryFirstLaunch.summary.paymentIntegrationEnabled, false);
assert.equal(report.summary.inventoryFirstLaunchReadsRealData, false);
assert.equal(report.summary.inventoryFirstLaunchWritesRealData, false);
assert.equal(report.summary.inventoryFirstLaunchCloudSyncEnabled, false);
assert.equal(report.summary.inventoryFirstLaunchExternalAuthEnabled, false);
assert.equal(report.summary.inventoryFirstLaunchPaymentIntegrationEnabled, false);

console.log('inventory first-launch data contract tests passed');
