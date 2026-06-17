const LOCAL_INVENTORY_ITEM_FIELDS = Object.freeze([
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
const LOCAL_PROFILE_SCHEMA_VERSION = 'LocalProfile@v1';
const LOCAL_INVENTORY_ITEM_SCHEMA_VERSION = 'LocalInventoryItem@v1';
const LOCAL_INVENTORY_STORE_SCHEMA_VERSION = 'LocalInventoryStore@v1';
const LOCAL_DATA_ROOT_SCHEMA_VERSION = 'BaoheLocalDataRoot@v1';
const LOCAL_DATA_VERSION = 'baohe-local-data-v1';
const LOCAL_TABLE_SCHEMA_VERSIONS = Object.freeze({
  local_profile: LOCAL_PROFILE_SCHEMA_VERSION,
  inventory_items: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
  inventory_store: LOCAL_INVENTORY_STORE_SCHEMA_VERSION,
  local_data_root: LOCAL_DATA_ROOT_SCHEMA_VERSION,
  demo_seed: 'InventoryDemoSeed@v1',
});

const INVENTORY_MODES = Object.freeze(['demo', 'personal']);

const INVENTORY_FIRST_LAUNCH_BOUNDARIES = Object.freeze({
  implementation: 'local-demo-contract-only',
  readsRealData: false,
  writesRealData: false,
  cloudSyncEnabled: false,
  externalAuthEnabled: false,
  paymentIntegrationEnabled: false,
  receiptImportEnabled: false,
  bankCardDataAllowed: false,
  financialAdviceAllowed: false,
  externalSideEffects: false,
});

const PURCHASE_MEMORY_ALLOWED_FIELDS = Object.freeze([
  'purchasedAt',
  'reason',
  'worthIt',
  'memoryNote',
]);

const PURCHASE_MEMORY_FORBIDDEN_FIELDS = Object.freeze([
  'paymentMethod',
  'cardLast4',
  'bankAccount',
  'receiptImport',
  'merchantAuthorization',
  'financialAdvice',
  'budgetRecommendation',
  'creditScore',
]);

const DEMO_INVENTORY_ITEMS = Object.freeze([
  Object.freeze({
    id: 'demo-inventory-001',
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    name: 'Travel cable pouch',
    category: 'electronics',
    locationHint: 'Entry cabinet, second drawer',
    notes: 'Bought to keep charging cables together before trips.',
    purchaseMemory: Object.freeze({
      purchasedAt: '2026-05-08',
      reason: 'Needed one place for USB-C cables and adapters.',
      worthIt: 'yes',
      memoryNote: 'Useful every week; do not buy another pouch.',
    }),
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
    mode: 'demo',
  }),
  Object.freeze({
    id: 'demo-inventory-002',
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    name: 'Blue notebook',
    category: 'stationery',
    locationHint: 'Desk shelf',
    notes: 'Reserved for Baohe launch notes.',
    purchaseMemory: Object.freeze({
      purchasedAt: '2026-04-22',
      reason: 'Wanted a single notebook for product decisions.',
      worthIt: 'yes',
      memoryNote: 'Still active; keep it in the work bag.',
    }),
    createdAt: '2026-06-01T09:10:00.000Z',
    updatedAt: '2026-06-01T09:10:00.000Z',
    mode: 'demo',
  }),
  Object.freeze({
    id: 'demo-inventory-003',
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    name: 'Kitchen label maker',
    category: 'home',
    locationHint: 'Kitchen utility drawer',
    notes: 'Impulse purchase that became useful for storage boxes.',
    purchaseMemory: Object.freeze({
      purchasedAt: '2026-03-15',
      reason: 'Wanted clearer pantry and cable labels.',
      worthIt: 'mixed',
      memoryNote: 'Useful, but refills run out quickly.',
    }),
    createdAt: '2026-06-01T09:20:00.000Z',
    updatedAt: '2026-06-01T09:20:00.000Z',
    mode: 'demo',
  }),
]);

function cloneItem(item) {
  return {
    ...item,
    purchaseMemory: { ...item.purchaseMemory },
  };
}

function buildInventoryFirstLaunchContract() {
  return {
    version: 'inventory-first-launch-data-contract-v0',
    moduleId: 'inventory',
    launchFlow: 'purchase-memory',
    implementation: INVENTORY_FIRST_LAUNCH_BOUNDARIES.implementation,
    schema: {
      name: 'LocalInventoryItem',
      schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
      dataVersion: LOCAL_DATA_VERSION,
      tableSchemaVersions: { ...LOCAL_TABLE_SCHEMA_VERSIONS },
      fields: [...LOCAL_INVENTORY_ITEM_FIELDS],
      requiredFields: [...LOCAL_INVENTORY_ITEM_FIELDS],
      modes: [...INVENTORY_MODES],
      purchaseMemory: {
        allowedPurpose: 'ordinary_purchase_memory_only',
        allowedFields: [...PURCHASE_MEMORY_ALLOWED_FIELDS],
        forbiddenFields: [...PURCHASE_MEMORY_FORBIDDEN_FIELDS],
        financialAdviceAllowed: false,
      },
    },
    boundaries: { ...INVENTORY_FIRST_LAUNCH_BOUNDARIES },
    demo: {
      fixtureMode: 'demo',
      itemCount: DEMO_INVENTORY_ITEMS.length,
      personalDataSource: 'not_read',
      isolatedFromPersonal: true,
      items: DEMO_INVENTORY_ITEMS.map(cloneItem),
    },
    localContracts: {
      export: {
        scope: 'local_inventory_items_only',
        modeAware: true,
        externalSideEffects: false,
        writesCloud: false,
        sendsNetwork: false,
      },
      delete: {
        scope: 'local_inventory_items_only',
        modeAware: true,
        externalSideEffects: false,
        deletesExternalRecords: false,
      },
      demoReset: {
        scope: 'demo_inventory_items_only',
        readsPersonalData: false,
        writesPersonalData: false,
        restoresFixture: true,
      },
    },
    localProfile: {
      schemaVersion: LOCAL_PROFILE_SCHEMA_VERSION,
      profileKind: 'local_profile',
      accountSystemEnabled: false,
      serverUserIdEnabled: false,
      sourceOfTruth: 'device_local_storage',
    },
    migrationSmokeCheck: {
      enabled: true,
      checksSchemaVersions: true,
      checksDemoPersonalIsolation: true,
      checksExportDeleteCoverage: true,
      checksCloudFlagsDisabled: true,
      autoMigratesRealUserData: false,
      rollbackSafe: true,
    },
    cloudGuard: {
      cloudEnabled: false,
      cloudSyncEnabled: false,
      realCloudProviderConnected: false,
      writesCloudData: false,
      readsCloudData: false,
    },
    reinstallRefreshGuarantee: {
      emptyLocalStorageCreatesFreshProfile: true,
      refreshPreservesRootStore: true,
      demoSeedCanBeRestored: true,
      personalDataNotMixedIntoDemo: true,
    },
    reporting: {
      readsRealData: false,
      writesRealData: false,
      cloudSyncEnabled: false,
      externalAuthEnabled: false,
      paymentIntegrationEnabled: false,
    },
  };
}

function readInventoryItemsForMode({ mode = 'demo', personalItems = [] } = {}) {
  if (mode === 'demo') return DEMO_INVENTORY_ITEMS.map(cloneItem);
  if (mode === 'personal') return personalItems.map(cloneItem);
  return [];
}

function buildLocalInventoryExportContract({ mode = 'demo' } = {}) {
  return {
    action: 'local_inventory_export',
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    dataVersion: LOCAL_DATA_VERSION,
    mode,
    scope: mode === 'demo' ? 'demo_inventory_items_only' : 'local_personal_inventory_items_only',
    coversLocalProfile: true,
    coversInventoryTables: true,
    readsRealData: false,
    writesRealData: false,
    cloudSyncEnabled: false,
    externalAuthEnabled: false,
    paymentIntegrationEnabled: false,
    externalSideEffects: false,
  };
}

function buildLocalInventoryDeleteContract({ mode = 'demo' } = {}) {
  return {
    action: 'local_inventory_delete',
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    dataVersion: LOCAL_DATA_VERSION,
    mode,
    scope: mode === 'demo' ? 'demo_inventory_items_only' : 'local_personal_inventory_items_only',
    coversLocalProfile: true,
    coversInventoryTables: true,
    readsRealData: false,
    writesRealData: false,
    cloudSyncEnabled: false,
    externalAuthEnabled: false,
    paymentIntegrationEnabled: false,
    externalSideEffects: false,
  };
}

function buildDemoInventoryResetContract() {
  return {
    action: 'demo_inventory_reset',
    mode: 'demo',
    scope: 'demo_inventory_items_only',
    readsPersonalData: false,
    writesPersonalData: false,
    readsRealData: false,
    writesRealData: false,
    externalSideEffects: false,
    restoresFixture: true,
  };
}

export {
  DEMO_INVENTORY_ITEMS,
  INVENTORY_FIRST_LAUNCH_BOUNDARIES,
  LOCAL_INVENTORY_ITEM_FIELDS,
  buildDemoInventoryResetContract,
  buildInventoryFirstLaunchContract,
  buildLocalInventoryDeleteContract,
  buildLocalInventoryExportContract,
  readInventoryItemsForMode,
};
