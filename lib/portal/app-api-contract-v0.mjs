import { DEMO_INVENTORY_ITEMS } from './inventory-first-launch-contract.mjs';

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
  displayName: 'Baohe Local Demo',
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
