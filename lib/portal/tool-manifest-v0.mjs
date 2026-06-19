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
    },
    requiredFields: [...DEFAULT_REQUIRED_FIELDS],
    summary: {
      moduleCount: manifests.length,
      launchableModuleCount: manifests.filter((manifest) => manifest.launchStatus === 'launchable').length,
      sandboxModuleCount: manifests.filter((manifest) => manifest.toolLifecycle === 'sandbox').length,
      publicModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'public').length,
      testerOnlyModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'tester_only').length,
      hiddenModuleCount: manifests.filter((manifest) => manifest.prodExposure === 'hidden').length,
      deprecatedModuleCount: manifests.filter((manifest) => manifest.deprecationPolicy.policy !== 'none').length,
      missingRequiredFieldCount: manifests.reduce((count, manifest) => count + manifest.missingRequiredFields.length, 0),
      warningCount: warnings.length,
    },
    manifests,
    warnings,
  };
}
