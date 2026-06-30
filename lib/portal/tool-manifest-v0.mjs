import {
  DOMAIN_CAPABILITY_DEFINITIONS_V1,
  DOMAIN_CAPABILITY_DOMAINS_V1,
  DOMAIN_CAPABILITY_TAXONOMY_VERSION_V1,
  DOMAIN_CAPABILITY_VALUES_V1,
  FRONTSTAGE_DOMAIN_VALUES_V1,
  GATE_LEVEL_VALUES_V1,
  GOVERNANCE_RESOLVER_ORDER_V1,
  SALVAGE_STATUS_VALUES_V1,
  SIGNAL_CONTEXT_WRITEBACK_LOOP_V1,
  SIGNAL_INPUT_FLOW_STEPS_V1,
  SIGNAL_LABEL_CONTEXT_LOOP_V1,
  VISIBILITY_VALUES_V1,
  buildDomainCapabilityTaxonomyV1,
  buildSignalInputContractV1,
} from './domain-capability-taxonomy-v1.mjs';
import { getModuleRouteContract } from './module-routes.mjs';

export const TOOL_MANIFEST_VERSION_V0 = 'tool-manifest-v0';

export const TOOL_LIFECYCLE_VALUES_V0 = Object.freeze([
  'idea',
  'prototype',
  'sandbox',
  'candidate',
  'launchable',
  'monetized',
]);

export const LAUNCH_STATUS_VALUES_V0 = Object.freeze([
  'launchable',
  'internal_registry_only',
  'gated',
  'hidden',
  'future_paid',
  'excluded_from_launch',
]);

export const PROD_EXPOSURE_VALUES_V0 = Object.freeze([
  'hidden',
  'tester_only',
  'beta_opt_in',
  'public',
]);

export const DATA_NAMESPACE_VALUES_V0 = Object.freeze([
  'demo',
  'tester_sandbox',
  'personal',
  'production_shared',
]);

export const DEPRECATION_POLICY_VALUES_V0 = Object.freeze([
  'none',
  'hide_only',
  'export_then_hide',
  'replace_with_module',
  'ceo_gate_required',
]);

const LAUNCHABLE_MODULE_IDS = Object.freeze(['inventory', 'plan']);
const FUTURE_PAID_MODULE_IDS = Object.freeze(['sanctuary', 'reading', 'fitness', 'quiz', 'lifesim']);
const GATED_MODULE_IDS = Object.freeze(['secretary', 'psychoanalysis', 'health']);
const HIDDEN_MODULE_IDS = Object.freeze(['finance']);
const DEFAULT_REQUIRED_FIELDS = Object.freeze([
  'moduleId',
  'displayName',
  'toolLifecycle',
  'launchStatus',
  'prodExposure',
  'dataNamespace',
  'domainCapabilityVersion',
  'primaryDomain',
  'providedCapabilities',
  'requiredCapabilities',
  'contextSchema',
  'salvageStatus',
  'visibility',
  'gateLevel',
  'governanceResolverOrder',
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
]);

function inferLaunchStatus(moduleId) {
  if (LAUNCHABLE_MODULE_IDS.includes(moduleId)) return 'launchable';
  if (HIDDEN_MODULE_IDS.includes(moduleId)) return 'hidden';
  if (GATED_MODULE_IDS.includes(moduleId)) return 'gated';
  if (FUTURE_PAID_MODULE_IDS.includes(moduleId)) return 'future_paid';
  return 'internal_registry_only';
}

function inferToolLifecycle(moduleId, launchStatus) {
  if (LAUNCHABLE_MODULE_IDS.includes(moduleId) || launchStatus === 'launchable') return 'launchable';
  return 'sandbox';
}

function inferProdExposure(moduleId, launchStatus, lifecycle) {
  if (LAUNCHABLE_MODULE_IDS.includes(moduleId) && launchStatus === 'launchable') return 'public';
  if (launchStatus === 'hidden' || launchStatus === 'gated') return 'hidden';
  if (lifecycle === 'sandbox' || lifecycle === 'candidate') return 'tester_only';
  return 'hidden';
}

function inferDataNamespace(moduleId, lifecycle, prodExposure) {
  if (LAUNCHABLE_MODULE_IDS.includes(moduleId)) return 'personal';
  if (prodExposure === 'tester_only' || lifecycle === 'sandbox') return 'tester_sandbox';
  return 'demo';
}

function inferMobileStrategy(tool, routeKind) {
  if (tool.mobileStrategy) return tool.mobileStrategy;
  if (tool.integrationMode === 'static-report-only' || tool.integrationMode === 'contract-only') {
    return 'native_bridge_deferred';
  }
  if (routeKind === 'local-static-module' || routeKind === 'local-shell-route') return 'embedded_static';
  return 'external_webview_gated';
}

function normalizeEntitlementPolicy(tool, moduleId) {
  const policy = tool.entitlementPolicy || {};
  return {
    required: policy.required === true,
    entitlementKey: policy.entitlementKey || `entitlement.${moduleId}.full_access`,
    paywallState: policy.paywallState || (tool.ready ? 'locked' : 'restore_required'),
    reportOnly: policy.reportOnly !== false,
    changesRuntimeBehavior: false,
  };
}

function normalizeDeprecationPolicy(tool) {
  const policy = tool.deprecationPolicy || {};
  return {
    policy: policy.policy || 'none',
    deprecatedAt: policy.deprecatedAt || null,
    replacementModuleId: policy.replacementModuleId || null,
    userDataAction: policy.userDataAction || 'none',
    exportBeforeRemoval: policy.exportBeforeRemoval === true,
    retentionDays: Number.isFinite(policy.retentionDays) ? policy.retentionDays : null,
    entitlementImpact: policy.entitlementImpact || 'none',
    appStoreImpact: policy.appStoreImpact || 'none',
  };
}

function missingRequiredFields(manifest) {
  return DEFAULT_REQUIRED_FIELDS.filter((field) => {
    const value = manifest[field];
    if (Array.isArray(value)) return false;
    return value === undefined || value === null || value === '';
  });
}

function summarizeDomains(manifests) {
  return DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => {
    const domainManifests = manifests.filter((manifest) => manifest.primaryDomain === domain.value);
    const secondaryManifests = manifests.filter((manifest) => manifest.secondaryDomains.includes(domain.value));
    return {
      domain: domain.value,
      label: domain.label,
      zhLabel: domain.zhLabel || domain.label,
      enLabel: domain.enLabel || domain.label,
      frontstage: FRONTSTAGE_DOMAIN_VALUES_V1.includes(domain.value),
      moduleIds: domainManifests.map((manifest) => manifest.moduleId),
      secondaryModuleIds: secondaryManifests.map((manifest) => manifest.moduleId),
      frontstageModuleIds: domainManifests
        .filter((manifest) => manifest.visibility === 'frontstage')
        .map((manifest) => manifest.moduleId),
      gatedModuleIds: domainManifests
        .filter((manifest) => manifest.gateLevel === 'ceo_gate' || manifest.visibility === 'gated')
        .map((manifest) => manifest.moduleId),
      capabilityMaterialModuleIds: domainManifests
        .filter((manifest) => manifest.salvageStatus === 'capability_material')
        .map((manifest) => manifest.moduleId),
    };
  });
}

function summarizeCapabilities(manifests) {
  return DOMAIN_CAPABILITY_DEFINITIONS_V1.map((capability) => {
    const providers = manifests.filter((manifest) => manifest.providedCapabilities.includes(capability.value));
    const requiredBy = manifests.filter((manifest) => manifest.requiredCapabilities.includes(capability.value));
    return {
      capability: capability.value,
      label: capability.label,
      zhLabel: capability.zhLabel,
      aliases: [...capability.aliases],
      providerModuleIds: providers.map((manifest) => manifest.moduleId),
      requiredByModuleIds: requiredBy.map((manifest) => manifest.moduleId),
      gatedProviderModuleIds: providers
        .filter((manifest) => manifest.gateLevel === 'ceo_gate' || manifest.visibility === 'gated')
        .map((manifest) => manifest.moduleId),
    };
  });
}

function summarizeCapabilityMaterial(manifests) {
  return manifests
    .filter((manifest) => manifest.salvageStatus === 'capability_material')
    .map((manifest) => ({
      moduleId: manifest.moduleId,
      primaryDomain: manifest.primaryDomain,
      primaryDomainLabel: manifest.primaryDomainLabel,
      providedCapabilities: [...manifest.providedCapabilities],
      gateLevel: manifest.gateLevel,
      visibility: manifest.visibility,
      reason: 'Old tool capability is retained as platform material, not a standalone launch promise.',
    }));
}

function isMaterialLibraryManifest(manifest) {
  return manifest.salvageStatus !== 'core_domain_engine' || manifest.visibility !== 'frontstage';
}

function groupMaterialLibraryByValue(items, values, valueGetter, keyName) {
  return values.map((value) => ({
    [keyName]: value,
    moduleIds: items
      .filter((item) => valueGetter(item) === value)
      .map((item) => item.moduleId),
  }));
}

function summarizeMaterialLibrary(manifests) {
  const materialManifests = manifests.filter(isMaterialLibraryManifest);

  return {
    version: 'module-material-library-v1',
    implementation: 'static-contract-report-only',
    boundaries: {
      readsManifestOnly: true,
      changesRuntimeBehavior: false,
      writesRealData: false,
      migratesRealData: false,
      touchesOldRepos: false,
      touchesOldGithub: false,
      touchesOldDeployments: false,
      changesLaunchPromise: false,
    },
    moduleCount: materialManifests.length,
    moduleIds: materialManifests.map((manifest) => manifest.moduleId),
    byDomain: groupMaterialLibraryByValue(
      materialManifests,
      DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => domain.value),
      (manifest) => manifest.primaryDomain,
      'domain',
    ).map((entry) => {
      const domain = DOMAIN_CAPABILITY_DOMAINS_V1.find((item) => item.value === entry.domain);
      return {
        ...entry,
        zhLabel: domain?.zhLabel || domain?.label || entry.domain,
      };
    }),
    bySalvageStatus: groupMaterialLibraryByValue(
      materialManifests,
      SALVAGE_STATUS_VALUES_V1,
      (manifest) => manifest.salvageStatus,
      'salvageStatus',
    ),
    byGateLevel: groupMaterialLibraryByValue(
      materialManifests,
      GATE_LEVEL_VALUES_V1,
      (manifest) => manifest.gateLevel,
      'gateLevel',
    ),
    modules: materialManifests.map((manifest) => ({
      moduleId: manifest.moduleId,
      displayName: { ...manifest.displayName },
      primaryDomain: manifest.primaryDomain,
      primaryDomainZhLabel: manifest.primaryDomainZhLabel,
      providedCapabilities: [...manifest.providedCapabilities],
      requiredCapabilities: [...manifest.requiredCapabilities],
      salvageStatus: manifest.salvageStatus,
      visibility: manifest.visibility,
      gateLevel: manifest.gateLevel,
      launchStatus: manifest.launchStatus,
      prodExposure: manifest.prodExposure,
      useAs: 'capability_material_library',
      source: 'tool-manifest-v0',
      reason: 'Retained as reusable capability material; not a standalone launch promise.',
    })),
  };
}

export function buildToolManifestV0(tool, options = {}) {
  const moduleId = tool.moduleId || tool.id;
  const route = getModuleRouteContract(tool.openHref || tool.url || '/', options.basePath || '');
  const capability = options.capabilityForTool
    ? options.capabilityForTool(moduleId, route.origin)
    : {
        mode: route.origin === 'external' ? 'external' : 'local',
        ownedData: [],
        consumedData: ['launch_context'],
        emittedEvents: ['module.opened'],
        allowedActions: ['open_module'],
        approvalRequiredActions: [],
      };
  const launchStatus = tool.launchStatus || inferLaunchStatus(moduleId);
  const toolLifecycle = tool.toolLifecycle || inferToolLifecycle(moduleId, launchStatus);
  const prodExposure = tool.prodExposure || inferProdExposure(moduleId, launchStatus, toolLifecycle);
  const dataNamespace = tool.dataNamespace || inferDataNamespace(moduleId, toolLifecycle, prodExposure);
  const domainCapability = buildDomainCapabilityTaxonomyV1(moduleId, tool, capability);
  const routeKind = tool.routeKind || route.routeKind;
  const openHref = tool.openHref || route.openHref;
  const returnHref = tool.returnHref || route.returnHref || options.returnHref || '/';

  const manifest = {
    version: TOOL_MANIFEST_VERSION_V0,
    moduleId,
    displayName: {
      zh: tool.displayName?.zh || tool.name || moduleId,
      en: tool.displayName?.en || tool.nameEn || tool.name || moduleId,
    },
    toolLifecycle,
    launchStatus,
    prodExposure,
    dataNamespace,
    ...domainCapability,
    routeKind,
    openHref,
    returnHref,
    ownedData: [...(tool.ownedData || capability.ownedData || [])],
    consumedData: [...(tool.consumedData || capability.consumedData || [])],
    emittedEvents: [...(tool.emittedEvents || capability.emittedEvents || [])],
    allowedActions: [...(tool.allowedActions || capability.allowedActions || [])],
    approvalRequiredActions: [...(tool.approvalRequiredActions || capability.approvalRequiredActions || [])],
    entitlementPolicy: normalizeEntitlementPolicy(tool, moduleId),
    mobileStrategy: inferMobileStrategy(tool, routeKind),
    deprecationPolicy: normalizeDeprecationPolicy(tool),
    source: 'portal-config-tool-manifest',
    reportOnly: true,
    changesRuntimeBehavior: false,
  };

  return {
    ...manifest,
    requiredFieldStatus: missingRequiredFields(manifest).length === 0 ? 'complete' : 'incomplete',
    missingRequiredFields: missingRequiredFields(manifest),
  };
}

export function buildToolManifestRegistryV0(config, options = {}) {
  const manifests = (config.tools || []).map((tool) => buildToolManifestV0(tool, options));
  const signalInputContract = buildSignalInputContractV1();
  const materialLibrarySummary = summarizeMaterialLibrary(manifests);
  const warnings = manifests
    .filter((manifest) => manifest.missingRequiredFields.length > 0)
    .map((manifest) => ({
      moduleId: manifest.moduleId,
      warningKind: 'tool_manifest_missing_required_fields',
      issue: 'Tool Manifest v0 entry is missing required fields.',
      reason: `Missing: ${manifest.missingRequiredFields.join(', ')}`,
      owner: 'Qiao',
      evidenceFields: manifest.missingRequiredFields.map((field) => `toolManifest.manifests.${field}`),
    }));

  return {
    version: TOOL_MANIFEST_VERSION_V0,
    implementation: 'manifest-driven-static-contract',
    boundaries: {
      readsManifestOnly: true,
      dynamicPluginMarketplace: false,
      remotePluginLoading: false,
      externalAuthorization: false,
      migratesRealData: false,
      writesRealData: false,
      changesRuntimeBehavior: false,
    },
    vocabularies: {
      toolLifecycle: [...TOOL_LIFECYCLE_VALUES_V0],
      launchStatus: [...LAUNCH_STATUS_VALUES_V0],
      prodExposure: [...PROD_EXPOSURE_VALUES_V0],
      dataNamespace: [...DATA_NAMESPACE_VALUES_V0],
      deprecationPolicy: [...DEPRECATION_POLICY_VALUES_V0],
      frontstageDomains: [...FRONTSTAGE_DOMAIN_VALUES_V1],
      primaryDomains: DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => domain.value),
      capabilities: [...DOMAIN_CAPABILITY_VALUES_V1],
      salvageStatus: [...SALVAGE_STATUS_VALUES_V1],
      visibility: [...VISIBILITY_VALUES_V1],
      gateLevel: [...GATE_LEVEL_VALUES_V1],
      signalInputFlowSteps: [...SIGNAL_INPUT_FLOW_STEPS_V1],
    },
    domainCapabilityTaxonomy: {
      version: DOMAIN_CAPABILITY_TAXONOMY_VERSION_V1,
      signalInputContractVersion: signalInputContract.version,
      frontstageDomains: [...FRONTSTAGE_DOMAIN_VALUES_V1],
      allDomains: [...DOMAIN_CAPABILITY_DOMAINS_V1],
      capabilities: [...DOMAIN_CAPABILITY_VALUES_V1],
      capabilityDefinitions: [...DOMAIN_CAPABILITY_DEFINITIONS_V1],
      contextWritebackLoop: [...SIGNAL_CONTEXT_WRITEBACK_LOOP_V1],
      labelContextLoop: { ...SIGNAL_LABEL_CONTEXT_LOOP_V1 },
      signalInputFlowSteps: [...SIGNAL_INPUT_FLOW_STEPS_V1],
      governanceResolverOrder: [...GOVERNANCE_RESOLVER_ORDER_V1],
    },
    signalInputContract,
    domainSummary: summarizeDomains(manifests),
    capabilitySummary: summarizeCapabilities(manifests),
    capabilityMaterialSummary: summarizeCapabilityMaterial(manifests),
    materialLibrarySummary,
    requiredFields: [...DEFAULT_REQUIRED_FIELDS],
    summary: {
      moduleCount: manifests.length,
      launchableModuleCount: manifests.filter((manifest) => manifest.launchStatus === 'launchable').length,
      sandboxModuleCount: manifests.filter((manifest) => manifest.toolLifecycle === 'sandbox').length,
      publicModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'public').length,
      testerOnlyModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'tester_only').length,
      hiddenModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'hidden').length,
      deprecatedModuleCount: manifests.filter((manifest) => manifest.deprecationPolicy.policy !== 'none').length,
      frontstageDomainCount: FRONTSTAGE_DOMAIN_VALUES_V1.length,
      frontstageModuleCount: manifests.filter((manifest) => manifest.visibility === 'frontstage').length,
      capabilityMaterialModuleCount: manifests.filter((manifest) => manifest.salvageStatus === 'capability_material').length,
      materialLibraryModuleCount: materialLibrarySummary.moduleCount,
      ceoGateModuleCount: manifests.filter((manifest) => manifest.gateLevel === 'ceo_gate').length,
      signalInputSurfaceCount: signalInputContract.summary.surfaceCount,
      signalInputSensitiveSurfaceCount: signalInputContract.summary.sensitiveSurfaceCount,
      signalInputExternalSurfaceCount: signalInputContract.summary.externalSurfaceCount,
      signalInputWritesSignalSurfaceCount: signalInputContract.summary.writesSignalSurfaceCount,
      signalInputWarningCount: signalInputContract.summary.warningCount,
      missingRequiredFieldCount: manifests.reduce((count, manifest) => count + manifest.missingRequiredFields.length, 0),
      warningCount: warnings.length,
    },
    manifests,
    warnings,
  };
}
