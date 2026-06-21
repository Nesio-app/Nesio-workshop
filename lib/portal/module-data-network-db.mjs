import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildModuleDataBus } from './module-data-bus.mjs';

const require = createRequire(import.meta.url);
const DB_ENABLED_ENV = 'TREASUREBOX_MODULE_DATA_DB';
const DB_PATH_ENV = 'BAOHE_DB_PATH';
const DEFAULT_DB_RELATIVE_PATH = join('database', 'treasurebox-local.db');

function envFlagOff(rawValue) {
  if (typeof rawValue !== 'string') return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'disable';
}

function envFlagOn(rawValue) {
  if (typeof rawValue !== 'string') return true;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'enable';
}

function dbEnabled() {
  const explicit = process.env[DB_ENABLED_ENV];
  if (explicit == null) return true;
  if (envFlagOff(explicit)) return false;
  return envFlagOn(explicit);
}

function dbPath() {
  const fromEnv = process.env[DB_PATH_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), DEFAULT_DB_RELATIVE_PATH);
}

function loadDatabaseSync() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return null;
  }
}

function parseJsonArray(rawValue, fallback = []) {
  if (typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return fallback;
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
      .filter((item) => item.length > 0);
  } catch {
    return fallback;
  }
}

function parseEvidenceLinks(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return fallback;
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .filter((entry) => typeof entry.kind === 'string' && typeof entry.artifact === 'string')
      .map((entry) => ({
        kind: entry.kind.trim(),
        artifact: entry.artifact.trim(),
      }));
  } catch {
    return fallback;
  }
}

function summarizeShellRoutes(shellRoutes, moduleIds = new Set()) {
  const routes = Array.isArray(shellRoutes) ? shellRoutes : [];
  const knownModuleIds = moduleIds.size > 0 ? moduleIds : new Set(routes.map((route) => route.moduleId));
  const routeMap = new Map();
  const missingModuleWarnings = [];
  const missingEvidenceWarnings = [];

  for (const route of routes) {
    const routeKey = String(route?.routeKey || '').trim();
    if (routeKey) routeMap.set(routeKey, route);

    if (route?.moduleId && !knownModuleIds.has(route.moduleId)) {
      missingModuleWarnings.push({
        warningKind: 'unknown_module_id',
        routeKey,
        moduleId: route.moduleId,
        issue: 'shell route references module id missing from module registry',
      });
    }
    if (!Array.isArray(route?.evidenceLinks) || route.evidenceLinks.length === 0) {
      missingEvidenceWarnings.push({
        warningKind: 'missing_evidence_link',
        routeKey,
        issue: 'shell route has no evidence links',
      });
    }
  }

  const modeValues = ['available', 'hidden', 'not_ready', 'gated'];
  const modeAvailabilitySummary = {
    personal: Object.fromEntries(modeValues.map((value) => [value, 0])),
    demo: Object.fromEntries(modeValues.map((value) => [value, 0])),
    market: Object.fromEntries(modeValues.map((value) => [value, 0])),
  };
  const entryStatuses = ['ready', 'not_ready', 'external', 'unconnected', 'contract_only', 'gated'];
  const entryStatusSummary = Object.fromEntries(entryStatuses.map((status) => [status, 0]));

  for (const route of routes) {
    const modeAvailability = route.modeAvailability || {};
    for (const mode of ['personal', 'demo', 'market']) {
      const value = modeAvailability[mode] || 'not_ready';
      if (modeAvailabilitySummary[mode][value] != null) {
        modeAvailabilitySummary[mode][value] += 1;
      }
    }
    if (entryStatusSummary[route.entryStatus] != null) {
      entryStatusSummary[route.entryStatus] += 1;
    }
  }

  return {
    routeCount: routes.length,
    routeKeyCount: routeMap.size,
    readyRouteCount: routes.filter((route) => route.entryStatus === 'ready').length,
    externalRouteCount: routes.filter((route) => route.entryStatus === 'external').length,
    unconnectedRouteCount: routes.filter((route) => route.entryStatus === 'unconnected').length,
    gatedRouteCount: routes.filter((route) => Array.isArray(route.approvalGateKeys)
      && route.approvalGateKeys.length > 0).length,
    missingEvidenceRouteCount: routes.filter((route) => !Array.isArray(route.evidenceLinks)
      || route.evidenceLinks.length === 0).length,
    modeAvailabilitySummary,
    entryStatusSummary,
    warningCount: missingModuleWarnings.length + missingEvidenceWarnings.length,
    warnings: [...missingModuleWarnings, ...missingEvidenceWarnings],
  };
}

function readShellRouteCatalog(db) {
  try {
    const rows = db.prepare(`
      SELECT
        route_key,
        module_id,
        label_zh,
        label_en,
        personal_mode_availability,
        demo_mode_availability,
        market_mode_availability,
        entry_status,
        empty_state_key,
        required_capabilities_json,
        approval_gate_keys_json,
        evidence_links_json
      FROM shell_route_registry
      ORDER BY module_id
    `).all();

    return rows.map((row) => ({
      routeKey: row.route_key,
      moduleId: row.module_id,
      label: {
        zh: row.label_zh,
        en: row.label_en || null,
      },
      modeAvailability: {
        personal: row.personal_mode_availability || 'not_ready',
        demo: row.demo_mode_availability || 'not_ready',
        market: row.market_mode_availability || 'not_ready',
      },
      entryStatus: row.entry_status || 'not_ready',
      emptyStateKey: row.empty_state_key || null,
      requiredCapabilities: parseJsonArray(row.required_capabilities_json),
      approvalGateKeys: parseJsonArray(row.approval_gate_keys_json),
      evidenceLinks: parseEvidenceLinks(row.evidence_links_json),
    }));
  } catch (error) {
    return [];
  }
}

function moduleCatalogByDb(db) {
  const moduleRows = db.prepare(`
    SELECT
      module_id,
      ready,
      origin,
      route_kind,
      owner
    FROM module_registry
    ORDER BY module_id
  `).all();

  const capabilityRows = db.prepare(`
    SELECT module_id, contract_type, value
    FROM module_data_contract
    ORDER BY module_id, contract_type, value
  `).all();

  const grouped = new Map();
  for (const row of moduleRows) {
    grouped.set(row.module_id, {
      id: row.module_id,
      mode: row.origin === 'external' ? 'external' : 'local',
      ownedData: [],
      consumedData: [],
      emittedEvents: [],
      allowedActions: [],
      approvalRequiredActions: [],
      source: 'db',
    });
  }

  for (const row of capabilityRows) {
    const moduleEntry = grouped.get(row.module_id);
    if (!moduleEntry) continue;
    const normalized = typeof row.value === 'string' ? row.value.trim() : '';
    if (!normalized) continue;
    switch (row.contract_type) {
      case 'owned_data':
        moduleEntry.ownedData.push(normalized);
        break;
      case 'consumed_data':
        moduleEntry.consumedData.push(normalized);
        break;
      case 'emitted_event':
        moduleEntry.emittedEvents.push(normalized);
        break;
      case 'allowed_action':
        moduleEntry.allowedActions.push(normalized);
        break;
      case 'approval_required_action':
        moduleEntry.approvalRequiredActions.push(normalized);
        break;
      default:
        break;
    }
  }

  return [...grouped.values()].map((module) => ({
    ...module,
    ownedData: [...new Set(module.ownedData)],
    consumedData: [...new Set(module.consumedData)],
    emittedEvents: [...new Set(module.emittedEvents)],
    allowedActions: [...new Set(module.allowedActions)],
    approvalRequiredActions: [...new Set(module.approvalRequiredActions)],
  }));
}

function dataOwnershipMapFromDb(db) {
  const rows = db.prepare(`
    SELECT
      data_key,
      owner_module_id,
      sharing_kind,
      scope,
      expected_producers_json,
      expected_consumers_json
    FROM data_key_ownership
  `).all();

  const map = new Map();
  for (const row of rows) {
    map.set(row.data_key, {
      ownerModuleId: row.owner_module_id,
      sharingKind: row.sharing_kind,
      scope: row.scope,
      expectedProducers: parseJsonArray(row.expected_producers_json),
      expectedConsumers: parseJsonArray(row.expected_consumers_json),
      source: 'db',
    });
  }
  return map;
}

function parseJsonObject(rawValue, fallback = {}) {
  if (typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readExternalConnectionCatalog(db) {
  const rows = db.prepare(`
    SELECT
      connection_id,
      provider,
      connection_type,
      status,
      environment,
      is_enabled,
      metadata_json
    FROM external_connection
    ORDER BY provider
  `).all();

  const providerStates = rows.map((row) => ({
    connectionId: row.connection_id,
    provider: row.provider,
    connectionType: row.connection_type,
    status: row.status,
    environment: row.environment,
    isEnabled: Boolean(row.is_enabled),
    metadata: parseJsonObject(row.metadata_json, {}),
  }));

  return {
    providerCount: providerStates.length,
    enabledCount: providerStates.filter((state) => state.isEnabled === true).length,
    providerStates,
  };
}

export function loadExternalConnectionStateFromDb() {
  if (!dbEnabled()) {
    return {
      ok: false,
      reason: 'database disabled by TREASUREBOX_MODULE_DATA_DB',
      providerCount: 0,
      enabledCount: 0,
      providerStates: [],
    };
  }

  const path = dbPath();
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `sqlite file not found: ${path}`,
      providerCount: 0,
      enabledCount: 0,
      providerStates: [],
    };
  }

  let db = null;
  try {
    const DatabaseSync = loadDatabaseSync();
    if (!DatabaseSync) {
      return {
        ok: false,
        reason: 'node:sqlite unavailable in this runtime',
        providerCount: 0,
        enabledCount: 0,
        providerStates: [],
      };
    }
    db = new DatabaseSync(path, { readonly: true });
    const summary = readExternalConnectionCatalog(db);
    return {
      ok: true,
      reason: `loaded ${summary.providerCount} external connections`,
      ...summary,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown sqlite read error',
      providerCount: 0,
      enabledCount: 0,
      providerStates: [],
    };
  } finally {
    if (db) db.close();
  }
}

function readExperienceReservedData(db) {
  const rows = db.prepare(`
    SELECT data_key
    FROM data_key_ownership
    WHERE sharing_kind = 'shared'
      AND scope = 'shared_context'
  `).all();
  return rows.map((row) => row.data_key);
}

export function loadModuleDataBusFromDb() {
  if (!dbEnabled()) {
    return { ok: false, reason: 'database disabled by TREASUREBOX_MODULE_DATA_DB' };
  }

  const path = dbPath();
  if (!existsSync(path)) {
    return { ok: false, reason: `sqlite file not found: ${path}` };
  }

  let db = null;
  try {
    const DatabaseSync = loadDatabaseSync();
    if (!DatabaseSync) {
      return {
        ok: false,
        reason: 'node:sqlite unavailable in this runtime',
        source: 'sqlite',
      };
    }
    db = new DatabaseSync(path, { readonly: true });
    const moduleCatalogRows = moduleCatalogByDb(db);
    if (moduleCatalogRows.length === 0) {
      return { ok: false, reason: 'no module catalog rows in sqlite' };
    }

    const ownershipMap = dataOwnershipMapFromDb(db);
    const dataKeyOwnership = {
      keys: ownershipMap,
    };
    const shellRoutes = readShellRouteCatalog(db);
    const moduleDataBus = buildModuleDataBus(moduleCatalogRows, {
      generatedAt: new Date().toISOString(),
      mode: 'sqlite',
      experienceReservedData: readExperienceReservedData(db),
      dataKeyOwnership,
    });
    const moduleIds = new Set(moduleCatalogRows.map((module) => module.id));
    const shellRouteSummary = summarizeShellRoutes(shellRoutes, moduleIds);

    return {
      ok: true,
      reason: `loaded ${moduleCatalogRows.length} modules from ${path}`,
      source: 'sqlite',
      boundary: {
        implementation: 'module-data-network-v0',
        readsRegistryMetadataOnly: false,
        readsArtifactFilesOnly: false,
        writesRealData: false,
      },
      moduleDataBus: {
        ...moduleDataBus,
        shellRoutes,
        shellRouteSummary,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown sqlite read error',
      source: 'sqlite',
    };
  } finally {
    if (db) db.close();
  }
}

export function getDbPathForDataLayer() {
  return dbPath();
}

export function isDbBackedDataLayerEnabled() {
  return dbEnabled();
}
