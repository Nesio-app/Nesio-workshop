// 演示物品(mock fixture)—— 原住 inventory-first-launch-contract.mjs;
// 静态 /storage/ app 解绑后该契约随之移除,演示数据内联到这里(/api/inventory demo 端点仍用)。
const DEMO_INVENTORY_ITEMS = Object.freeze([
  Object.freeze({
    id: 'demo-inventory-001',
    schemaVersion: 'LocalInventoryItem@v1',
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
    schemaVersion: 'LocalInventoryItem@v1',
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
    schemaVersion: 'LocalInventoryItem@v1',
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

const API_CONTRACT_BOUNDARIES_V0 = Object.freeze({
  implementation: 'app-api-contract-v0',
  dataSource: 'mock-local-fixture',
  readsRealUserData: false,
  writesRealUserData: false,
  usesRealAuth: false,
  writesCloud: false,
  writesNotion: false,
  authorizesExternalServices: false,
  productionDataAccess: false,
});

const LOCAL_PROFILE_FIXTURE = Object.freeze({
  profileId: 'local_profile_demo',
  profileKind: 'local_profile',
  displayName: 'Nesio Local Demo',
  authProvider: 'none',
  source: 'local-fixture',
});

const MODULE_FIXTURES = Object.freeze([
  Object.freeze({ moduleId: 'shell', name: 'Shell', status: 'enabled', aiEnabled: false, dataScope: 'local_contract' }),
  Object.freeze({ moduleId: 'inventory', name: 'Inventory', status: 'enabled', aiEnabled: false, dataScope: 'demo_inventory' }),
  Object.freeze({ moduleId: 'plan', name: 'Plan', status: 'enabled', aiEnabled: false, dataScope: 'local_contract' }),
  Object.freeze({ moduleId: 'fitness', name: 'Fitness', status: 'enabled', aiEnabled: false, dataScope: 'local_contract' }),
  Object.freeze({ moduleId: 'health', name: 'Health', status: 'gated', aiEnabled: false, dataScope: 'contract_only' }),
  Object.freeze({ moduleId: 'reading', name: 'Reading', status: 'enabled', aiEnabled: false, dataScope: 'local_contract' }),
  Object.freeze({ moduleId: 'finance', name: 'Finance', status: 'gated', aiEnabled: false, dataScope: 'contract_only' }),
]);

const ENTITLEMENT_FIXTURES = Object.freeze([
  Object.freeze({
    entitlementId: 'entitlement:local:inventory',
    profileId: LOCAL_PROFILE_FIXTURE.profileId,
    moduleId: 'inventory',
    planKey: 'local_demo',
    status: 'active',
    source: 'local-fixture',
  }),
  Object.freeze({
    entitlementId: 'entitlement:local:shell',
    profileId: LOCAL_PROFILE_FIXTURE.profileId,
    moduleId: 'shell',
    planKey: 'local_demo',
    status: 'active',
    source: 'local-fixture',
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseEnvelope(endpoint) {
  return {
    ok: true,
    endpoint,
    generatedAt: new Date().toISOString(),
    contract: 'api-contract-v0',
    boundaries: { ...API_CONTRACT_BOUNDARIES_V0 },
  };
}

function buildModulesResponse() {
  return {
    ...baseEnvelope('/api/modules'),
    profile: clone(LOCAL_PROFILE_FIXTURE),
    modules: clone(MODULE_FIXTURES),
  };
}

function buildInventoryResponse({ mode = 'demo' } = {}) {
  return {
    ...baseEnvelope('/api/inventory'),
    mode,
    profile: clone(LOCAL_PROFILE_FIXTURE),
    items: mode === 'demo' ? clone(DEMO_INVENTORY_ITEMS) : [],
    personalDataRead: false,
  };
}

function buildEntitlementsResponse() {
  return {
    ...baseEnvelope('/api/entitlements'),
    profile: clone(LOCAL_PROFILE_FIXTURE),
    entitlements: clone(ENTITLEMENT_FIXTURES),
  };
}

function buildUserDataExportResponse() {
  return {
    ...baseEnvelope('/api/user-data/export'),
    exportKind: 'mock-local-export',
    profile: clone(LOCAL_PROFILE_FIXTURE),
    includesRealUserData: false,
    payload: {
      modules: clone(MODULE_FIXTURES),
      inventoryItems: clone(DEMO_INVENTORY_ITEMS),
      entitlements: clone(ENTITLEMENT_FIXTURES),
    },
  };
}

function buildUserDataDeleteResponse({ dryRun = true } = {}) {
  return {
    ...baseEnvelope('/api/user-data/delete'),
    deleteKind: 'mock-local-delete',
    dryRun,
    profile: clone(LOCAL_PROFILE_FIXTURE),
    deletesRealUserData: false,
    deletesCloudData: false,
    deleted: [],
    wouldDelete: ['demo inventory fixture session state', 'local profile fixture references'],
  };
}

export {
  API_CONTRACT_BOUNDARIES_V0,
  ENTITLEMENT_FIXTURES,
  LOCAL_PROFILE_FIXTURE,
  MODULE_FIXTURES,
  buildEntitlementsResponse,
  buildInventoryResponse,
  buildModulesResponse,
  buildUserDataDeleteResponse,
  buildUserDataExportResponse,
};
