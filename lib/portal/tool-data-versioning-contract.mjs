const CONTRACT_VERSION = 'tool-data-versioning-contract-v0';

const CONTRACT_BOUNDARIES = Object.freeze({
  implementation: 'report-only',
  readsRealUserData: false,
  writesRealUserData: false,
  runsRealMigrations: false,
  cloudDbMigrationEnabled: false,
  backgroundMigrationWorkerEnabled: false,
  automaticMigrationEnabled: false,
  rollbackExecutesDataRestore: false,
  realDataMigrationRequiresCeoGate: true,
});

const INVENTORY_COMPATIBILITY = Object.freeze({
  reads: Object.freeze(['rearbase_v2', 'rearbase_v1']),
  writes: Object.freeze(['baohe_inventory_v01']),
  strategy: 'read_legacy_then_write_v1_local_root_store',
});

function defaultMigrationRegistryKey(moduleId, schemaVersion) {
  return `${moduleId}.${String(schemaVersion || 'schema-v0').toLowerCase().replace(/[^a-z0-9]+/g, '.')}`;
}

function isFutureMigrationNeeded(tool, dataContract) {
  if (dataContract?.migrationStatus === 'future_migration_needed') return true;
  return ['gated', 'hidden'].includes(tool.launchStatus) || tool.ready === false;
}

function rollbackMetadataForTool(tool) {
  return {
    rollbackSupported: true,
    snapshotBeforeMigration: true,
    rollbackScope: tool.id === 'inventory' ? 'local_inventory_root_store' : 'contract_metadata_only',
    rollbackExecutesAutomatically: false,
    rollbackRequiresUserAction: true,
    rollbackRequiresCeoGateForRealData: true,
  };
}

function backwardCompatibilityForTool(tool, dataContract) {
  if (tool.id === 'inventory') return { ...INVENTORY_COMPATIBILITY };
  return {
    reads: dataContract?.backwardCompatibility?.reads || [],
    writes: dataContract?.backwardCompatibility?.writes || [],
    strategy: 'no_real_data_migration_in_v0',
  };
}

function buildToolDataVersionEntry(tool) {
  const dataContract = tool.dataContract || {};
  const schemaVersion = dataContract.schemaVersion || `${tool.id}.schema@v0`;
  const dataVersion = dataContract.dataVersion || `${tool.id}-data-v0`;
  const demoDataVersion = dataContract.demoDataVersion || `${tool.id}-demo-v0`;
  const futureMigrationNeeded = isFutureMigrationNeeded(tool, dataContract);
  const migrationStatus = dataContract.migrationStatus || (futureMigrationNeeded ? 'future_migration_needed' : 'not_required');
  const migrationRequired = dataContract.migrationRequired === true;

  return {
    moduleId: tool.id,
    label: tool.name,
    primaryEntity: tool.id === 'inventory' ? 'LocalInventoryItem@v1' : schemaVersion,
    schemaVersion,
    dataVersion,
    demoDataVersion,
    manifestDeclaresSchemaVersion: typeof dataContract.schemaVersion === 'string' && dataContract.schemaVersion.length > 0,
    manifestDeclaresDataVersion: typeof dataContract.dataVersion === 'string' && dataContract.dataVersion.length > 0,
    manifestDeclaresDemoDataVersion: typeof dataContract.demoDataVersion === 'string' && dataContract.demoDataVersion.length > 0,
    migrationRequired,
    migrationStatus,
    migrationPlanExists: true,
    migrationRegistryKey: dataContract.migrationRegistryKey || (tool.id === 'inventory'
      ? 'inventory.local.v1'
      : defaultMigrationRegistryKey(tool.id, schemaVersion)),
    migrationPlan: {
      currentStep: migrationRequired ? 'plan_only_pending_ceo_gate' : migrationStatus,
      canRunLocally: false,
      canRunOnCloud: false,
      canRunInBackground: false,
      dryRunOnly: true,
      owner: tool.maintainer || tool.responsibleAgent || 'Qiao',
      gateOwner: tool.gateOwner || 'CEO',
    },
    backwardCompatibility: backwardCompatibilityForTool(tool, dataContract),
    rollbackMetadata: rollbackMetadataForTool(tool),
    runsRealMigration: false,
    cloudDbMigrationEnabled: false,
    backgroundWorkerEnabled: false,
    automaticMigrationEnabled: false,
    needsCeoGateForRealMigration: true,
  };
}

export function buildToolDataVersioningContract(tools) {
  const modules = tools.map((tool) => buildToolDataVersionEntry(tool));
  const warnings = modules.flatMap((entry) => {
    const entryWarnings = [];
    if (!entry.manifestDeclaresSchemaVersion) {
      entryWarnings.push({
        moduleId: entry.moduleId,
        warningKind: 'missing_schema_version',
        issue: 'Tool manifest must declare schemaVersion.',
        owner: 'Qiao',
        evidenceFields: ['tool.dataContract.schemaVersion'],
      });
    }
    if (entry.runsRealMigration || entry.cloudDbMigrationEnabled || entry.backgroundWorkerEnabled) {
      entryWarnings.push({
        moduleId: entry.moduleId,
        warningKind: 'real_migration_not_allowed',
        issue: 'Real user-data migrations are CEO-gated and disabled in this contract.',
        owner: 'CEO',
        evidenceFields: ['toolDataVersioning.modules.runsRealMigration'],
      });
    }
    return entryWarnings;
  });

  return {
    version: CONTRACT_VERSION,
    implementation: 'report-only',
    boundaries: { ...CONTRACT_BOUNDARIES },
    migrationRegistry: Object.fromEntries(modules.map((entry) => [entry.migrationRegistryKey, {
      moduleId: entry.moduleId,
      schemaVersion: entry.schemaVersion,
      dataVersion: entry.dataVersion,
      demoDataVersion: entry.demoDataVersion,
      migrationRequired: entry.migrationRequired,
      migrationStatus: entry.migrationStatus,
      dryRunOnly: true,
      realDataMigrationRequiresCeoGate: true,
    }])),
    summary: {
      moduleCount: modules.length,
      manifestSchemaVersionCount: modules.filter((entry) => entry.manifestDeclaresSchemaVersion).length,
      migrationPlanCoverageCount: modules.filter((entry) => entry.migrationPlanExists).length,
      migrationRequiredCount: modules.filter((entry) => entry.migrationRequired).length,
      futureMigrationNeededCount: modules.filter((entry) => entry.migrationStatus === 'future_migration_needed').length,
      realMigrationEnabledCount: modules.filter((entry) => entry.runsRealMigration).length,
      rollbackMetadataCount: modules.filter((entry) => entry.rollbackMetadata?.rollbackSupported).length,
      warningCount: warnings.length,
    },
    policy: {
      manifestMustDeclareSchemaVersion: true,
      migrationPlansAreReportOnly: true,
      demoDataVersionIsSeparateFromPersonalData: true,
      trueMigrationRequiresCeoGate: true,
      rollbackMetadataRequired: true,
      automaticBackgroundMigrationForbidden: true,
    },
    modules,
    warnings,
  };
}
