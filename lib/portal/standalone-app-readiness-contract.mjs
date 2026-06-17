const EXTRACTION_CONDITIONS = Object.freeze([
  'independent_user_group',
  'commercial_model_conflict_with_bundle',
  'app_store_review_risk_requires_separation',
  'module_complexity_slows_main_app',
  'independent_brand_required',
]);

const HIGH_RISK_MODULE_IDS = Object.freeze(['finance', 'health', 'psychoanalysis', 'secretary']);

function readinessForTool(tool) {
  if (tool.id === 'inventory' && tool.launchStatus === 'launchable') {
    return {
      standaloneEligible: 'possible_later',
      extractionReadinessScore: 40,
      rationale: 'Inventory is the first launchable first-party business module, but remains embedded in Baohe for v0.1.',
    };
  }

  return {
    standaloneEligible: 'not_now',
    extractionReadinessScore: 0,
    rationale: HIGH_RISK_MODULE_IDS.includes(tool.id)
      ? 'High-risk or gated module must stay in Baohe registry until CEO-reviewed maturity.'
      : 'Sandbox or future-paid module is not ready for standalone app strategy.',
  };
}

function standaloneEntryForTool(tool) {
  const readiness = readinessForTool(tool);

  return {
    moduleId: tool.id,
    label: tool.name,
    lifecycle: tool.toolLifecycle || tool.toolManifest?.toolLifecycle || 'sandbox',
    launchStatus: tool.launchStatus || tool.toolManifest?.launchStatus || 'internal_registry_only',
    prodExposure: tool.prodExposure || tool.toolManifest?.prodExposure || 'hidden',
    ...readiness,
    extractionConditions: [...EXTRACTION_CONDITIONS],
    createsStandaloneAppNow: false,
    splitsRepoNow: false,
    migratesCodeNow: false,
    migratesDataNow: false,
    requiresCeoReviewBeforeAction: true,
    baoheMainApp: {
      remainsPrimaryShell: true,
      keepsSharedRegistry: true,
      keepsSharedModuleCode: true,
    },
    standaloneToolApp: {
      draftOnly: true,
      appBundleCreated: false,
      appStoreListingCreated: false,
      runtimeEnabled: false,
    },
    sharedModuleCode: {
      currentSource: 'baohe-main-repo',
      extractionMode: 'not_started',
      codeMigrationEnabled: false,
    },
    separateAppStoreMetadata: {
      status: 'draft_only',
      listingCreated: false,
    },
    separatePrivacyLabel: {
      status: 'draft_only',
      finalized: false,
    },
    standaloneEntitlement: {
      status: 'draft_only',
      storeKitEnabled: false,
      priceConfigured: false,
    },
  };
}

export function buildStandaloneAppReadinessContract(tools) {
  const modules = tools.map((tool) => standaloneEntryForTool(tool));
  const warnings = modules
    .filter((entry) => (
      entry.createsStandaloneAppNow
      || entry.splitsRepoNow
      || entry.migratesCodeNow
      || entry.migratesDataNow
    ))
    .map((entry) => ({
      moduleId: entry.moduleId,
      warningKind: 'standalone_action_enabled',
      issue: 'Standalone readiness contract must not execute extraction work.',
      reason: 'This package is strategy/readiness only.',
      owner: 'Qiao',
      evidenceFields: [
        'standaloneAppReadiness.modules.createsStandaloneAppNow',
        'standaloneAppReadiness.modules.splitsRepoNow',
        'standaloneAppReadiness.modules.migratesCodeNow',
        'standaloneAppReadiness.modules.migratesDataNow',
      ],
    }));

  return {
    version: 'standalone-app-readiness-contract-v0',
    architecture: 'baohe-first-multi-sku-ready',
    implementation: 'strategy-contract-only',
    boundaries: {
      splitsRepo: false,
      createsStandaloneApp: false,
      createsAppStoreListing: false,
      migratesCode: false,
      migratesData: false,
      separateAppStoreMetadataDraftOnly: true,
      separatePrivacyLabelDraftOnly: true,
      standaloneEntitlementDraftOnly: true,
      changesBaoheMainArchitecture: false,
    },
    extractionConditions: [...EXTRACTION_CONDITIONS],
    summary: {
      moduleCount: modules.length,
      readyNowCount: modules.filter((entry) => entry.standaloneEligible === 'ready_now').length,
      possibleLaterCount: modules.filter((entry) => entry.standaloneEligible === 'possible_later').length,
      notNowCount: modules.filter((entry) => entry.standaloneEligible === 'not_now').length,
      warningCount: warnings.length,
    },
    modules,
    warnings,
  };
}
