const ADAPTER_KEYS = Object.freeze(['open', 'return', 'entitlement', 'localData']);

const CONTRACT_BOUNDARIES = Object.freeze({
  splitsRepos: false,
  createsStandaloneApps: false,
  changesRuntimeBehavior: false,
  createsIndependentDataBackend: false,
  storeKitEnabled: false,
  externalAuthEnabled: false,
  cloudSyncEnabled: false,
  readsRealData: false,
  writesRealData: false,
  publishesApps: false,
});

const EXTRACTION_TRIGGERS = Object.freeze([
  'independent_user_group',
  'bundle_business_model_conflict',
  'app_store_review_requires_separation',
  'module_complexity_blocks_shell_release',
  'independent_brand_account_or_data_policy',
  'launchable_or_monetized_lifecycle',
]);

function extractionStatusForModule(tool) {
  if (tool.id === 'inventory' && tool.launchStatus === 'launchable') {
    return {
      extractabilityStatus: 'eligible_later',
      eligibleForFutureExtraction: true,
      reason: 'Launchable first-party module can be evaluated later; keep embedded for v0.1.',
    };
  }

  if (tool.launchStatus === 'gated' || tool.launchStatus === 'hidden') {
    return {
      extractabilityStatus: 'not_now',
      eligibleForFutureExtraction: false,
      reason: `${tool.launchStatus} module must stay gated/internal until CEO and QA clearance.`,
    };
  }

  if (tool.launchStatus === 'future_paid') {
    return {
      extractabilityStatus: 'not_now',
      eligibleForFutureExtraction: false,
      reason: 'future-paid sandbox module stays inside Baohe registry until launchable or monetized.',
    };
  }

  return {
    extractabilityStatus: 'embedded',
    eligibleForFutureExtraction: false,
    reason: 'internal registry module stays embedded in Baohe-first modular monolith.',
  };
}

function buildModuleAdapterEntry(tool) {
  const extraction = extractionStatusForModule(tool);

  return {
    moduleId: tool.id,
    label: tool.name,
    launchStatus: tool.launchStatus,
    lifecycle: tool.toolLifecycle,
    routeKind: tool.routeKind,
    adapterKeys: [...ADAPTER_KEYS],
    openAdapter: 'module_registry_open_href',
    returnAdapter: 'shell_return_href',
    entitlementAdapter: 'report_only_shell_entitlement',
    localDataAdapter: 'module_local_data_contract',
    adapterCompleteness: 'complete',
    splitsRepo: false,
    createsStandaloneApp: false,
    extractableNow: false,
    ...extraction,
  };
}

export function buildModuleAdapterContract(tools) {
  const modules = tools.map((tool) => buildModuleAdapterEntry(tool));
  const warnings = modules
    .filter((entry) => entry.extractableNow || entry.splitsRepo || entry.createsStandaloneApp)
    .map((entry) => ({
      moduleId: entry.moduleId,
      warningKind: 'standalone_boundary_violation',
      issue: 'Module adapter contract must not enable standalone apps or repo split in v0.',
      reason: 'Current architecture is Baohe-first modular monolith.',
      owner: 'Qiao',
      evidenceFields: [
        'moduleAdapterContract.modules.extractableNow',
        'moduleAdapterContract.modules.splitsRepo',
        'moduleAdapterContract.modules.createsStandaloneApp',
      ],
    }));

  return {
    version: 'module-adapter-contract-v0',
    architecture: 'baohe-first-modular-monolith',
    implementation: 'report-only',
    adapterKeys: [...ADAPTER_KEYS],
    boundaries: { ...CONTRACT_BOUNDARIES },
    extractionTriggers: [...EXTRACTION_TRIGGERS],
    policy: {
      baoheShellIsPrimary: true,
      singleFlightIsCurrentGoal: false,
      trueExtractionRequiresLaunchableOrMonetized: true,
      registryIsSourceOfTruth: true,
      toolsUseSharedAdapters: true,
      localDataContractsStayModuleScoped: true,
    },
    summary: {
      moduleCount: modules.length,
      completeAdapterModuleCount: modules.filter((entry) => entry.adapterCompleteness === 'complete').length,
      extractableNowCount: modules.filter((entry) => entry.extractableNow).length,
      eligibleLaterCount: modules.filter((entry) => entry.extractabilityStatus === 'eligible_later').length,
      standaloneAppCount: modules.filter((entry) => entry.createsStandaloneApp).length,
      warningCount: warnings.length,
    },
    modules,
    warnings,
  };
}
