import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import { buildLocalDataRecordsV0 } from '../lib/portal/local-data-records.mjs';
import { buildModuleDataBus } from '../lib/portal/module-data-bus.mjs';
import { buildInventoryFirstLaunchContract } from '../lib/portal/inventory-first-launch-contract.mjs';
import { buildModuleAdapterContract } from '../lib/portal/module-adapter-contract.mjs';
import { buildStandaloneAppReadinessContract } from '../lib/portal/standalone-app-readiness-contract.mjs';
import { buildSecurityIncidentReadinessContract } from '../lib/portal/security-incident-readiness-contract.mjs';
import { buildModuleProductContractV0 } from '../lib/portal/module-product-contract-v0.mjs';
import { buildWebSurfaceContractV0 } from '../lib/portal/web-surface-contract-v0.mjs';
import { buildToolDataVersioningContract } from '../lib/portal/tool-data-versioning-contract.mjs';
import { buildUserIdentityUpgradeContract } from '../lib/portal/user-identity-upgrade-contract.mjs';
import { buildOfflineSyncConflictContract } from '../lib/portal/offline-sync-conflict-contract.mjs';
import { buildCloudReadinessContract } from '../lib/portal/cloud-readiness-contract.mjs';
import { buildProductionActivationContract } from '../lib/portal/production-activation-contract.mjs';
import { buildAiProviderRouterContract } from '../lib/portal/ai-provider-router-contract.mjs';
import { nesioDesignSystemContract } from '../lib/portal/nesio-design-system-contract.mjs';
import { nesioDesignSystemAssets } from '../lib/portal/nesio-design-system-assets.mjs';
import {
  LAUNCH_SURFACE_VERSION_V0,
  buildLaunchReadinessSummary,
  resolveLaunchSurfaceState,
} from '../lib/portal/launch-surface.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = join(repoRoot, 'public', 'portal-config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const configToolById = new Map(config.tools.map((tool) => [tool.id, tool]));
const reportGeneratedAt = new Date().toISOString();

const syncedToolDirs = {
  plan: { directory: 'adhd-flow-ios', expectedRouteKind: 'local-static-module' },
  inventory: { directory: 'storage-ios', expectedRouteKind: 'local-static-module' },
  lifesim: { directory: 'weaver-ai', expectedRouteKind: 'external-link' },
  psychoanalysis: { directory: 'psych-tool-ios', expectedRouteKind: 'external-link' },
  quiz: { directory: 'questionbank-ios', expectedRouteKind: 'external-link' },
  reading: { directory: 'reading-ios', expectedRouteKind: 'local-static-module' },
  sanctuary: { directory: 'inner-shelter-ios', expectedRouteKind: 'local-static-module' },
  fitness: { directory: 'fitness', expectedRouteKind: 'local-static-module' },
};

function publicIndexExists(path) {
  if (!path) return false;
  return existsSync(join(repoRoot, 'public', path));
}

const registry = buildModuleRegistry(config);
const inventoryFirstLaunchContract = buildInventoryFirstLaunchContract();
const experienceReservedKeys = registry.experienceServices.reservedKeys;
const dataAggregationContract = registry.dataAggregation;
const approvalGateContract = registry.approvalGate;
const shellRouteContract = registry.shellRouteContract;
const artifactVisibilityContract = registry.artifactVisibility;
const artifactStatusVisibilityContract = registry.artifactStatusVisibility;
const shellDiscoveryEntryContract = registry.shellDiscoveryEntrySlice;
const mobileAppIntegrationContract = registry.mobileAppIntegration;
const reservedConsumedData = new Set(experienceReservedKeys.consumedData);
const reservedEvents = new Set(experienceReservedKeys.events);
const reservedApprovalActions = new Set(experienceReservedKeys.approvalRequiredActions);
const gateReservedActions = new Set(approvalGateContract.reservedActionKeys);
const gateReservedCategories = new Set(approvalGateContract.categories.map(({ category }) => category));
const gateEscalationByAction = new Map(
  approvalGateContract.escalationRules.map((rule) => [rule.actionKey, rule]),
);
const shellModeAvailabilityValues = new Set(shellRouteContract.dictionaries.modeAvailabilityValues);
const redLineEntries = Object.entries(dataAggregationContract.redLineKeys);
const DATA_AGGREGATION_REVIEW_ONLY_MODULES = new Set([
  'secretary',
  'plan',
  'inventory',
  'psychoanalysis',
  'fitness',
  'health',
  'finance',
]);
const DATA_AGGREGATION_RUNTIME_BLOCKER_CATEGORIES = new Set([
  // Reserved by contract but currently not triggered by keyword matches in the existing 10 modules.
  'execution',
]);
const PAYWALL_STATES = Object.freeze([
  'free',
  'trial',
  'subscribed',
  'locked',
  'included_in_bundle',
  'expired',
  'restore_required',
]);
const SUBSCRIPTION_TIERS = Object.freeze([
  'free',
  'single_tool',
  'bundle',
  'pro',
  'legacy',
  'internal',
]);
const ENTITLEMENT_BUNDLES = Object.freeze([
  {
    bundleId: 'baohe.bundle.productivity',
    entitlementKey: 'entitlement.bundle.productivity',
    subscriptionTier: 'bundle',
    includedModules: Object.freeze(['secretary', 'plan', 'inventory', 'quiz', 'reading']),
    storeProvider: 'storekit',
    storeProductRef: null,
    priceConfigured: false,
    behaviorEnabled: false,
  },
  {
    bundleId: 'baohe.bundle.wellness',
    entitlementKey: 'entitlement.bundle.wellness',
    subscriptionTier: 'bundle',
    includedModules: Object.freeze(['fitness', 'health', 'sanctuary', 'psychoanalysis']),
    storeProvider: 'storekit',
    storeProductRef: null,
    priceConfigured: false,
    behaviorEnabled: false,
  },
  {
    bundleId: 'baohe.bundle.all_access',
    entitlementKey: 'entitlement.bundle.all_access',
    subscriptionTier: 'pro',
    includedModules: Object.freeze([]),
    storeProvider: 'storekit',
    storeProductRef: null,
    priceConfigured: false,
    behaviorEnabled: false,
  },
]);
const LAUNCH_SKU_VERSION = 'launch-sku-v0';
const LAUNCH_SKU_KEY = 'shell_inventory_todo_purchase_memory';
const LAUNCH_BUSINESS_MODULE_IDS = Object.freeze(['inventory', 'plan']);
const LAUNCH_INCLUDED_MODULE_IDS = Object.freeze(['shell', ...LAUNCH_BUSINESS_MODULE_IDS]);
const TOOL_LIFECYCLE_VERSION = 'tool-lifecycle-v0';
const TOOL_LIFECYCLE_STAGES = Object.freeze([
  'idea',
  'prototype',
  'sandbox',
  'candidate',
  'launchable',
  'monetized',
]);
const TOOL_LIFECYCLE_STAGE_NUMBERS = Object.freeze({
  idea: 1,
  prototype: 2,
  sandbox: 3,
  candidate: 4,
  launchable: 5,
  monetized: 6,
});
const FUTURE_PAID_MODULE_IDS = Object.freeze([
  'sanctuary',
  'reading',
  'fitness',
  'quiz',
  'lifesim',
]);
const GATED_LAUNCH_MODULE_IDS = Object.freeze([
  'secretary',
  'psychoanalysis',
  'health',
]);
const HIDDEN_LAUNCH_MODULE_IDS = Object.freeze(['finance']);
const INTERNAL_REGISTRY_ONLY_MODULE_IDS = Object.freeze([
  ...FUTURE_PAID_MODULE_IDS,
  ...GATED_LAUNCH_MODULE_IDS,
  ...HIDDEN_LAUNCH_MODULE_IDS,
]);
const PERMISSION_CONSENT_VERSION = 'permission-consent-versioning-v0';
const PRIVACY_POLICY_VERSION = 'privacy-policy-draft-v0';
const RE_CONSENT_TRIGGERS = Object.freeze([
  'new_data_type',
  'new_external_service',
  'new_ai_processing',
  'new_health_sensitive_capability',
  'new_finance_sensitive_capability',
  'new_psychoanalysis_sensitive_capability',
  'privacy_policy_version_change',
  'permission_purpose_version_change',
]);
const INVENTORY_PERMISSION_PURPOSES = Object.freeze([
  {
    permissionKey: 'camera',
    purposeVersion: 'inventory.camera.capture-v0',
    purposeString: '拍摄物品照片用于本机收纳记录；首发版本不上传、不做外部 AI 识别。',
    consentRequired: true,
    runtimeEnabled: true,
  },
  {
    permissionKey: 'photo_library',
    purposeVersion: 'inventory.photo.import-v0',
    purposeString: '选择本机照片用于本机收纳记录；首发版本不上传、不做外部 AI 识别。',
    consentRequired: true,
    runtimeEnabled: true,
  },
]);
const SENSITIVE_CAPABILITY_BY_MODULE = Object.freeze({
  secretary: Object.freeze(['ai_prompt_processing', 'external_ai_provider']),
  health: Object.freeze(['health_sensitive_data', 'health_pattern_analysis']),
  finance: Object.freeze(['finance_sensitive_data', 'financial_action_context']),
  psychoanalysis: Object.freeze(['mental_health_sensitive_context', 'psychoanalysis_session']),
  sanctuary: Object.freeze(['wellness_sensitive_context']),
  plan: Object.freeze(['task_behavior_context']),
  fitness: Object.freeze(['fitness_body_context']),
});
const FEATURE_CONTROL_VERSION = 'feature-control-contract-v0';
const FEATURE_CONTROL_HIGH_RISK_MODULES = Object.freeze([
  'finance',
  'secretary',
  'health',
  'psychoanalysis',
]);

function buildWarningEnvelope(tool, warning) {
  const owner = warning.owner
    || warningOwnerFromTool(tool)
    || 'unassigned';

  return {
    ...warning,
    issue: warning.issue || warning.reason || 'Static contract warning.',
    reason: warning.reason || warning.issue || 'Static contract warning.',
    owner,
    evidenceFields: warning.evidenceFields || [],
  };
}

function warningOwnerFromTool(tool) {
  return (
    tool.gateOwner
    || tool.responsibleAgent
    || tool.evidenceOwner
    || tool.owner
    || tool.maintainer
    || null
  );
}

function approvalResumeActionForStatus(status, recommendedOwner) {
  if (status === 'waiting_approval') return 'route_to_ceo_gate';
  if (status === 'needs_decision') return `route_to_${String(recommendedOwner || 'owner').toLowerCase()}`;
  if (status === 'declared') return 'no_pending_decision_required';
  if (status === 'blocked') return 'resolve_gate_blocker';
  return 'acknowledge';
}

function redLineEvidenceForKeys(keys) {
  const sourceKeys = Array.isArray(keys) ? keys : [];
  return Object.fromEntries(redLineEntries.map(([category, patterns]) => {
    const evidenceKeys = sourceKeys.filter((key) => (
      patterns.some((pattern) => key.toLowerCase().includes(pattern))
    ));

    return [category, evidenceKeys];
  }).filter(([, evidenceKeys]) => evidenceKeys.length > 0));
}

function uniqueCount(values) {
  return new Set(values).size;
}

function matchingRedLineCategories(keys) {
  return Object.keys(redLineEvidenceForKeys(keys));
}

function flattenEvidenceFields(keyToEvidenceMap) {
  return Object.entries(keyToEvidenceMap).flatMap(([category, evidenceKeys]) => (
    evidenceKeys.map((evidenceKey) => `${category}:${evidenceKey}`)
  ));
}

function matchingRedLineCategoriesWithEvidence(keys) {
  return redLineEvidenceForKeys(keys);
}

function evidenceArtifactPathsFromLinks(links) {
  return (Array.isArray(links) ? links : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.artifact || entry?.kind))
    .filter(Boolean);
}

function gateRuleForAction(actionKey) {
  return gateEscalationByAction.get(actionKey) || null;
}

function gateCategoriesForActions(actionKeys) {
  return [...new Set(actionKeys.flatMap((actionKey) => (
    gateRuleForAction(actionKey)?.categories || []
  )))];
}

function gateStatusForActions(actionKeys) {
  if (actionKeys.length === 0) return 'not_required';
  const statuses = actionKeys
    .map((actionKey) => gateRuleForAction(actionKey)?.status)
    .filter(Boolean);
  if (statuses.includes('waiting_approval')) return 'waiting_approval';
  if (statuses.includes('needs_decision')) return 'needs_decision';
  if (statuses.includes('declared')) return 'declared';
  return 'declared';
}

function shellModeAvailabilityForModule(module, gateCategories) {
  if (module.id === 'finance') {
    return {
      personal: 'gated',
      demo: module.ready ? 'available' : 'not_ready',
      market: 'hidden',
    };
  }
  const availability = module.ready ? 'available' : 'not_ready';
  const gatedAvailability = gateCategories.length > 0 ? 'gated' : availability;
  return {
    personal: gatedAvailability,
    demo: availability,
    market: availability,
  };
}

function shellEntryStatusForModule(module, gateCategories) {
  if (!module.id) return 'unconnected';
  if (!module.ready) return 'not_ready';
  if (module.id === 'finance' && gateCategories.length > 0) return 'gated';
  if (module.origin === 'external') return 'external';
  if (gateCategories.length > 0) return 'gated';
  return 'ready';
}

function shellEmptyStateForRoute(entryStatus) {
  if (entryStatus === 'unconnected') return 'module_not_connected';
  if (entryStatus === 'not_ready') return 'module_not_ready';
  if (entryStatus === 'external') return 'external_module';
  if (entryStatus === 'gated') return 'approval_required';
  return null;
}

function bundleIdsForModule(moduleId, moduleIds) {
  return ENTITLEMENT_BUNDLES
    .filter((bundle) => (
      bundle.includedModules.includes(moduleId)
      || (bundle.bundleId === 'baohe.bundle.all_access' && moduleIds.includes(moduleId))
    ))
    .map((bundle) => bundle.bundleId);
}

function commercialForModule(module, moduleIds) {
  const productId = `baohe.${module.id}.subscription`;
  const entitlementKey = `entitlement.${module.id}.full_access`;
  const bundleIds = bundleIdsForModule(module.id, moduleIds);

  return {
    productId,
    moduleId: module.id,
    entitlementKey,
    subscriptionTier: 'single_tool',
    bundleId: null,
    bundleIds,
    includedInBundles: bundleIds,
    includedModules: [module.id],
    defaultPaywallState: module.ready ? 'locked' : 'restore_required',
    freeCapabilities: ['open_free_preview'],
    paidCapabilities: ['full_module_access'],
    storeProvider: 'storekit',
    storeProductRef: null,
    storeProductConfigured: false,
    storePriceConfigured: false,
    priceConfigured: false,
    behaviorEnabled: false,
    receiptVerificationEnabled: false,
    restorePurchaseEnabled: false,
  };
}

function shellApprovalGateStateForTool(tool) {
  if (tool.approvalGate.status === 'not_required') return 'none';
  if (tool.approvalGate.status === 'waiting_approval') return 'needs_ceo';
  if (tool.approvalGate.status === 'needs_decision') return 'pending';
  if (tool.approvalGate.status === 'blocked') return 'denied';
  return 'approved';
}

function shellEntitlementViewForTool(tool) {
  const approvalGateState = shellApprovalGateStateForTool(tool);
  const blockedByApprovalGate = approvalGateState !== 'none' && approvalGateState !== 'approved';
  const paywallState = tool.commercial.defaultPaywallState;
  const blockedByPaywallGate = ['locked', 'expired', 'restore_required'].includes(paywallState);
  const userVisible = tool.shellRoute.entryStatus !== 'unconnected';
  const shellAction = !userVisible
    ? 'hide'
    : (blockedByApprovalGate
      ? 'show_approval_gate'
      : (paywallState === 'restore_required'
        ? 'show_restore'
        : (blockedByPaywallGate ? 'open_free_preview' : 'open')));

  return {
    moduleId: tool.id,
    moduleExists: true,
    userVisible,
    approvalGateState,
    paywallState,
    effectiveEntitlementKey: null,
    entitlementSource: 'none',
    shellAction,
    blockedByApprovalGate,
    blockedByPaywallGate,
    reportOnly: true,
    changesRuntimeBehavior: false,
  };
}

function launchStatusForTool(tool) {
  if (LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id)) return 'launchable';
  if (HIDDEN_LAUNCH_MODULE_IDS.includes(tool.id)) return 'hidden';
  if (GATED_LAUNCH_MODULE_IDS.includes(tool.id)) return 'gated';
  if (FUTURE_PAID_MODULE_IDS.includes(tool.id)) return 'future_paid';
  return 'internal_registry_only';
}

function lifecycleForTool(tool) {
  const lifecycle = LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id) ? 'launchable' : 'sandbox';
  const nextLifecycleTarget = lifecycle === 'launchable' ? 'monetized' : 'candidate';

  return {
    version: TOOL_LIFECYCLE_VERSION,
    lifecycle,
    lifecycleStage: TOOL_LIFECYCLE_STAGE_NUMBERS[lifecycle],
    nextLifecycleTarget,
    nextLifecycleStage: TOOL_LIFECYCLE_STAGE_NUMBERS[nextLifecycleTarget],
    readyForCandidateReview: lifecycle === 'sandbox',
    launchEligible: lifecycle === 'launchable',
    monetizationEligible: lifecycle === 'launchable',
    canChangeRapidly: lifecycle === 'sandbox',
  };
}

function launchSkuModuleEntryForTool(tool, mobileEntryByModuleId) {
  const launchStatus = launchStatusForTool(tool);
  const excludedFromLaunch = !LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id);
  const mobileEntry = mobileEntryByModuleId.get(tool.id) || {};
  const lifecycle = lifecycleForTool(tool);

  return {
    moduleId: tool.id,
    label: tool.name,
    toolLifecycle: lifecycle.lifecycle,
    toolLifecycleStage: lifecycle.lifecycleStage,
    nextLifecycleTarget: lifecycle.nextLifecycleTarget,
    nextLifecycleStage: lifecycle.nextLifecycleStage,
    readyForCandidateReview: lifecycle.readyForCandidateReview,
    launchEligible: lifecycle.launchEligible,
    monetizationEligible: lifecycle.monetizationEligible,
    canChangeRapidly: lifecycle.canChangeRapidly,
    launchStatus,
    internalRegistryOnly: INTERNAL_REGISTRY_ONLY_MODULE_IDS.includes(tool.id),
    excludedFromLaunch,
    futurePaid: FUTURE_PAID_MODULE_IDS.includes(tool.id),
    isLaunchBusinessModule: LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id),
    entitlementKey: tool.commercial.entitlementKey,
    entitlementExists: Boolean(tool.commercial.entitlementKey),
    entitlementChangesLaunchStatus: false,
    paywallState: tool.shellEntitlement.paywallState,
    approvalGateState: tool.shellEntitlement.approvalGateState,
    blockedByApprovalGate: tool.shellEntitlement.blockedByApprovalGate,
    blockedByPaywallGate: tool.shellEntitlement.blockedByPaywallGate,
    approvalGateOverridesPaywallGate: true,
    mobileStrategy: mobileEntry.mobileStrategy || mobileStrategyForTool(tool),
    needsCeoGate: mobileEntry.needsCeoGate === true,
    appStoreFirstRelease: LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id),
    userVisibleAtLaunch: LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id),
    screenshotSafe: LAUNCH_BUSINESS_MODULE_IDS.includes(tool.id),
  };
}

function mobileStrategyForTool(tool) {
  if (tool.integrationMode === 'static-report-only' || tool.integrationMode === 'contract-only') return 'native_bridge_deferred';
  if (!tool.ready) return 'not_ready';
  const launchSurface = resolveLaunchSurfaceState(tool, { viewerRole: 'public' });
  if ((tool.routeKind === 'local-static-module' || tool.routeKind === 'local-shell-route') &&
    launchSurface.launchStatus === 'launchable' &&
    launchSurface.prodExposure === 'public' &&
    tool.publicIndex === true) {
    return 'embedded_static';
  }
  if (tool.routeKind === 'local-static-module' || tool.routeKind === 'local-shell-route') return 'native_bridge_deferred';
  return 'external_webview_gated';
}

function mobileResumeActionForStrategy(strategy) {
  if (strategy === 'embedded_static') return 'include_in_capacitor_static_export';
  if (strategy === 'external_webview_gated') return 'keep_external_webview_and_review_allowlist';
  if (strategy === 'native_bridge_deferred') return 'keep_contract_only_until_ceo_gate';
  return 'finish_module_readiness_before_mobile_sync';
}

function shellRouteEvidenceLinks() {
  return [
    {
      kind: 'module_manager',
      artifact: 'lib/portal/module-manager-core.mjs',
    },
    {
      kind: 'experience_services',
      artifact: 'lib/portal/module-manager-core.mjs#EXPERIENCE_SERVICES_V0',
    },
    {
      kind: 'data_aggregation',
      artifact: 'lib/portal/module-manager-core.mjs#DATA_AGGREGATION_V0',
    },
    {
      kind: 'approval_gate',
      artifact: 'lib/portal/module-manager-core.mjs#APPROVAL_GATE_V0',
    },
    {
      kind: 'spec',
      artifact: 'outputs/2026-06-15-shell-route-contract-v0-spec.md',
    },
  ];
}

function workspaceArtifactBaseDir() {
  return join(repoRoot, '..', '2026-06-12', 'https-treasurebox-nu-vercel-app-https');
}

function artifactKindForPath(path) {
  const normalized = path.toLowerCase();
  if (normalized.includes('-engineering')) return 'engineering';
  if (normalized.includes('-qa')) return 'qa';
  if (normalized.includes('archive') || normalized.includes('closeout')) return 'archive';
  if (normalized.includes('-spec')) return 'spec';
  if (normalized.includes('plan')) return 'plan';
  if (normalized.includes('audit')) return 'audit';
  if (normalized.includes('inventory')) return 'inventory';
  if (normalized.includes('report') || normalized.includes('brief')) return 'report';
  return 'unknown';
}

function artifactStatusForKind(kind) {
  if (kind === 'qa') return 'qa_present';
  if (kind === 'archive') return 'archived';
  if (['engineering', 'spec', 'plan', 'audit', 'inventory', 'report'].includes(kind)) return 'ready';
  return 'present';
}

function parseKeyValueBlock(block) {
  return Object.fromEntries(block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes(':'))
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      return [
        line.slice(0, separatorIndex).trim(),
        line.slice(separatorIndex + 1).trim(),
      ];
    }));
}

function parseHandoff(content) {
  const match = content.match(/```handoff\s*([\s\S]*?)```/);
  return match ? parseKeyValueBlock(match[1]) : null;
}

function artifactOwnerFromPath(path) {
  const normalized = path.toLowerCase();
  const knownOwners = ['qiao', 'ming', 'sina', 'yan', 'atlas', 'du', 'ren', 'archive', 'ceo', 'nora', 'luma'];
  return knownOwners.find((owner) => normalized.includes(`-${owner}`) || normalized.includes(`_${owner}`)) || null;
}

function titleFromArtifactPath(path) {
  return path
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-/g, ' ');
}

function stateForArtifact(artifact, handoff) {
  const status = handoff?.status || artifact.status;
  const needsCeoGate = (handoff?.needs_ceo_gate || '').toLowerCase() === 'yes';
  const blocker = handoff?.blocker || '';
  if (needsCeoGate || status === 'needs_ceo') return 'needs_ceo';
  if (['blocked', 'waiting_approval'].includes(status) || (blocker && blocker !== '无')) return 'blocked';
  if (artifact.kind === 'archive' || ['done', 'pass', 'archived'].includes(status)) return 'archived';
  if (artifact.kind === 'qa' && ['ready', 'pass'].includes(status)) return 'archived';
  if (artifact.kind === 'engineering' && handoff?.to === 'Ming' && status === 'ready') return 'QA';
  if (artifact.kind === 'qa') return 'QA';
  return 'active';
}

function primaryActionForState(state) {
  if (state === 'needs_ceo') return 'decide';
  if (state === 'blocked') return 'retry';
  if (state === 'archived') return 'open_artifact';
  return 'view_detail';
}

function artifactStatusRecord(artifact) {
  let content = '';
  try {
    content = readFileSync(join(artifactBaseDir, artifact.path), 'utf8');
  } catch {
    content = '';
  }
  const handoff = parseHandoff(content);
  const owner = handoff?.from || artifactOwnerFromPath(artifact.path) || null;
  const state = stateForArtifact(artifact, handoff);
  const handoffTo = handoff?.to || null;
  const nextOwner = state === 'archived' ? null : handoffTo;

  return {
    artifactId: artifact.artifactId,
    title: titleFromArtifactPath(artifact.path),
    artifactPath: artifact.path,
    kind: artifact.kind,
    owner,
    state,
    handoffFrom: handoff?.from || owner,
    handoffTo,
    nextOwner,
    nextStep: handoff?.reason || null,
    resumeAction: handoff?.resume_action || null,
    blocker: handoff?.blocker || null,
    needsCeoGate: (handoff?.needs_ceo_gate || '').toLowerCase() === 'yes',
    primaryActionKind: primaryActionForState(state),
    visibilityPriority: artifactStatusVisibilityContract.statePriority.indexOf(state),
    modifiedAt: artifact.modifiedAt,
    sourceVerified: true,
    handoffParsed: Boolean(handoff),
  };
}

function collectArtifactFiles(rootDir, rootContract, baseDir) {
  if (!existsSync(rootDir)) return [];

  return readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return collectArtifactFiles(absolutePath, rootContract, baseDir);
    }
    if (!entry.isFile()) return [];

    const stats = statSync(absolutePath);
    const relativePath = absolutePath.replace(`${baseDir}/`, '');
    const kind = artifactKindForPath(relativePath);

    return [{
      artifactId: relativePath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase(),
      rootKey: rootContract.key,
      rootLabel: rootContract.label,
      path: relativePath,
      filename: entry.name,
      kind,
      status: artifactStatusForKind(kind),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      visible: true,
      evidenceLinks: [{
        kind: 'artifact_file',
        artifact: relativePath,
      }],
    }];
  });
}

const moduleIds = registry.modules.map((module) => module.id);
const tools = registry.modules.map((module) => {
  const syncedTool = syncedToolDirs[module.id] || null;
  const publicIndex = module.origin === 'local' ? publicIndexExists(module.publicIndexPath) : false;
  const expectedRouteKind = syncedTool?.expectedRouteKind || module.routeKind;
  const experienceServices = {
    knownConsumedData: module.consumedData.filter((key) => reservedConsumedData.has(key)),
    nonExperienceConsumedData: module.consumedData.filter((key) => !reservedConsumedData.has(key)),
    knownEvents: module.emittedEvents.filter((key) => reservedEvents.has(key)),
    moduleSpecificEvents: module.emittedEvents.filter((key) => !reservedEvents.has(key)),
    knownApprovalRequiredActions: module.approvalRequiredActions.filter((key) => (
      reservedApprovalActions.has(key)
    )),
    unknownApprovalRequiredActions: module.approvalRequiredActions.filter((key) => (
      !reservedApprovalActions.has(key)
    )),
  };
  const redLineEvidence = matchingRedLineCategoriesWithEvidence([
    ...module.ownedData,
    ...module.consumedData,
    ...module.emittedEvents,
    ...module.allowedActions,
    ...module.approvalRequiredActions,
  ]);
  const redLineCategories = Object.keys(redLineEvidence);
  const redLineRuntimeBlocker = redLineCategories.some((category) => (
    DATA_AGGREGATION_RUNTIME_BLOCKER_CATEGORIES.has(category)
  ));
  const isReviewOnlyModule = DATA_AGGREGATION_REVIEW_ONLY_MODULES.has(module.id);
  const aggregationRiskDebtKind = redLineCategories.length === 0
    ? 'none'
    : (redLineRuntimeBlocker && !isReviewOnlyModule
      ? 'runtime_blocker'
      : 'review_only');
  const redLineEvidenceFields = flattenEvidenceFields(redLineEvidence);
  const aggregationSafety = redLineCategories.length > 0
    ? 'needs_contract_review'
    : 'safe_metadata_only';
  const gateKnownApprovalRequiredActions = module.approvalRequiredActions.filter((key) => (
    gateReservedActions.has(key)
  ));
  const gateUnknownApprovalRequiredActions = module.approvalRequiredActions.filter((key) => (
    !gateReservedActions.has(key)
  ));
  const gateCategories = gateCategoriesForActions(gateKnownApprovalRequiredActions);
  const gateStatus = gateStatusForActions(gateKnownApprovalRequiredActions);
  const shellEntryStatus = shellEntryStatusForModule(module, gateCategories);
  const commercial = commercialForModule(module, moduleIds);

  return {
    id: module.id,
    name: module.name,
    zone: module.zone,
    ready: module.ready,
    status: module.status || (module.ready ? 'ready' : 'not_ready'),
    integrationMode: module.integrationMode || module.capabilities.mode,
    owner: module.owner,
    maintainer: module.maintainer,
    responsibleAgent: module.responsibleAgent,
    evidenceOwner: module.evidenceOwner,
    gateOwner: module.gateOwner,
    origin: module.origin,
    routeKind: module.routeKind,
    expectedRouteKind,
    syncedDirectory: syncedTool?.directory || null,
    syncedDirectoryExists: syncedTool ? existsSync(join(repoRoot, syncedTool.directory)) : null,
    configuredUrl: module.configuredUrl,
    normalizedPath: module.normalizedPath,
    dataContract: module.dataContract,
    publicIndex,
    publicIndexPath: module.publicIndexPath,
    openHref: module.openHref,
    returnHref: module.returnHref,
    capabilities: module.capabilities,
    ownedData: module.ownedData,
    consumedData: module.consumedData,
    emittedEvents: module.emittedEvents,
    allowedActions: module.allowedActions,
    approvalRequiredActions: module.approvalRequiredActions,
    commercial,
    experienceServices,
    dataAggregation: {
      redLineEvidence,
      redLineEvidenceFields,
      aggregationSafety,
      redLineCategories,
      riskDebtKind: aggregationRiskDebtKind,
      summaryOnly: true,
      readsRealData: false,
    },
    approvalGate: {
      knownApprovalRequiredActions: gateKnownApprovalRequiredActions,
      unknownApprovalRequiredActions: gateUnknownApprovalRequiredActions,
      gateCategories,
      recommendedOwner: module.approvalRequiredActions.length > 0 ? 'CEO' : null,
      status: gateStatus,
      staticVocabularyOnly: true,
      createsGateRecords: false,
    },
    ownership: {
      owner: module.owner || null,
      maintainer: module.maintainer || null,
      responsibleAgent: module.responsibleAgent || null,
      evidenceOwner: module.evidenceOwner || null,
      gateOwner: module.gateOwner || null,
    },
    shellRoute: {
      routeKey: `${module.id}_open`,
      moduleId: module.id,
      label: {
        zh: module.name,
        en: module.nameEn,
      },
      modeAvailability: shellModeAvailabilityForModule(module, gateCategories),
      entryStatus: shellEntryStatus,
      emptyStateKey: shellEmptyStateForRoute(shellEntryStatus),
      requiredCapabilities: [
        ...module.allowedActions,
        ...module.consumedData,
      ],
      approvalGateKeys: [
        ...gateKnownApprovalRequiredActions,
        ...gateCategories,
      ],
      evidenceLinks: shellRouteEvidenceLinks(),
      staticRouteRegistryOnly: true,
      changesUI: false,
      createsPages: false,
      implementsRouter: false,
    },
    boundaryOk:
      (module.origin === 'external' || module.routeKind === 'local-shell-route' || publicIndex) &&
      (!syncedTool || module.routeKind === expectedRouteKind),
  };
});

for (const tool of tools) {
  tool.shellEntitlement = shellEntitlementViewForTool(tool);
}

const entitlementProducts = tools.map((tool) => ({
  productId: tool.commercial.productId,
  moduleId: tool.commercial.moduleId,
  entitlementKey: tool.commercial.entitlementKey,
  subscriptionTier: tool.commercial.subscriptionTier,
  bundleId: tool.commercial.bundleId,
  bundleIds: tool.commercial.bundleIds,
  includedModules: tool.commercial.includedModules,
  storeProvider: tool.commercial.storeProvider,
  storeProductRef: tool.commercial.storeProductRef,
  priceConfigured: tool.commercial.priceConfigured,
  behaviorEnabled: tool.commercial.behaviorEnabled,
}));
const entitlementBundles = ENTITLEMENT_BUNDLES.map((bundle) => ({
  ...bundle,
  includedModules: bundle.bundleId === 'baohe.bundle.all_access'
    ? [...moduleIds]
    : [...bundle.includedModules],
}));
const moduleEntitlements = tools.map((tool) => ({
  moduleId: tool.id,
  productId: tool.commercial.productId,
  bundleIds: tool.commercial.bundleIds,
  entitlementKey: tool.commercial.entitlementKey,
  defaultPaywallState: tool.commercial.defaultPaywallState,
  freeCapabilities: tool.commercial.freeCapabilities,
  paidCapabilities: tool.commercial.paidCapabilities,
}));
const shellEntitlementViews = tools.map((tool) => tool.shellEntitlement);
const entitlementContract = {
  version: 'entitlement-contract-v0',
  implementation: 'report-only',
  behaviorEnabled: false,
  storeKitEnabled: false,
  receiptVerificationEnabled: false,
  restorePurchaseEnabled: false,
  priceConfigured: false,
  approvalGateSeparateFromPaywallGate: true,
  dictionaries: {
    paywallStates: PAYWALL_STATES,
    subscriptionTiers: SUBSCRIPTION_TIERS,
  },
  lifecycleFields: {
    restorePurchase: [
      'restoreAvailable',
      'restoreRequired',
      'lastRestoreAttemptAt',
      'lastRestoreStatus',
    ],
    trial: [
      'trialEligible',
      'trialActive',
      'trialStartedAt',
      'trialEndsAt',
    ],
    cancel: [
      'cancelRequested',
      'canceledAt',
      'accessUntil',
    ],
    gracePeriod: [
      'gracePeriodActive',
      'gracePeriodEndsAt',
      'reason',
    ],
  },
};
const entitlementSummary = {
  productCount: entitlementProducts.length,
  bundleCount: entitlementBundles.length,
  moduleEntitlementCount: moduleEntitlements.length,
  shellEntitlementViewCount: shellEntitlementViews.length,
  reportOnly: true,
  behaviorEnabled: false,
  storeKitEnabled: false,
  priceConfigured: false,
  receiptVerificationEnabled: false,
  restorePurchaseEnabled: false,
  approvalGateSeparateFromPaywallGate: true,
  blockedByApprovalGateCount: shellEntitlementViews.filter((view) => view.blockedByApprovalGate).length,
  blockedByPaywallGateCount: shellEntitlementViews.filter((view) => view.blockedByPaywallGate).length,
  paywallStateCounts: Object.fromEntries(PAYWALL_STATES.map((state) => [
    state,
    shellEntitlementViews.filter((view) => view.paywallState === state).length,
  ])),
};
const inventoryFirstLaunchSummary = {
  version: inventoryFirstLaunchContract.version,
  moduleId: inventoryFirstLaunchContract.moduleId,
  launchFlow: inventoryFirstLaunchContract.launchFlow,
  implementation: inventoryFirstLaunchContract.implementation,
  schemaName: inventoryFirstLaunchContract.schema.name,
  schemaFieldCount: inventoryFirstLaunchContract.schema.fields.length,
  demoFixtureItemCount: inventoryFirstLaunchContract.demo.itemCount,
  demoIsolatedFromPersonal: inventoryFirstLaunchContract.demo.isolatedFromPersonal,
  readsRealData: inventoryFirstLaunchContract.reporting.readsRealData,
  writesRealData: inventoryFirstLaunchContract.reporting.writesRealData,
  cloudSyncEnabled: inventoryFirstLaunchContract.reporting.cloudSyncEnabled,
  externalAuthEnabled: inventoryFirstLaunchContract.reporting.externalAuthEnabled,
  paymentIntegrationEnabled: inventoryFirstLaunchContract.reporting.paymentIntegrationEnabled,
  localExportContractOnly: inventoryFirstLaunchContract.localContracts.export.externalSideEffects === false,
  localDeleteContractOnly: inventoryFirstLaunchContract.localContracts.delete.externalSideEffects === false,
  demoResetContractOnly: inventoryFirstLaunchContract.localContracts.demoReset.readsPersonalData === false &&
    inventoryFirstLaunchContract.localContracts.demoReset.writesPersonalData === false,
};

const readyModules = tools.filter((tool) => tool.ready);
const launchExposureEntries = tools.map((tool) => {
  const publicState = resolveLaunchSurfaceState(tool, { viewerRole: 'public' });
  const intentionalLaunchExclusion = !tool.boundaryOk &&
    publicState.visible === false &&
    publicState.shellAction === 'hide_for_public' &&
    publicState.appStoreMentionAllowed === false;

  return {
    moduleId: tool.id,
    routeKind: tool.routeKind,
    configuredUrl: tool.configuredUrl,
    publicIndexPath: tool.publicIndexPath,
    publicIndex: tool.publicIndex,
    launchStatus: publicState.launchStatus,
    prodExposure: publicState.prodExposure,
    visibleForPublic: publicState.visibleForPublic,
    shellAction: publicState.shellAction,
    appStoreMentionAllowed: publicState.appStoreMentionAllowed,
    screenshotSafe: publicState.screenshotSafe,
    reason: intentionalLaunchExclusion ? 'not_in_public_launch_surface' : publicState.reason,
    releaseBlocker: !tool.boundaryOk && !intentionalLaunchExclusion,
    intentionalExclusion: intentionalLaunchExclusion,
    resolverSource: 'resolveLaunchSurfaceState',
    evidenceFields: [
      'routeKind',
      'publicIndex',
      'launchSurface.public.launchStatus',
      'launchSurface.public.prodExposure',
      'launchSurface.public.shellAction',
      'launchSurface.public.appStoreMentionAllowed',
    ],
  };
});
const launchExposureIntentionalExclusions = launchExposureEntries.filter((entry) => entry.intentionalExclusion);
const launchExposureReleaseBlockers = launchExposureEntries.filter((entry) => entry.releaseBlocker);
const boundaryWarnings = tools
  .filter((tool) => launchExposureReleaseBlockers.some((entry) => entry.moduleId === tool.id))
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'boundary',
    configuredUrl: tool.configuredUrl,
    routeKind: tool.routeKind,
    expectedRouteKind: tool.expectedRouteKind,
    issue:
      tool.routeKind === tool.expectedRouteKind
        ? 'Local static module is configured but public/<path>/index.html was not found.'
        : 'Configured module boundary does not match the synced tool expectation.',
    reason: tool.routeKind === tool.expectedRouteKind
      ? 'Static route validation requires public/index for local static modules.'
      : 'Synced module expectation and registry boundary are inconsistent.',
    evidenceFields: ['configuredUrl', 'routeKind', 'expectedRouteKind'],
  }));
const launchExposureSemantics = {
  version: 'launch-exposure-semantics-v0',
  resolverSource: 'resolveLaunchSurfaceState',
  releaseBlockerCount: launchExposureReleaseBlockers.length,
  intentionalExclusionCount: launchExposureIntentionalExclusions.length,
  publicLaunchEmbeddedModules: launchExposureEntries
    .filter((entry) => (
      entry.launchStatus === 'launchable' &&
      entry.prodExposure === 'public' &&
      entry.shellAction === 'open' &&
      entry.publicIndex === true
    ))
    .map((entry) => entry.moduleId),
  intentionalExclusions: launchExposureIntentionalExclusions,
  releaseBlockers: launchExposureReleaseBlockers,
};
const experienceServiceWarnings = tools
  .filter((tool) => tool.experienceServices.unknownApprovalRequiredActions.length > 0)
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'unknown_approval_action',
    unknownApprovalRequiredActions: tool.experienceServices.unknownApprovalRequiredActions,
    issue: 'Approval-required action is not in Experience Services v0 reserved approval action keys.',
    reason: 'Action key is outside Experience Services v0 vocabulary and should be reconciled in contract.',
    evidenceFields: ['experienceServices.unknownApprovalRequiredActions'],
  }));
const modulesUsingKnownExperienceKeys = tools.filter((tool) => (
  tool.experienceServices.knownConsumedData.length > 0 ||
  tool.experienceServices.knownEvents.length > 0 ||
  tool.experienceServices.knownApprovalRequiredActions.length > 0
));
const aggregationReviewWarnings = tools
  .filter((tool) => (
    tool.dataAggregation.redLineCategories.length > 0
    && tool.dataAggregation.riskDebtKind === 'review_only'
  ))
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'red_line_review',
    redLineCategories: tool.dataAggregation.redLineCategories,
    riskDebtKind: tool.dataAggregation.riskDebtKind,
    issue: 'Static declarations contain sensitive or gated keys; report stays metadata-only and requires review before runtime data access.',
    reason: 'Red-line keyword match found in module contract declarations, treated as review-only per policy.',
    evidenceFields: tool.dataAggregation.redLineEvidenceFields,
  }));
const aggregationRuntimeBlockerWarnings = tools
  .filter((tool) => (
    tool.dataAggregation.redLineCategories.length > 0
    && tool.dataAggregation.riskDebtKind === 'runtime_blocker'
  ))
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'red_line_runtime_blocker',
    redLineCategories: tool.dataAggregation.redLineCategories,
    riskDebtKind: tool.dataAggregation.riskDebtKind,
    issue: 'Runtime-blocking red-line condition detected in static declarations.',
    reason: 'Red-line keyword match currently implies runtime risk and blocks runtime assumptions.',
    evidenceFields: tool.dataAggregation.redLineEvidenceFields,
  }));
const aggregationWarnings = [
  ...aggregationReviewWarnings,
  ...aggregationRuntimeBlockerWarnings,
];
const dataAggregationReviewWarningCount = aggregationReviewWarnings.length;
const dataAggregationRuntimeBlockerCount = aggregationRuntimeBlockerWarnings.length;
const approvalGateUnknownActionWarnings = tools
  .filter((tool) => tool.approvalGate.unknownApprovalRequiredActions.length > 0)
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'unknown_action_key',
    unknownApprovalRequiredActions: tool.approvalGate.unknownApprovalRequiredActions,
    issue: 'Approval-required action is not in Approval Gate v0 reserved action keys.',
    reason: 'Action key is outside Approval Gate v0 vocabulary and should be normalized before approval routing.',
    evidenceFields: ['approvalGate.unknownApprovalRequiredActions'],
  }));
const approvalGateMissingCategoryWarnings = tools
  .filter((tool) => (
    tool.approvalGate.knownApprovalRequiredActions.length > 0 &&
    tool.approvalGate.gateCategories.length === 0
  ))
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind: 'missing_category_mapping',
    actions: tool.approvalGate.knownApprovalRequiredActions,
    issue: 'Known approval-required action has no Approval Gate v0 category mapping.',
    reason: 'Action key is in contract, but lacks category coverage; decision trace is incomplete.',
    evidenceFields: ['approvalGate.knownApprovalRequiredActions', 'approvalGate.gateCategories'],
  }));
const approvalGateBoundaryWarnings = approvalGateContract.boundaries.staticVocabularyOnly === true &&
  approvalGateContract.boundaries.runtimeEnforcement === false &&
  approvalGateContract.boundaries.permissionSystem === false &&
  approvalGateContract.boundaries.realApprovalFlow === false &&
  approvalGateContract.boundaries.writesGateRecords === false &&
  approvalGateContract.boundaries.sendsNotifications === false &&
  approvalGateContract.boundaries.writesNotion === false &&
  approvalGateContract.boundaries.readsRealData === false &&
  approvalGateContract.boundaries.writesRealData === false &&
  approvalGateContract.boundaries.authorizesExternalServices === false &&
  approvalGateContract.boundaries.executesActions === false &&
  approvalGateContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      boundaries: approvalGateContract.boundaries,
      issue: 'Approval Gate v0 boundary flags no longer match contract-only/static-vocabulary requirements.',
      reason: 'Approval gate boundaries must stay report-only for static slice stage.',
      evidenceFields: ['approvalGateContract.boundaries'],
      owner: 'CEO',
    }];
const approvalGateWarnings = [
  ...approvalGateUnknownActionWarnings,
  ...approvalGateMissingCategoryWarnings,
  ...approvalGateBoundaryWarnings,
];
const approvalRequestMatrix = tools.flatMap((tool) => tool.approvalRequiredActions.map((actionKey) => {
  const rule = gateRuleForAction(actionKey);
  const categories = rule?.categories || [];
  const status = rule?.status || 'declared';
  return {
    moduleId: tool.id,
    actionKey,
    category: categories[0] || 'uncategorized',
    status,
    shellApprovalGateKeys: [...new Set(tool.shellRoute.approvalGateKeys)],
    owner: rule?.recommendedOwner
      || tool.gateOwner
      || tool.responsibleAgent
      || tool.owner
      || 'unassigned',
    evidenceLinks: evidenceArtifactPathsFromLinks(tool.shellRoute.evidenceLinks),
    resumeAction: approvalResumeActionForStatus(status, rule?.recommendedOwner),
  };
}));
const toolById = new Map(tools.map((tool) => [tool.id, tool]));
const approvalRequestMatrixSummary = {
  totalRequestCount: approvalRequestMatrix.length,
  runtimeReviewOnlyCount: approvalRequestMatrix.filter((entry) => (
    toolById.get(entry.moduleId)?.dataAggregation.riskDebtKind === 'review_only'
  )).length,
  runtimeBlockerCount: approvalRequestMatrix.filter((entry) => (
    toolById.get(entry.moduleId)?.dataAggregation.riskDebtKind === 'runtime_blocker'
  )).length,
  statusSummary: Object.fromEntries(['declared', 'needs_decision', 'waiting_approval', 'blocked'].map((status) => [
    status,
    approvalRequestMatrix.filter((entry) => entry.status === status).length,
  ])),
};
const knownModuleIds = new Set(tools.map((tool) => tool.id));
const knownCapabilityKeys = new Set(tools.flatMap((tool) => [
  ...tool.allowedActions,
  ...tool.consumedData,
]));
const shellRouteUnknownModuleWarnings = tools
  .filter((tool) => !knownModuleIds.has(tool.shellRoute.moduleId))
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    routeKey: tool.shellRoute.routeKey,
    warningKind: 'unknown_module_id',
    moduleId: tool.shellRoute.moduleId,
    issue: 'Shell Route Contract entry references a module id that is not in Module Manager registry.',
    reason: 'Shell route references a module id absent from registry, breaking route-to-contract determinism.',
    evidenceFields: ['shellRoute.moduleId'],
  }));
const shellRouteUnknownCapabilityWarnings = tools
  .flatMap((tool) => tool.shellRoute.requiredCapabilities
    .filter((key) => !knownCapabilityKeys.has(key))
    .map((key) => buildWarningEnvelope(tool, {
      id: tool.id,
      routeKey: tool.shellRoute.routeKey,
      warningKind: 'unknown_capability_key',
      capabilityKey: key,
      issue: 'Shell Route Contract entry references a capability key that is not declared by module registry metadata.',
      reason: 'Route capability must be declared in module capabilities to avoid silent runtime no-op.',
      evidenceFields: ['shellRoute.requiredCapabilities', 'knownCapabilityKeys'],
    })));
const shellRouteUnknownGateWarnings = tools
  .flatMap((tool) => tool.shellRoute.approvalGateKeys
    .filter((key) => !gateReservedActions.has(key) && !gateReservedCategories.has(key))
    .map((key) => buildWarningEnvelope(tool, {
      id: tool.id,
      routeKey: tool.shellRoute.routeKey,
      warningKind: 'unknown_gate_key',
      gateKey: key,
      issue: 'Shell Route Contract entry references an approval gate key outside Approval Gate v0 vocabulary.',
      reason: 'Shell route keys must map to contract vocabulary for deterministic decision view.',
      evidenceFields: ['shellRoute.approvalGateKeys'],
    })));
const shellRouteUnknownModeWarnings = tools
  .flatMap((tool) => Object.entries(tool.shellRoute.modeAvailability)
    .filter(([, value]) => !shellModeAvailabilityValues.has(value))
    .map(([mode, value]) => buildWarningEnvelope(tool, {
      id: tool.id,
      routeKey: tool.shellRoute.routeKey,
      warningKind: 'unknown_mode_availability',
      mode,
      value,
      issue: 'Shell Route Contract entry uses a mode availability value outside Shell Route v0 vocabulary.',
      reason: 'Mode value is not in route contract vocabulary; shell view may mis-handle availability rendering.',
      evidenceFields: ['shellRoute.modeAvailability'],
    })));
const shellRouteMissingEvidenceWarnings = tools
  .filter((tool) => tool.shellRoute.evidenceLinks.length === 0)
  .map((tool) => buildWarningEnvelope(tool, {
    id: tool.id,
    routeKey: tool.shellRoute.routeKey,
    warningKind: 'missing_evidence_link',
    issue: 'Shell Route Contract entry has no static evidence links.',
    reason: 'Evidence links are required for auditability and decision trace.',
    evidenceFields: ['shellRoute.evidenceLinks'],
  }));
const shellRouteBoundaryWarnings = shellRouteContract.boundaries.staticRouteRegistryOnly === true &&
  shellRouteContract.boundaries.changesUI === false &&
  shellRouteContract.boundaries.createsPages === false &&
  shellRouteContract.boundaries.implementsRouter === false &&
  shellRouteContract.boundaries.runtimeEnforcement === false &&
  shellRouteContract.boundaries.readsRealData === false &&
  shellRouteContract.boundaries.writesRealData === false &&
  shellRouteContract.boundaries.writesNotion === false &&
  shellRouteContract.boundaries.sendsNotifications === false &&
  shellRouteContract.boundaries.authorizesExternalServices === false &&
  shellRouteContract.boundaries.executesActions === false &&
  shellRouteContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      boundaries: shellRouteContract.boundaries,
      issue: 'Shell Route Contract v0 boundary flags no longer match contract-only/static-route requirements.',
      reason: 'Route behavior boundaries must remain report-only in shell discovery path.',
      evidenceFields: ['shellRouteContract.boundaries'],
    }];
const shellRouteWarnings = [
  ...shellRouteUnknownModuleWarnings,
  ...shellRouteUnknownCapabilityWarnings,
  ...shellRouteUnknownGateWarnings,
  ...shellRouteUnknownModeWarnings,
  ...shellRouteMissingEvidenceWarnings,
  ...shellRouteBoundaryWarnings,
];

const convergenceMatrix = tools.map((tool) => {
  const evidence = [
    ...tool.ownedData,
    ...tool.consumedData,
    ...evidenceArtifactPathsFromLinks(tool.shellRoute.evidenceLinks),
  ];

  return {
    moduleId: tool.id,
    status: tool.status,
    integrationMode: tool.integrationMode,
    entryStatus: tool.shellRoute.entryStatus,
    modeAvailability: tool.shellRoute.modeAvailability,
    approvalActions: tool.approvalRequiredActions,
    shellRouteKeys: {
      routeKey: tool.shellRoute.routeKey,
      approvalGateKeys: tool.shellRoute.approvalGateKeys,
      requiredCapabilitiesKeys: tool.shellRoute.requiredCapabilities,
    },
    gateCategories: tool.approvalGate.gateCategories,
    gateStatus: tool.approvalGate.status,
    redLineCategories: tool.dataAggregation.redLineCategories,
    aggregationSafety: tool.dataAggregation.aggregationSafety,
    riskDebtKind: tool.dataAggregation.riskDebtKind,
    evidence,
    evidenceCount: evidence.length,
    owner: warningOwnerFromTool(tool) || 'unassigned',
  };
});
function driftGuardWarning(tool, warningKind, issue, missingFields = []) {
  return buildWarningEnvelope(tool, {
    id: tool.id,
    warningKind,
    missingFields,
    issue,
    reason: `${issue} Missing or invalid fields: ${missingFields.join(', ') || 'N/A'}`,
    evidenceFields: missingFields,
  });
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

const registryDriftOwnerWarnings = tools
  .filter((tool) => {
    const configTool = configToolById.get(tool.id) || {};
    return !hasText(tool.owner) &&
      !hasText(tool.maintainer) &&
      !hasText(tool.responsibleAgent) &&
      !hasText(configTool.owner) &&
      !hasText(configTool.maintainer) &&
      !hasText(configTool.responsibleAgent);
  })
  .map((tool) => driftGuardWarning(
    tool,
    'missing_owner',
    'Module registry entry has no static owner, maintainer, or responsibleAgent metadata.',
    ['owner'],
  ));
const registryDriftEntryWarnings = tools
  .map((tool) => {
    const missingFields = [
      !hasText(tool.id) ? 'id' : null,
      !hasText(tool.name) ? 'name' : null,
      !hasText(tool.zone) ? 'zone' : null,
      !hasText(tool.configuredUrl) ? 'configuredUrl' : null,
      !hasText(tool.shellRoute?.routeKey) ? 'shellRoute.routeKey' : null,
      !hasText(tool.shellRoute?.moduleId) ? 'shellRoute.moduleId' : null,
      !hasText(tool.shellRoute?.label?.zh) ? 'shellRoute.label.zh' : null,
    ].filter(Boolean);
    return missingFields.length > 0
      ? driftGuardWarning(tool, 'missing_entry', 'Module registry entry is missing required static entry metadata.', missingFields)
      : null;
  })
  .filter(Boolean);
const registryDriftStatusWarnings = tools
  .map((tool) => {
    const missingFields = [
      typeof tool.ready !== 'boolean' ? 'ready' : null,
      !hasText(tool.routeKind) ? 'routeKind' : null,
      !hasText(tool.origin) ? 'origin' : null,
      !hasText(tool.shellRoute?.entryStatus) ? 'shellRoute.entryStatus' : null,
      !tool.shellRoute?.modeAvailability ? 'shellRoute.modeAvailability' : null,
    ].filter(Boolean);
    return missingFields.length > 0
      ? driftGuardWarning(tool, 'missing_status', 'Module registry entry is missing route/status metadata.', missingFields)
      : null;
  })
  .filter(Boolean);
const registryDriftEvidenceWarnings = tools
  .filter((tool) => !hasNonEmptyArray(tool.shellRoute?.evidenceLinks))
  .map((tool) => driftGuardWarning(
    tool,
    'missing_evidence',
    'Module registry entry has no static Shell Route evidence links.',
    ['shellRoute.evidenceLinks'],
  ));
const registryDriftCapabilityWarnings = tools
  .map((tool) => {
    const missingFields = [
      !tool.capabilities ? 'capabilities' : null,
      !hasNonEmptyArray(tool.allowedActions) ? 'allowedActions' : null,
      !Array.isArray(tool.ownedData) ? 'ownedData' : null,
      !Array.isArray(tool.consumedData) ? 'consumedData' : null,
      !Array.isArray(tool.emittedEvents) ? 'emittedEvents' : null,
      !Array.isArray(tool.approvalRequiredActions) ? 'approvalRequiredActions' : null,
    ].filter(Boolean);
    return missingFields.length > 0
      ? driftGuardWarning(tool, 'missing_capability', 'Module registry entry is missing capability contract metadata.', missingFields)
      : null;
  })
  .filter(Boolean);
const registryDriftGateWarnings = tools
  .filter((tool) => (
    tool.approvalRequiredActions.length > 0 &&
    !hasNonEmptyArray(tool.shellRoute?.approvalGateKeys)
  ))
  .map((tool) => driftGuardWarning(
    tool,
    'missing_gate',
    'Module declares approvalRequiredActions but Shell Route has no approvalGateKeys.',
    ['shellRoute.approvalGateKeys'],
  ));
const registryDriftLinkWarnings = tools
  .map((tool) => {
    const launchExposure = launchExposureEntries.find((entry) => entry.moduleId === tool.id);
    const missingFields = [
      !hasText(tool.openHref) ? 'openHref' : null,
      !hasText(tool.returnHref) ? 'returnHref' : null,
      tool.routeKind === 'local-static-module' && launchExposure?.intentionalExclusion !== true && !hasText(tool.publicIndexPath) ? 'publicIndexPath' : null,
      tool.routeKind === 'local-static-module' && launchExposure?.intentionalExclusion !== true && !tool.publicIndex ? 'publicIndex' : null,
    ].filter(Boolean);
    return missingFields.length > 0
      ? driftGuardWarning(tool, 'missing_link', 'Module registry entry is missing route link evidence.', missingFields)
      : null;
  })
  .filter(Boolean);
const registryDriftWarnings = [
  ...registryDriftOwnerWarnings,
  ...registryDriftEntryWarnings,
  ...registryDriftStatusWarnings,
  ...registryDriftEvidenceWarnings,
  ...registryDriftCapabilityWarnings,
  ...registryDriftGateWarnings,
  ...registryDriftLinkWarnings,
];
const modulesWithApprovalRequiredActions = tools.filter((tool) => tool.approvalRequiredActions.length > 0);
const moduleSummary = tools.map((tool) => ({
  moduleId: tool.id,
  name: tool.name,
  origin: tool.origin,
  routeKind: tool.routeKind,
    ready: tool.ready,
    status: tool.status,
    integrationMode: tool.integrationMode,
    openHref: tool.openHref,
  returnHref: tool.returnHref,
  ownedDataKeys: tool.ownedData,
  consumedDataKeys: tool.consumedData,
  emittedEventKeys: tool.emittedEvents,
  approvalRequiredActionKeys: tool.approvalRequiredActions,
  aggregationSafety: tool.dataAggregation.aggregationSafety,
  riskDebtKind: tool.dataAggregation.riskDebtKind,
  entryStatus: tool.shellRoute.entryStatus,
  modeAvailability: tool.shellRoute.modeAvailability,
  gateCategories: tool.approvalGate.gateCategories,
    gateStatus: tool.approvalGate.status,
    redLineCategories: tool.dataAggregation.redLineCategories,
    owner: tool.owner || tool.maintainer || tool.responsibleAgent || tool.evidenceOwner || tool.gateOwner || null,
}));
const capabilitySummary = {
  moduleCount: tools.length,
  readyModuleCount: readyModules.length,
  localModuleCount: tools.filter((tool) => tool.origin === 'local').length,
  externalModuleCount: tools.filter((tool) => tool.origin === 'external').length,
  ownedDataKeyCount: uniqueCount(tools.flatMap((tool) => tool.ownedData)),
  consumedDataKeyCount: uniqueCount(tools.flatMap((tool) => tool.consumedData)),
  emittedEventKeyCount: uniqueCount(tools.flatMap((tool) => tool.emittedEvents)),
  allowedActionKeyCount: uniqueCount(tools.flatMap((tool) => tool.allowedActions)),
  approvalRequiredActionKeyCount: uniqueCount(tools.flatMap((tool) => tool.approvalRequiredActions)),
  unknownExperienceKeyCount: experienceServiceWarnings.reduce(
    (count, warning) => count + warning.unknownApprovalRequiredActions.length,
    0,
  ),
};
const riskSummary = {
  redLineCount: aggregationWarnings.length,
  dataAggregationReviewWarningCount,
  dataAggregationRuntimeBlockerCount,
  warningCount:
    boundaryWarnings.length
    + experienceServiceWarnings.length
    + dataAggregationReviewWarningCount
    + dataAggregationRuntimeBlockerCount,
  modulesWithExternalOrigin: tools.filter((tool) => tool.origin === 'external').map((tool) => tool.id),
  modulesWithSensitiveOwnedDataKeys: tools
    .filter((tool) => matchingRedLineCategories(tool.ownedData).length > 0)
    .map((tool) => tool.id),
  modulesWithApprovalRequiredActions: modulesWithApprovalRequiredActions.map((tool) => tool.id),
  modulesMissingAggregationSafeFields: [],
  boundaryFlags: dataAggregationContract.boundaries,
};
const approvalSummary = {
  approvalRequiredActionCount: tools.reduce((count, tool) => count + tool.approvalRequiredActions.length, 0),
  knownApprovalActionCount: tools.reduce(
    (count, tool) => count + tool.experienceServices.knownApprovalRequiredActions.length,
    0,
  ),
  unknownApprovalActionCount: tools.reduce(
    (count, tool) => count + tool.experienceServices.unknownApprovalRequiredActions.length,
    0,
  ),
  modulesRequiringApproval: modulesWithApprovalRequiredActions.map((tool) => ({
    moduleId: tool.id,
    actions: tool.approvalRequiredActions,
    gateCategories: tool.approvalGate.gateCategories,
    recommendedOwner: tool.approvalGate.recommendedOwner,
    status: tool.approvalGate.status,
    recommendedGate: tool.dataAggregation.redLineCategories.some((category) => (
      ['health', 'finance', 'compliance', 'oauth', 'execution'].includes(category)
    )) ? 'ceo_gate' : 'module_gate',
  })),
};
const approvalGateCategorySummary = Object.fromEntries(approvalGateContract.categories.map(({ category }) => [
  category,
  tools.filter((tool) => tool.approvalGate.gateCategories.includes(category)).length,
]));
const approvalGateSummary = {
  knownApprovalActionCount: tools.reduce(
    (count, tool) => count + tool.approvalGate.knownApprovalRequiredActions.length,
    0,
  ),
  unknownApprovalActionCount: tools.reduce(
    (count, tool) => count + tool.approvalGate.unknownApprovalRequiredActions.length,
    0,
  ),
  modulesRequiringApproval: modulesWithApprovalRequiredActions.map((tool) => ({
    moduleId: tool.id,
    actions: tool.approvalRequiredActions,
    gateCategories: tool.approvalGate.gateCategories,
    recommendedOwner: tool.approvalGate.recommendedOwner,
    status: tool.approvalGate.status,
  })),
  categoryCounts: approvalGateCategorySummary,
  warnings: approvalGateWarnings,
  readsRegistryMetadataOnly: approvalGateContract.reporting.readsRegistryMetadataOnly,
  createsGateRecords: approvalGateContract.reporting.createsGateRecords,
  writesNotion: approvalGateContract.reporting.writesNotion,
  sendsNotifications: approvalGateContract.reporting.sendsNotifications,
};
const shellRoutes = tools.map((tool) => tool.shellRoute);
const shellRouteModeAvailabilitySummary = Object.fromEntries(['personal', 'demo', 'market'].map((mode) => [
  mode,
  Object.fromEntries([...shellModeAvailabilityValues].map((value) => [
    value,
    shellRoutes.filter((route) => route.modeAvailability[mode] === value).length,
  ])),
]));
const shellRouteEntryStatusSummary = Object.fromEntries(shellRouteContract.dictionaries.entryStatusValues.map((status) => [
  status,
  shellRoutes.filter((route) => route.entryStatus === status).length,
]));
const shellRouteSummary = {
  shellRouteCount: shellRoutes.length,
  readyShellRouteCount: shellRoutes.filter((route) => route.entryStatus === 'ready').length,
  externalShellRouteCount: shellRoutes.filter((route) => route.entryStatus === 'external').length,
  unconnectedRouteCount: shellRoutes.filter((route) => route.entryStatus === 'unconnected').length,
  gatedRouteCount: shellRoutes.filter((route) => route.approvalGateKeys.length > 0).length,
  modeAvailabilitySummary: shellRouteModeAvailabilitySummary,
  entryStatusSummary: shellRouteEntryStatusSummary,
  shellRouteWarningCount: shellRouteWarnings.length,
  readsRegistryMetadataOnly: shellRouteContract.reporting.readsRegistryMetadataOnly,
  changesUI: shellRouteContract.reporting.changesUI,
  createsPages: shellRouteContract.reporting.createsPages,
  implementsRouter: shellRouteContract.reporting.implementsRouter,
  writesNotion: shellRouteContract.reporting.writesNotion,
  readsRealData: shellRouteContract.reporting.readsRealData,
};
const shellRouteKeyIndex = Object.fromEntries(shellRoutes.map((route) => ({
  routeKey: route.routeKey,
  moduleId: route.moduleId,
  entryStatus: route.entryStatus,
  modeAvailability: route.modeAvailability,
  approvalGateKeys: route.approvalGateKeys,
  requiredCapabilities: route.requiredCapabilities,
})).map((route) => [route.moduleId, route]));
const registryDriftWarningCounts = {
  missingOwner: registryDriftOwnerWarnings.length,
  missingEntry: registryDriftEntryWarnings.length,
  missingStatus: registryDriftStatusWarnings.length,
  missingEvidence: registryDriftEvidenceWarnings.length,
  missingCapability: registryDriftCapabilityWarnings.length,
  missingGate: registryDriftGateWarnings.length,
  missingLink: registryDriftLinkWarnings.length,
};
const registryDriftGuardSummary = {
  implementation: 'report-only',
  readsRegistryMetadataOnly: true,
  blocksRuntime: false,
  changesUI: false,
  writesRealData: false,
  writesNotion: false,
  moduleCount: tools.length,
  warningCount: registryDriftWarnings.length,
  warningCounts: registryDriftWarningCounts,
  modulesWithWarnings: [...new Set(registryDriftWarnings.map((warning) => warning.id))],
};
function completenessStatus(checks) {
  return Object.values(checks).every(Boolean) ? 'complete' : 'incomplete';
}

const moduleOwnershipStatusRegistry = tools.map((tool) => {
  const completeness = {
    owner: hasText(tool.owner) && hasText(tool.maintainer) && hasText(tool.responsibleAgent),
    status: typeof tool.ready === 'boolean' && hasText(tool.routeKind) && hasText(tool.origin),
    gate: Array.isArray(tool.approvalRequiredActions) &&
      (tool.approvalRequiredActions.length === 0 || hasNonEmptyArray(tool.shellRoute.approvalGateKeys)),
    evidence: hasText(tool.evidenceOwner) && hasNonEmptyArray(tool.shellRoute.evidenceLinks),
    route: hasText(tool.openHref) &&
      hasText(tool.returnHref) &&
      hasText(tool.shellRoute.routeKey) &&
      hasText(tool.shellRoute.entryStatus),
    capability: Boolean(tool.capabilities) &&
      hasNonEmptyArray(tool.allowedActions) &&
      Array.isArray(tool.ownedData) &&
      Array.isArray(tool.consumedData) &&
      Array.isArray(tool.emittedEvents),
  };

  return {
    moduleId: tool.id,
    owner: tool.owner || null,
    maintainer: tool.maintainer || null,
    responsibleAgent: tool.responsibleAgent || null,
    evidenceOwner: tool.evidenceOwner || null,
    gateOwner: tool.gateOwner || null,
    routeKind: tool.routeKind,
    entryStatus: tool.shellRoute.entryStatus,
    approvalGateKeys: tool.shellRoute.approvalGateKeys,
    evidenceLinkCount: tool.shellRoute.evidenceLinks.length,
    completeness,
    completenessStatus: completenessStatus(completeness),
  };
});
const moduleOwnershipStatusSummary = {
  moduleCount: moduleOwnershipStatusRegistry.length,
  completeModuleCount: moduleOwnershipStatusRegistry.filter((module) => (
    module.completenessStatus === 'complete'
  )).length,
  incompleteModuleCount: moduleOwnershipStatusRegistry.filter((module) => (
    module.completenessStatus !== 'complete'
  )).length,
  ownerCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.owner).length,
  statusCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.status).length,
  gateCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.gate).length,
  evidenceCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.evidence).length,
  routeCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.route).length,
  capabilityCompleteCount: moduleOwnershipStatusRegistry.filter((module) => module.completeness.capability).length,
};
const artifactBaseDir = workspaceArtifactBaseDir();
const artifactRoots = artifactVisibilityContract.artifactRoots.map((root) => {
  const absolutePath = join(artifactBaseDir, root.path);
  return {
    ...root,
    absolutePath,
    exists: existsSync(absolutePath),
  };
});
const reportArtifacts = artifactRoots.flatMap((root) => collectArtifactFiles(
  root.absolutePath,
  root,
  artifactBaseDir,
));
const artifactMissingRootWarnings = artifactRoots
  .filter((root) => !root.exists)
  .map((root) => ({
    warningKind: 'missing_artifact_root',
    rootKey: root.key,
    path: root.path,
    required: root.required,
    issue: root.required
      ? 'Required artifact root is missing.'
      : 'Optional artifact root is missing; artifact visibility continues with available roots.',
    reason: root.required
      ? 'Required artifact root must exist for report visibility completeness.'
      : 'Optional artifact root can be absent without blocking contract-only reporting.',
    evidenceFields: ['artifactRoot', root.path],
    owner: 'artifact_owner',
  }));
const artifactBoundaryWarnings = artifactVisibilityContract.boundaries.staticArtifactRegistryOnly === true &&
  artifactVisibilityContract.boundaries.readsArtifactFilesOnly === true &&
  artifactVisibilityContract.boundaries.changesUI === false &&
  artifactVisibilityContract.boundaries.createsRoutes === false &&
  artifactVisibilityContract.boundaries.runtimeEnforcement === false &&
  artifactVisibilityContract.boundaries.readsRealData === false &&
  artifactVisibilityContract.boundaries.writesRealData === false &&
  artifactVisibilityContract.boundaries.writesNotion === false &&
  artifactVisibilityContract.boundaries.sendsNotifications === false &&
  artifactVisibilityContract.boundaries.authorizesExternalServices === false &&
  artifactVisibilityContract.boundaries.executesActions === false &&
  artifactVisibilityContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      boundaries: artifactVisibilityContract.boundaries,
      issue: 'Artifact Visibility Registry boundary flags no longer match static/report-only requirements.',
      reason: 'Artifact visibility contract must remain static/report-only in this slice.',
      evidenceFields: ['artifactVisibilityContract.boundaries'],
      owner: 'artifact_owner',
    }];
const artifactVisibilityWarnings = [
  ...artifactMissingRootWarnings,
  ...artifactBoundaryWarnings,
];
const artifactKindSummary = Object.fromEntries(artifactVisibilityContract.artifactKinds.map((kind) => [
  kind,
  reportArtifacts.filter((artifact) => artifact.kind === kind).length,
]));
const qaArtifacts = reportArtifacts.filter((artifact) => artifact.kind === 'qa');
const engineeringArtifacts = reportArtifacts.filter((artifact) => artifact.kind === 'engineering');
const archiveArtifacts = reportArtifacts.filter((artifact) => artifact.kind === 'archive');
const qaStatusSummary = {
  qaArtifactCount: qaArtifacts.length,
  engineeringArtifactCount: engineeringArtifacts.length,
  archiveArtifactCount: archiveArtifacts.length,
  qaArtifactPaths: qaArtifacts.map((artifact) => artifact.path),
  latestQaArtifact: qaArtifacts
    .slice()
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0]?.path || null,
};
const artifactVisibilitySummary = {
  implementation: artifactVisibilityContract.implementation,
  readsArtifactFilesOnly: artifactVisibilityContract.reporting.readsArtifactFilesOnly,
  changesUI: artifactVisibilityContract.reporting.changesUI,
  createsRoutes: artifactVisibilityContract.reporting.createsRoutes,
  writesNotion: artifactVisibilityContract.reporting.writesNotion,
  readsRealData: artifactVisibilityContract.reporting.readsRealData,
  artifactRootCount: artifactRoots.length,
  existingRootCount: artifactRoots.filter((root) => root.exists).length,
  missingRootCount: artifactMissingRootWarnings.length,
  artifactCount: reportArtifacts.length,
  visibleArtifactCount: reportArtifacts.filter((artifact) => artifact.visible).length,
  engineeringArtifactCount: engineeringArtifacts.length,
  qaArtifactCount: qaArtifacts.length,
  archiveArtifactCount: archiveArtifacts.length,
  warningCount: artifactVisibilityWarnings.length,
  kindSummary: artifactKindSummary,
  qaStatusSummary,
};
const artifactStatusBoundaryWarnings = artifactStatusVisibilityContract.boundaries.localArtifactStatusOnly === true &&
  artifactStatusVisibilityContract.boundaries.readsArtifactFilesOnly === true &&
  artifactStatusVisibilityContract.boundaries.derivesStatusFromStaticArtifacts === true &&
  artifactStatusVisibilityContract.boundaries.createsTaskRecords === false &&
  artifactStatusVisibilityContract.boundaries.createsGateRecords === false &&
  artifactStatusVisibilityContract.boundaries.syncsHandoffs === false &&
  artifactStatusVisibilityContract.boundaries.runtimeEnforcement === false &&
  artifactStatusVisibilityContract.boundaries.readsRealData === false &&
  artifactStatusVisibilityContract.boundaries.writesRealData === false &&
  artifactStatusVisibilityContract.boundaries.writesNotion === false &&
  artifactStatusVisibilityContract.boundaries.sendsNotifications === false &&
  artifactStatusVisibilityContract.boundaries.authorizesExternalServices === false &&
  artifactStatusVisibilityContract.boundaries.executesActions === false &&
  artifactStatusVisibilityContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      boundaries: artifactStatusVisibilityContract.boundaries,
      issue: 'Artifact Status Visibility v0.2 boundary flags no longer match static/local/report-only requirements.',
      reason: 'Artifact status reporting must remain static-only in this phase.',
      evidenceFields: ['artifactStatusVisibilityContract.boundaries'],
      owner: 'artifact_owner',
    }];
const artifactStatusRecords = reportArtifacts.map(artifactStatusRecord);
const artifactStatusCurrentQueue = artifactStatusRecords
  .slice()
  .sort((a, b) => (
    a.visibilityPriority - b.visibilityPriority ||
    b.modifiedAt.localeCompare(a.modifiedAt)
  ))
  .slice(0, artifactStatusVisibilityContract.reporting.visibleRecordLimit);
const artifactStatusRecordWarnings = artifactStatusCurrentQueue.flatMap((record) => {
  const warnings = [];
  if (!record.artifactPath) {
    warnings.push({
      warningKind: 'missing_artifact_path',
      artifactId: record.artifactId,
      issue: 'Artifact status record is missing artifact path.',
      reason: 'Path is required to keep traceability between artifact records and files.',
      evidenceFields: ['artifactPath'],
      owner: record.handoffFrom || 'artifact_owner',
    });
  }
  if (!record.owner && record.state !== 'archived') {
    warnings.push({
      warningKind: 'missing_owner',
      artifactPath: record.artifactPath,
      issue: 'Artifact status record is missing owner.',
      reason: 'Artifact owner is required for handoff routing and decision ownership.',
      evidenceFields: ['owner'],
      owner: 'artifact_owner',
    });
  }
  if (!record.handoffParsed && ['needs_ceo', 'blocked', 'QA'].includes(record.state)) {
    warnings.push({
      warningKind: 'missing_handoff',
      artifactPath: record.artifactPath,
      state: record.state,
      issue: 'Status record requires handoff but handoff block is missing.',
      reason: 'Active QA/blocked/needs_ceo states require explicit handoff to continue workflow.',
      evidenceFields: ['state', 'handoff'],
      owner: 'artifact_owner',
    });
  }
  if (record.state === 'blocked' && !record.blocker) {
    warnings.push({
      warningKind: 'missing_blocker',
      artifactPath: record.artifactPath,
      issue: 'Blocked state record is missing blocker details.',
      reason: 'Blocked states must include blocker for restart planning.',
      evidenceFields: ['state', 'blocker'],
      owner: 'artifact_owner',
    });
  }
  if (record.state === 'QA' && !record.handoffTo) {
    warnings.push({
      warningKind: 'missing_qa_owner',
      artifactPath: record.artifactPath,
      issue: 'QA record is missing assignee.',
      reason: 'QA state requires target owner for acceptance.',
      evidenceFields: ['handoffTo'],
      owner: 'artifact_owner',
    });
  }
  if (record.state === 'needs_ceo' && record.needsCeoGate !== true) {
    warnings.push({
      warningKind: 'missing_ceo_gate_flag',
      artifactPath: record.artifactPath,
      issue: 'Needs CEO approval state did not carry explicit CEO gate flag.',
      reason: 'needs_ceo states must be marked with explicit gate flag for routing.',
      evidenceFields: ['needsCeoGate'],
      owner: 'CEO',
    });
  }
  return warnings;
});
const artifactStatusVisibilityWarnings = [
  ...artifactStatusBoundaryWarnings,
  ...artifactStatusRecordWarnings,
];
const artifactStatusStateSummary = Object.fromEntries(artifactStatusVisibilityContract.stateVocabulary.map((state) => [
  state,
  artifactStatusRecords.filter((record) => record.state === state).length,
]));
const artifactStatusCurrentQueueSummary = Object.fromEntries(artifactStatusVisibilityContract.stateVocabulary.map((state) => [
  state,
  artifactStatusCurrentQueue.filter((record) => record.state === state).length,
]));
const moduleDataKeyOwnership = Object.values(registry.dataKeyOwnership?.keys || {});
const moduleDataKeyOwnershipSharedCount = moduleDataKeyOwnership.filter((item) => item.sharingKind === 'shared').length;
const moduleDataKeyOwnershipPrivateCount = moduleDataKeyOwnership.filter((item) => item.sharingKind === 'module_private').length;
const localDataRecords = buildLocalDataRecordsV0(artifactStatusRecords, { generatedAt: reportGeneratedAt });
const moduleDataBus = buildModuleDataBus(tools, {
  generatedAt: reportGeneratedAt,
  experienceReservedData: Array.from(reservedConsumedData),
  mode: 'report-module-registry',
  dataKeyOwnership: registry.dataKeyOwnership?.keys,
});
const artifactStatusVisibilitySummary = {
  implementation: artifactStatusVisibilityContract.implementation,
  recordCount: artifactStatusRecords.length,
  currentQueueCount: artifactStatusCurrentQueue.length,
  visibleRecordLimit: artifactStatusVisibilityContract.reporting.visibleRecordLimit,
  stateSummary: artifactStatusStateSummary,
  currentQueueStateSummary: artifactStatusCurrentQueueSummary,
  handoffParsedCount: artifactStatusRecords.filter((record) => record.handoffParsed).length,
  needsCeoCount: artifactStatusStateSummary.needs_ceo,
  blockedCount: artifactStatusStateSummary.blocked,
  qaCount: artifactStatusStateSummary.QA,
  activeCount: artifactStatusStateSummary.active,
  archivedCount: artifactStatusStateSummary.archived,
  warningCount: artifactStatusVisibilityWarnings.length,
  writesNotion: artifactStatusVisibilityContract.reporting.writesNotion,
  readsRealData: artifactStatusVisibilityContract.reporting.readsRealData,
  sendsNotifications: artifactStatusVisibilityContract.reporting.sendsNotifications,
  syncsHandoffs: artifactStatusVisibilityContract.reporting.syncsHandoffs,
};
const shellDiscoveryVisibleTools = tools.filter((tool) => tool.ready && tool.id !== 'secretary');
const shellDiscoveryBoundaryWarnings = shellDiscoveryEntryContract.boundaries.shellDiscoveryOnly === true &&
  shellDiscoveryEntryContract.boundaries.minimumTouchTargetPx >= 44 &&
  shellDiscoveryEntryContract.boundaries.usesStaticRegistryMetadata === true &&
  shellDiscoveryEntryContract.boundaries.changesRouteBehavior === false &&
  shellDiscoveryEntryContract.boundaries.createsRoutes === false &&
  shellDiscoveryEntryContract.boundaries.runtimeEnforcement === false &&
  shellDiscoveryEntryContract.boundaries.readsRealData === false &&
  shellDiscoveryEntryContract.boundaries.writesRealData === false &&
  shellDiscoveryEntryContract.boundaries.writesNotion === false &&
  shellDiscoveryEntryContract.boundaries.sendsNotifications === false &&
  shellDiscoveryEntryContract.boundaries.authorizesExternalServices === false &&
  shellDiscoveryEntryContract.boundaries.executesActions === false &&
  shellDiscoveryEntryContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      boundaries: shellDiscoveryEntryContract.boundaries,
      issue: 'Shell Discovery Entry Slice boundary flags no longer match v0.1 safe shell requirements.',
    }];
const shellDiscoveryEntrySliceSummary = {
  implementation: shellDiscoveryEntryContract.implementation,
  visibleToolEntryCount: shellDiscoveryVisibleTools.length,
  localToolEntryCount: shellDiscoveryVisibleTools.filter((tool) => tool.origin === 'local').length,
  externalToolEntryCount: shellDiscoveryVisibleTools.filter((tool) => tool.origin === 'external').length,
  declaredMinimumTouchTargetPx: shellDiscoveryEntryContract.boundaries.minimumTouchTargetPx,
  moduleStatusSource: 'Module Manager registry + shell route entryStatus',
  firstScreenHint: shellDiscoveryEntryContract.entryAffordance.firstScreenHint,
  dialogTitlePattern: shellDiscoveryEntryContract.entryAffordance.dialogTitlePattern,
  selectors: shellDiscoveryEntryContract.entryAffordance,
  evidenceLocation: {
    reportSection: 'artifactVisibility',
    qaStatusSection: 'artifactVisibility.qaStatusSummary',
    latestQaArtifact: qaStatusSummary.latestQaArtifact,
  },
  boundaries: shellDiscoveryEntryContract.boundaries,
  warnings: shellDiscoveryBoundaryWarnings,
};
const mobileAppEntries = tools.map((tool) => {
  const strategy = mobileStrategyForTool(tool);
  const needsCeoGate = tool.approvalGate.gateCategories.some((category) => (
    [
      'real_data_read',
      'real_data_write',
      'real_data_migration',
      'external_authorization',
      'notification_send',
      'purchase_payment',
      'p0_p1_privacy_trust_risk',
      'production_deploy',
    ].includes(category)
  ));

  return {
    moduleId: tool.id,
    label: tool.name,
    routeKind: tool.routeKind,
    origin: tool.origin,
    publicIndexPath: tool.publicIndexPath,
    publicIndex: tool.publicIndex,
    status: tool.status || (tool.ready ? 'ready' : 'not_ready'),
    integrationMode: tool.integrationMode || tool.capabilities.mode,
    mobileStrategy: strategy,
    appSurface: strategy === 'embedded_static' ? 'capacitor_www' : strategy === 'external_webview_gated' ? 'external_webview' : 'contract_only',
    entryStatus: tool.shellRoute.entryStatus,
    modeAvailability: tool.shellRoute.modeAvailability,
    approvalGateKeys: tool.shellRoute.approvalGateKeys,
    gateCategories: tool.approvalGate.gateCategories,
    gateStatus: tool.approvalGate.status,
    needsCeoGate,
    offlineCandidate: strategy === 'embedded_static',
    nativeBridgeRequired: strategy === 'native_bridge_deferred',
    readsRealData: false,
    writesRealData: false,
    resumeAction: mobileResumeActionForStrategy(strategy),
  };
});
const mobileAppBoundaryWarnings = mobileAppIntegrationContract.boundaries.staticRegistryOnly === true &&
  mobileAppIntegrationContract.boundaries.changesNativeProject === false &&
  mobileAppIntegrationContract.boundaries.runsCapacitorSync === false &&
  mobileAppIntegrationContract.boundaries.opensXcode === false &&
  mobileAppIntegrationContract.boundaries.appStoreSubmission === false &&
  mobileAppIntegrationContract.boundaries.runtimeNativeBridge === false &&
  mobileAppIntegrationContract.boundaries.readsRealData === false &&
  mobileAppIntegrationContract.boundaries.writesRealData === false &&
  mobileAppIntegrationContract.boundaries.writesNotion === false &&
  mobileAppIntegrationContract.boundaries.sendsNotifications === false &&
  mobileAppIntegrationContract.boundaries.authorizesExternalServices === false &&
  mobileAppIntegrationContract.boundaries.executesActions === false &&
  mobileAppIntegrationContract.boundaries.productionDeploy === false
  ? []
  : [{
      warningKind: 'boundary_violation',
      issue: 'Mobile App Integration v0 boundary flags no longer match static/report-only requirements.',
      reason: 'Mobile app integration slice must not mutate native project, run sync, open Xcode, publish, or access real data.',
      evidenceFields: ['mobileAppIntegration.boundaries'],
      owner: 'Qiao',
    }];
const mobileAppIntegrationSummary = {
  implementation: mobileAppIntegrationContract.implementation,
  targetShell: mobileAppIntegrationContract.targetShell,
  moduleCount: mobileAppEntries.length,
  embeddedStaticCount: mobileAppEntries.filter((entry) => entry.mobileStrategy === 'embedded_static').length,
  externalWebviewGatedCount: mobileAppEntries.filter((entry) => entry.mobileStrategy === 'external_webview_gated').length,
  nativeBridgeDeferredCount: mobileAppEntries.filter((entry) => entry.mobileStrategy === 'native_bridge_deferred').length,
  notReadyCount: mobileAppEntries.filter((entry) => entry.mobileStrategy === 'not_ready').length,
  ceoGateModuleCount: mobileAppEntries.filter((entry) => entry.needsCeoGate).length,
  offlineCandidateCount: mobileAppEntries.filter((entry) => entry.offlineCandidate).length,
  warningCount: mobileAppBoundaryWarnings.length,
  readsRealData: mobileAppIntegrationContract.reporting.readsRealData,
  changesNativeProject: mobileAppIntegrationContract.reporting.changesNativeProject,
  runsCapacitorSync: mobileAppIntegrationContract.reporting.runsCapacitorSync,
};
const mobileEntryByModuleId = new Map(mobileAppEntries.map((entry) => [entry.moduleId, entry]));
const launchSkuShellEntry = {
  moduleId: 'shell',
  label: registry.shell.name,
  toolLifecycle: 'launchable',
  toolLifecycleStage: TOOL_LIFECYCLE_STAGE_NUMBERS.launchable,
  nextLifecycleTarget: 'monetized',
  nextLifecycleStage: TOOL_LIFECYCLE_STAGE_NUMBERS.monetized,
  readyForCandidateReview: false,
  launchEligible: true,
  monetizationEligible: false,
  canChangeRapidly: false,
  launchStatus: 'launchable',
  internalRegistryOnly: false,
  excludedFromLaunch: false,
  futurePaid: false,
  isLaunchBusinessModule: false,
  entitlementKey: 'shell.access.free',
  entitlementExists: true,
  entitlementChangesLaunchStatus: false,
  paywallState: 'free',
  approvalGateState: 'none',
  blockedByApprovalGate: false,
  blockedByPaywallGate: false,
  approvalGateOverridesPaywallGate: true,
  mobileStrategy: 'shell_container',
  needsCeoGate: false,
  appStoreFirstRelease: true,
  userVisibleAtLaunch: true,
  screenshotSafe: true,
};
const launchSkuModules = [
  launchSkuShellEntry,
  ...tools.map((tool) => launchSkuModuleEntryForTool(tool, mobileEntryByModuleId)),
];
const launchSkuWarnings = [
  ...tools
    .filter((tool) => (
      ['finance', 'health', 'psychoanalysis', 'secretary'].includes(tool.id) &&
      launchStatusForTool(tool) === 'launchable'
    ))
    .map((tool) => ({
      moduleId: tool.id,
      warningKind: 'high_risk_module_launchable',
      issue: 'High-risk module must not be launchable in first App Store SKU.',
      reason: 'Launch SKU is limited to Shell + Inventory / purchase-memory + Todo.',
      owner: 'Qiao',
      evidenceFields: ['launchSku.modules.launchStatus'],
    })),
  ...(launchSkuModules.filter((entry) => entry.launchStatus === 'launchable').length === 3
    ? []
    : [{
        warningKind: 'launchable_module_count_mismatch',
        issue: 'First-launch SKU must have exactly Shell + Inventory + Todo as launchable.',
        reason: 'Avoid making all 11 modules look App Store launchable.',
        owner: 'Qiao',
        evidenceFields: ['launchSku.modules'],
      }]),
];
const launchSkuSummary = {
  version: LAUNCH_SKU_VERSION,
  skuKey: LAUNCH_SKU_KEY,
  includedModuleIds: [...LAUNCH_INCLUDED_MODULE_IDS],
  launchableModuleCount: launchSkuModules.filter((entry) => entry.launchStatus === 'launchable').length,
  launchableBusinessModuleCount: launchSkuModules.filter((entry) => entry.isLaunchBusinessModule).length,
  excludedFromLaunchCount: launchSkuModules.filter((entry) => entry.excludedFromLaunch).length,
  futurePaidModuleCount: launchSkuModules.filter((entry) => entry.futurePaid).length,
  internalRegistryOnlyCount: launchSkuModules.filter((entry) => entry.internalRegistryOnly).length,
  hiddenModuleCount: launchSkuModules.filter((entry) => entry.launchStatus === 'hidden').length,
  gatedModuleCount: launchSkuModules.filter((entry) => entry.launchStatus === 'gated').length,
  launchSkuAppStoreReady: false,
  warningCount: launchSkuWarnings.length,
};
const launchSurfaceTools = tools.map((tool) => ({
  ...tool,
  launchStatus: launchStatusForTool(tool),
  toolLifecycle: lifecycleForTool(tool).lifecycle,
  prodExposure: tool.toolManifest?.prodExposure,
  entitlementPolicy: {
    paywallState: tool.shellEntitlement.paywallState,
  },
}));
const launchSurfaceTesterAllowlist = launchSurfaceTools
  .filter((tool) => resolveLaunchSurfaceState(tool, { viewerRole: 'public' }).prodExposure === 'tester_only')
  .map((tool) => tool.id);
const launchSurfaceEntries = launchSurfaceTools.map((tool) => {
  const publicState = resolveLaunchSurfaceState(tool, { viewerRole: 'public' });
  const testerState = resolveLaunchSurfaceState(tool, {
    viewerRole: 'tester',
    testerAllowlist: launchSurfaceTesterAllowlist,
  });
  const personalLabState = resolveLaunchSurfaceState(tool, { viewerRole: 'personal_lab' });
  return {
    moduleId: tool.id,
    label: tool.name,
    launchStatus: publicState.launchStatus,
    toolLifecycle: publicState.toolLifecycle,
    prodExposure: publicState.prodExposure,
    visibleForPublic: publicState.visible,
    visibleForTester: testerState.visible,
    visibleForPersonalLab: personalLabState.visible,
    shellAction: publicState.shellAction,
    testerShellAction: testerState.shellAction,
    personalLabShellAction: personalLabState.shellAction,
    paywallState: publicState.paywallState,
    paywallBehavior: publicState.paywallBehavior,
    approvalGateState: publicState.approvalGateState,
    blockedByApprovalGate: publicState.blockedByApprovalGate,
    blockedByPaywallGate: publicState.blockedByPaywallGate,
    approvalGateOverridesPaywallGate: publicState.approvalGateOverridesPaywallGate,
    betaBadgeRequiredForTester: testerState.betaBadgeRequired,
    betaBadgeRequiredForPersonalLab: personalLabState.betaBadgeRequired,
    personalLabRealRuntimeEnabled: personalLabState.realRuntimeEnabled,
    appStoreMentionAllowed: publicState.appStoreMentionAllowed,
    screenshotSafe: publicState.screenshotSafe,
  };
});
const launchSurfaceSummary = buildLaunchReadinessSummary(launchSurfaceTools, {
  testerAllowlist: launchSurfaceTesterAllowlist,
});
function permissionConsentEntryForTool(tool) {
  const sensitiveCapabilities = [...(SENSITIVE_CAPABILITY_BY_MODULE[tool.id] || [])];
  const isHighRiskSensitive = ['secretary', 'health', 'finance', 'psychoanalysis'].includes(tool.id);
  const permissions = tool.id === 'inventory' ? [...INVENTORY_PERMISSION_PURPOSES] : [];
  const consentRequired = isHighRiskSensitive || permissions.some((permission) => permission.consentRequired);
  const runtimeEnabled = isHighRiskSensitive ? false : launchStatusForTool(tool) === 'launchable';

  return {
    moduleId: tool.id,
    label: tool.name,
    consentRequired,
    defaultConsentState: consentRequired ? 'not_requested' : 'not_required',
    runtimeEnabled,
    consentVersion: `${tool.id}.consent-v0`,
    capabilityConsentVersion: `${tool.id}.capability-consent-v0`,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    permissions,
    sensitiveCapabilities,
    capabilityLevelConsent: sensitiveCapabilities.map((capabilityKey) => ({
      capabilityKey,
      consentRequired: true,
      consentVersion: `${tool.id}.${capabilityKey}.consent-v0`,
      runtimeEnabled: false,
    })),
    reConsentTriggers: [...RE_CONSENT_TRIGGERS],
    auditSafeSummary: {
      includesContent: false,
      includesPersonalData: false,
      includesPrompt: false,
      includesHealthData: false,
      includesFinanceData: false,
      includesPsychoanalysisContent: false,
      fields: [
        'moduleId',
        'consentVersion',
        'privacyPolicyVersion',
        'consentRequired',
        'runtimeEnabled',
        'sensitiveCapabilityCount',
      ],
    },
    auditSafeSummaryIncludesContent: false,
  };
}
const permissionConsentTools = tools.map(permissionConsentEntryForTool);
const permissionConsentSummary = {
  version: PERMISSION_CONSENT_VERSION,
  toolCount: permissionConsentTools.length,
  consentRequiredCount: permissionConsentTools.filter((entry) => entry.consentRequired).length,
  sensitiveDisabledCount: permissionConsentTools.filter((entry) => (
    entry.consentRequired && entry.runtimeEnabled === false && entry.sensitiveCapabilities.length > 0
  )).length,
  permissionPurposeCount: permissionConsentTools.reduce((count, entry) => count + entry.permissions.length, 0),
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  realConsentModalEnabled: false,
};
const permissionConsentContract = {
  version: PERMISSION_CONSENT_VERSION,
  implementation: 'report-only-contract',
  privacyPolicy: {
    version: PRIVACY_POLICY_VERSION,
    recordable: true,
    legalCommitmentGenerated: false,
    publicPolicyFinalized: false,
  },
  reConsentTriggers: [...RE_CONSENT_TRIGGERS],
  boundaries: {
    reportOnly: true,
    realConsentModalEnabled: false,
    legalCommitmentGenerated: false,
    realSensitiveProcessingEnabled: false,
    writesConsentRecords: false,
    externalConsentServiceEnabled: false,
  },
  summary: permissionConsentSummary,
  tools: permissionConsentTools,
};
function featureControlEntryForTool(tool) {
  const launchStatus = launchStatusForTool(tool);
  const killed = false;
  const canOpenAtRuntime = !killed && launchStatus === 'launchable' && tool.ready === true;
  const highRisk = FEATURE_CONTROL_HIGH_RISK_MODULES.includes(tool.id);

  return {
    moduleId: tool.id,
    label: tool.name,
    killSwitchKey: `kill.module.${tool.id}`,
    featureKillSwitchKeys: [
      `kill.feature.${tool.id}.external_service`,
      ...(highRisk ? [`kill.feature.${tool.id}.sensitive_runtime`] : []),
    ],
    sandboxExposureSwitchKey: `expose.sandbox.${tool.id}`,
    minimumAppVersion: '1.0.0',
    maintenanceModeKey: `maintenance.module.${tool.id}`,
    incidentBannerKey: `incident.module.${tool.id}`,
    localFallbackConfig: true,
    canBeKilled: true,
    killed,
    defaultFailClosed: highRisk || launchStatus !== 'launchable',
    canOpenAtRuntime,
    entryActionEnabled: canOpenAtRuntime,
    deletesUserData: false,
    launchStatus,
  };
}
const featureControlModules = tools.map(featureControlEntryForTool);
const featureControlSummary = {
  version: FEATURE_CONTROL_VERSION,
  moduleCount: featureControlModules.length,
  killSwitchCapableModuleCount: featureControlModules.filter((entry) => entry.canBeKilled).length,
  killedModuleCount: featureControlModules.filter((entry) => entry.killed).length,
  entryActionEnabledCount: featureControlModules.filter((entry) => entry.entryActionEnabled).length,
  remoteFeatureControlEnabled: false,
};
const featureControlContract = {
  version: FEATURE_CONTROL_VERSION,
  implementation: 'local-static-config',
  summary: featureControlSummary,
  readyToCandidateModuleIds: featureControlModules
    .filter((entry) => entry.entryActionEnabled)
    .map((entry) => entry.moduleId),
  boundaries: {
    remoteConfigEnabled: false,
    realtimePushEnabled: false,
    productionIncidentNotificationEnabled: false,
    deletesUserData: false,
    localStaticConfigOnly: true,
    changesDataRetention: false,
  },
  modules: featureControlModules,
};
const reportToolsWithLaunchState = tools.map((tool) => ({
  ...tool,
  launchStatus: launchStatusForTool(tool),
  toolLifecycle: lifecycleForTool(tool).lifecycle,
  prodExposure: tool.prodExposure || tool.toolManifest?.prodExposure,
}));
const standaloneAppReadinessContract = buildStandaloneAppReadinessContract(reportToolsWithLaunchState);
const securityIncidentReadinessContract = buildSecurityIncidentReadinessContract(
  reportToolsWithLaunchState,
  featureControlModules,
);
const moduleProductContract = buildModuleProductContractV0(reportToolsWithLaunchState);
const webSurfaceContract = buildWebSurfaceContractV0({
  modules: reportToolsWithLaunchState,
  moduleProductContract,
  mobileAppIntegration: mobileAppIntegrationContract,
});
const moduleAdapterContract = buildModuleAdapterContract(launchSkuModules.filter((entry) => entry.moduleId !== 'shell').map((entry) => {
  const tool = tools.find((candidate) => candidate.id === entry.moduleId);
  return {
    ...tool,
    launchStatus: entry.launchStatus,
    toolLifecycle: entry.toolLifecycle,
  };
}));
const toolDataVersioningContract = buildToolDataVersioningContract(tools.map((tool) => ({
  ...tool,
  launchStatus: launchStatusForTool(tool),
})));
const userIdentityUpgradeContract = buildUserIdentityUpgradeContract(config);
const offlineSyncConflictContract = buildOfflineSyncConflictContract(reportToolsWithLaunchState);
const cloudReadinessContract = buildCloudReadinessContract({
  userIdentityUpgrade: userIdentityUpgradeContract,
  offlineSyncConflict: offlineSyncConflictContract,
});
const productionActivationContract = buildProductionActivationContract();
const aiProviderRouterContract = buildAiProviderRouterContract();
const nesioDesignSystemSummary = {
  canonicalName: 'Nesio',
  originalDownloadName: 'Nosio',
  runtimeSurfaceCount: nesioDesignSystemContract.runtimeSurfaces.length,
  requiredTokenFileCount: nesioDesignSystemContract.source.requiredTokenFiles.length,
  requiredComponentFileCount: nesioDesignSystemContract.source.requiredComponentFiles.length,
  guardrailCount: Object.keys(nesioDesignSystemContract.guardrails).length,
  wholesaleUiReplacementAllowed: nesioDesignSystemContract.guardrails.noWholesaleUiReplacement !== true,
  shellKitReferenceOnly: nesioDesignSystemContract.guardrails.shellKitIsReferenceOnly === true,
  allModalsUseSharedGlassTokens: nesioDesignSystemContract.guardrails.allModalsUseSharedGlassTokens === true,
  allTouchTargetsAtLeast44px: nesioDesignSystemContract.guardrails.allTouchTargetsAtLeast44px === true,
};
const toolLifecycleSummary = {
  version: TOOL_LIFECYCLE_VERSION,
  stageVocabulary: [...TOOL_LIFECYCLE_STAGES],
  stageNumbers: { ...TOOL_LIFECYCLE_STAGE_NUMBERS },
  totalModuleCount: tools.length,
  launchableToolCount: tools.filter((tool) => lifecycleForTool(tool).lifecycle === 'launchable').length,
  sandboxToolCount: tools.filter((tool) => lifecycleForTool(tool).lifecycle === 'sandbox').length,
  candidateToolCount: tools.filter((tool) => lifecycleForTool(tool).lifecycle === 'candidate').length,
  readyForCandidateReviewCount: tools.filter((tool) => lifecycleForTool(tool).readyForCandidateReview).length,
  rapidChangeAllowedCount: tools.filter((tool) => lifecycleForTool(tool).canChangeRapidly).length,
  nextCandidateModuleIds: tools
    .filter((tool) => lifecycleForTool(tool).nextLifecycleTarget === 'candidate')
    .map((tool) => tool.id),
  launchableModuleIds: tools
    .filter((tool) => lifecycleForTool(tool).lifecycle === 'launchable')
    .map((tool) => tool.id),
};
const aggregationReportStatus = boundaryWarnings.length || experienceServiceWarnings.length || aggregationWarnings.length
  ? 'warning'
  : 'pass';
const evidenceSummary = {
  generatedAt: reportGeneratedAt,
  sourceContracts: [
    'lib/portal/module-manager-core.mjs',
    'lib/portal/module-manager-core.d.ts',
    'scripts/report-module-registry.mjs',
    'lib/portal/local-data-records.mjs',
  ],
  reportStatus: aggregationReportStatus,
  checks: [
    {
      id: 'read_only_metadata',
      status: dataAggregationContract.boundaries.readOnlyMetadata ? 'pass' : 'blocked',
      detail: 'Report uses module registry declarations only.',
    },
    {
      id: 'no_real_data_access',
      status: dataAggregationContract.boundaries.readsRealData === false ? 'pass' : 'blocked',
      detail: 'No task, item, note, message, photo, health, purchase, or conversation records are read.',
    },
    {
      id: 'no_runtime_enforcement',
      status: dataAggregationContract.boundaries.runtimeEnforcement === false ? 'pass' : 'blocked',
      detail: 'Aggregation warnings are QA/report prompts only.',
    },
  ],
  boundariesPreserved: dataAggregationContract.boundaries,
};

  const report = {
    summary: {
    status: boundaryWarnings.length === 0 && experienceServiceWarnings.length === 0 && aggregationWarnings.length === 0
      ? 'pass'
      : 'warn',
    moduleCount: tools.length,
    readyModuleCount: readyModules.length,
    localStaticModuleCount: tools.filter((tool) => tool.routeKind === 'local-static-module').length,
    localShellRouteCount: tools.filter((tool) => tool.routeKind === 'local-shell-route').length,
    externalLinkCount: tools.filter((tool) => tool.routeKind === 'external-link').length,
    capabilityContractCount: tools.filter((tool) => (
      tool.ownedData.length > 0 ||
      tool.consumedData.length > 0 ||
      tool.emittedEvents.length > 0 ||
      tool.allowedActions.length > 0
    )).length,
    experienceServicesKnownKeyModuleCount: modulesUsingKnownExperienceKeys.length,
    approvalGateContractCount: tools.filter((tool) => tool.approvalRequiredActions.length > 0).length,
    approvalGateKnownActionCount: approvalGateSummary.knownApprovalActionCount,
    approvalGateUnknownActionCount: approvalGateSummary.unknownApprovalActionCount,
    shellRouteCount: shellRouteSummary.shellRouteCount,
    readyShellRouteCount: shellRouteSummary.readyShellRouteCount,
    unconnectedRouteCount: shellRouteSummary.unconnectedRouteCount,
    gatedRouteCount: shellRouteSummary.gatedRouteCount,
    boundaryWarningCount: boundaryWarnings.length,
    launchExposureIntentionalExclusionCount: launchExposureSemantics.intentionalExclusionCount,
    launchExposureReleaseBlockerCount: launchExposureSemantics.releaseBlockerCount,
    experienceServiceWarningCount: experienceServiceWarnings.length,
    dataAggregationWarningCount: aggregationWarnings.length,
    approvalGateWarningCount: approvalGateWarnings.length,
    shellRouteWarningCount: shellRouteWarnings.length,
    dataAggregationReviewWarningCount,
    dataAggregationRuntimeBlockerCount,
    registryDriftWarningCount: registryDriftWarnings.length,
    ownershipCompleteModuleCount: moduleOwnershipStatusSummary.completeModuleCount,
    artifactCount: artifactVisibilitySummary.artifactCount,
    visibleArtifactCount: artifactVisibilitySummary.visibleArtifactCount,
    artifactVisibilityWarningCount: artifactVisibilityWarnings.length,
    artifactStatusRecordCount: artifactStatusVisibilitySummary.recordCount,
    artifactStatusCurrentQueueCount: artifactStatusVisibilitySummary.currentQueueCount,
    artifactStatusVisibilityWarningCount: artifactStatusVisibilityWarnings.length,
    moduleDataBusWarningCount: moduleDataBus.summary.warningCount,
    moduleDataKeyOwnershipSharedCount,
    moduleDataKeyOwnershipPrivateCount,
    moduleDataBusEdgeCount: moduleDataBus.summary.edgeCount,
    moduleDataBusConnectedDataKeyCount: moduleDataBus.summary.connectedDataKeyCount,
    localDataArtifactRecordCount: localDataRecords.summary.artifactRecordCount,
    localDataHandoffRecordCount: localDataRecords.summary.handoffRecordCount,
    localDataGateRecordCount: localDataRecords.summary.gateRecordCount,
    shellDiscoveryEntryWarningCount: shellDiscoveryBoundaryWarnings.length,
    shellDiscoveryVisibleToolEntryCount: shellDiscoveryEntrySliceSummary.visibleToolEntryCount,
    mobileAppIntegrationModuleCount: mobileAppIntegrationSummary.moduleCount,
    mobileEmbeddedStaticCount: mobileAppIntegrationSummary.embeddedStaticCount,
    mobileExternalWebviewGatedCount: mobileAppIntegrationSummary.externalWebviewGatedCount,
    mobileNativeBridgeDeferredCount: mobileAppIntegrationSummary.nativeBridgeDeferredCount,
    mobileCeoGateModuleCount: mobileAppIntegrationSummary.ceoGateModuleCount,
    mobileAppIntegrationWarningCount: mobileAppBoundaryWarnings.length,
    entitlementProductCount: entitlementSummary.productCount,
    entitlementBundleCount: entitlementSummary.bundleCount,
    entitlementModuleCount: entitlementSummary.moduleEntitlementCount,
    entitlementReportOnly: entitlementSummary.reportOnly,
    entitlementBehaviorEnabled: entitlementSummary.behaviorEnabled,
    entitlementStoreKitEnabled: entitlementSummary.storeKitEnabled,
    entitlementPriceConfigured: entitlementSummary.priceConfigured,
    paywallBlockedModuleCount: entitlementSummary.blockedByPaywallGateCount,
    launchableModuleCount: launchSkuSummary.launchableModuleCount,
    excludedFromLaunchCount: launchSkuSummary.excludedFromLaunchCount,
    futurePaidModuleCount: launchSkuSummary.futurePaidModuleCount,
    launchSkuAppStoreReady: launchSkuSummary.launchSkuAppStoreReady,
    launchSkuWarningCount: launchSkuSummary.warningCount,
    launchSurfaceVersion: LAUNCH_SURFACE_VERSION_V0,
    launchSurfacePublicVisibleModuleCount: launchSurfaceSummary.publicVisibleModuleCount,
    launchSurfaceTesterVisibleSandboxModuleCount: launchSurfaceSummary.testerVisibleSandboxModuleCount,
    launchSurfacePublicHiddenHighRiskModuleCount: launchSurfaceSummary.publicHiddenHighRiskModuleCount,
    launchSurfaceAppStoreReady: launchSurfaceSummary.launchSurfaceAppStoreReady,
    launchSurfaceRealPurchaseEnabled: launchSurfaceSummary.realPurchaseEnabled,
    launchSurfaceStoreKitEnabled: launchSurfaceSummary.storeKitEnabled,
    permissionConsentToolCount: permissionConsentSummary.toolCount,
    permissionConsentRequiredCount: permissionConsentSummary.consentRequiredCount,
    permissionConsentSensitiveDisabledCount: permissionConsentSummary.sensitiveDisabledCount,
    permissionPurposeCount: permissionConsentSummary.permissionPurposeCount,
    privacyPolicyVersion: permissionConsentSummary.privacyPolicyVersion,
    featureControlModuleCount: featureControlSummary.moduleCount,
    killSwitchCapableModuleCount: featureControlSummary.killSwitchCapableModuleCount,
    killedModuleCount: featureControlSummary.killedModuleCount,
    featureControlEntryActionEnabledCount: featureControlSummary.entryActionEnabledCount,
    remoteFeatureControlEnabled: featureControlSummary.remoteFeatureControlEnabled,
    standaloneReadinessVersion: standaloneAppReadinessContract.version,
    standaloneReadinessReadyNowCount: standaloneAppReadinessContract.summary.readyNowCount,
    standaloneReadinessPossibleLaterCount: standaloneAppReadinessContract.summary.possibleLaterCount,
    standaloneReadinessWarningCount: standaloneAppReadinessContract.summary.warningCount,
    securityIncidentReadinessVersion: securityIncidentReadinessContract.version,
    securityIncidentHighRiskModuleCount: securityIncidentReadinessContract.summary.highRiskModuleCount,
    securityIncidentRealActionEnabledCount: securityIncidentReadinessContract.summary.realActionEnabledCount,
    securityIncidentWarningCount: securityIncidentReadinessContract.summary.warningCount,
    moduleProductContractVersion: moduleProductContract.version,
    moduleProductContractModuleCount: moduleProductContract.summary.moduleCount,
    moduleProductPublicVisibleCount: moduleProductContract.summary.publicVisibleCount,
    moduleProductAppStoreMentionAllowedCount: moduleProductContract.summary.appStoreMentionAllowedCount,
    moduleProductWarningCount: moduleProductContract.summary.warningCount,
    moduleTrustBoundaryHighTrustCount: moduleProductContract.moduleTrustBoundary.summary.highTrustModuleCount,
    coreObjectModelGroupCount: Object.keys(moduleProductContract.coreObjectModels.groups).length,
    webSurfaceContractVersion: webSurfaceContract.version,
    mobileWebSupported: webSurfaceContract.summary.mobileWebSupported,
    pwaSupported: webSurfaceContract.summary.pwaSupported,
    desktopPreviewOnly: webSurfaceContract.summary.desktopPreviewOnly,
    desktopDashboardEnabled: webSurfaceContract.summary.desktopDashboardEnabled,
    webSurfaceWarningCount: webSurfaceContract.summary.warningCount,
    toolLifecycleVersion: toolLifecycleSummary.version,
    toolLifecycleLaunchableCount: toolLifecycleSummary.launchableToolCount,
    toolLifecycleSandboxCount: toolLifecycleSummary.sandboxToolCount,
    toolLifecycleReadyForCandidateReviewCount: toolLifecycleSummary.readyForCandidateReviewCount,
    toolLifecycleRapidChangeAllowedCount: toolLifecycleSummary.rapidChangeAllowedCount,
    inventoryFirstLaunchDemoItemCount: inventoryFirstLaunchSummary.demoFixtureItemCount,
    inventoryFirstLaunchReadsRealData: inventoryFirstLaunchSummary.readsRealData,
    inventoryFirstLaunchWritesRealData: inventoryFirstLaunchSummary.writesRealData,
    inventoryFirstLaunchCloudSyncEnabled: inventoryFirstLaunchSummary.cloudSyncEnabled,
    inventoryFirstLaunchExternalAuthEnabled: inventoryFirstLaunchSummary.externalAuthEnabled,
    inventoryFirstLaunchPaymentIntegrationEnabled: inventoryFirstLaunchSummary.paymentIntegrationEnabled,
    toolManifestVersion: registry.toolManifest.version,
    toolManifestModuleCount: registry.toolManifest.summary.moduleCount,
    toolManifestMissingRequiredFieldCount: registry.toolManifest.summary.missingRequiredFieldCount,
    toolManifestWarningCount: registry.toolManifest.summary.warningCount,
    toolManifestPublicModuleCount: registry.toolManifest.summary.publicModuleCount,
    toolManifestTesterOnlyModuleCount: registry.toolManifest.summary.testerOnlyModuleCount,
    moduleAdapterContractVersion: moduleAdapterContract.version,
    modularMonolithArchitecture: moduleAdapterContract.architecture,
    standaloneAppModuleCount: moduleAdapterContract.summary.standaloneAppCount,
    extractableNowCount: moduleAdapterContract.summary.extractableNowCount,
    adapterContractWarningCount: moduleAdapterContract.summary.warningCount,
    toolDataVersioningContractVersion: toolDataVersioningContract.version,
    toolDataMigrationPlanCoverageCount: toolDataVersioningContract.summary.migrationPlanCoverageCount,
    toolDataRealMigrationEnabledCount: toolDataVersioningContract.summary.realMigrationEnabledCount,
    toolDataCeoGateRequiredForRealMigration: toolDataVersioningContract.boundaries.realDataMigrationRequiresCeoGate,
    toolDataVersioningWarningCount: toolDataVersioningContract.summary.warningCount,
    accountSystemEnabled: userIdentityUpgradeContract.summary.accountSystemEnabled,
    supportedAuthProviderCount: userIdentityUpgradeContract.summary.supportedAuthProviderCount,
    currentProfileKind: userIdentityUpgradeContract.summary.currentProfileKind,
    serverUserIdEnabled: userIdentityUpgradeContract.summary.serverUserIdEnabled,
    identityUpgradePathReadable: userIdentityUpgradeContract.summary.identityUpgradePathReadable,
    syncEnabledModuleCount: offlineSyncConflictContract.summary.syncEnabledModuleCount,
    cloudSyncEnabled: offlineSyncConflictContract.summary.cloudSyncEnabled,
    offlineQueueEnabledNow: offlineSyncConflictContract.summary.offlineQueueEnabledNow,
    syncConflictModelReadable: offlineSyncConflictContract.summary.syncConflictModelReadable,
    inventorySyncReadiness: offlineSyncConflictContract.summary.inventorySyncReadiness,
    cloudReadinessVersion: cloudReadinessContract.summary.cloudReadinessVersion,
    cloudEnabled: cloudReadinessContract.summary.cloudEnabled,
    realCloudProviderConnected: cloudReadinessContract.summary.realCloudProviderConnected,
    cloudProviderCandidateCount: cloudReadinessContract.summary.cloudProviderCandidateCount,
    configuredCloudProviderCount: cloudReadinessContract.summary.configuredCloudProviderCount,
    enabledCloudProviderCount: cloudReadinessContract.summary.enabledCloudProviderCount,
    inventoryCloudSchemaDraftReady: cloudReadinessContract.summary.inventoryCloudSchemaDraftReady,
    futureCloudEligibleTableCount: cloudReadinessContract.summary.futureCloudEligibleTableCount,
    productionActivationVersion: productionActivationContract.version,
    productionActivationCeoApproved: productionActivationContract.summary.ceoApproved,
    productionActivationProviderCount: productionActivationContract.summary.providerCount,
    productionActivationConfiguredProviderCount: productionActivationContract.summary.configuredProviderCount,
    productionActivationMissingEnvProviderCount: productionActivationContract.summary.missingEnvProviderCount,
    productionActivationReady: productionActivationContract.summary.productionReady,
    aiProviderRouterVersion: aiProviderRouterContract.summary.aiProviderRouterVersion,
    aiProviderConfiguredCount: aiProviderRouterContract.summary.aiProviderConfiguredCount,
    aiProviderEnabledCount: aiProviderRouterContract.summary.aiProviderEnabledCount,
    aiRealProviderCallsEnabled: aiProviderRouterContract.summary.aiRealProviderCallsEnabled,
    defaultAiProvider: aiProviderRouterContract.summary.defaultAiProvider,
    nesioDesignSystemVersion: nesioDesignSystemContract.version,
    nesioRuntimeSurfaceCount: nesioDesignSystemSummary.runtimeSurfaceCount,
    nesioDesignSystemGuardrailCount: nesioDesignSystemSummary.guardrailCount,
    nesioDesignSystemWholesaleUiReplacementAllowed: nesioDesignSystemSummary.wholesaleUiReplacementAllowed,
    qaLine: boundaryWarnings.length === 0 && experienceServiceWarnings.length === 0 && aggregationWarnings.length === 0 && approvalGateWarnings.length === 0 && shellRouteWarnings.length === 0 && registryDriftWarnings.length === 0 && artifactVisibilityWarnings.length === 0 && artifactStatusVisibilityWarnings.length === 0 && shellDiscoveryBoundaryWarnings.length === 0 && mobileAppBoundaryWarnings.length === 0
      ? `PASS: ${readyModules.length}/${tools.length} modules ready; ${launchExposureSemantics.intentionalExclusionCount} intentional launch exclusion(s) are hidden from the public bundle.`
      : `WARN: ${boundaryWarnings.length} module boundary warning(s), ${launchExposureSemantics.intentionalExclusionCount} intentional launch exclusion(s), ${experienceServiceWarnings.length} Experience Services warning(s), ${dataAggregationReviewWarningCount} Data Aggregation review warning(s), ${dataAggregationRuntimeBlockerCount} Data Aggregation runtime-blocking warning(s), ${approvalGateWarnings.length} Approval Gate warning(s), ${shellRouteWarnings.length} Shell Route warning(s), ${registryDriftWarnings.length} Registry Drift warning(s), ${artifactVisibilityWarnings.length} Artifact Visibility warning(s), ${artifactStatusVisibilityWarnings.length} Artifact Status Visibility warning(s), ${shellDiscoveryBoundaryWarnings.length} Shell Discovery warning(s), ${mobileAppBoundaryWarnings.length} Mobile App Integration warning(s) need QA review.`,
  },
  shell: {
    title: registry.shell.name,
    returnHref: registry.shell.returnHref,
    moduleCount: tools.length,
    readyModuleCount: readyModules.length,
  },
  boundaries: {
    localStaticModules: tools.filter((tool) => tool.routeKind === 'local-static-module').map((tool) => tool.id),
    localShellRoutes: tools.filter((tool) => tool.routeKind === 'local-shell-route').map((tool) => tool.id),
    externalLinks: tools.filter((tool) => tool.routeKind === 'external-link').map((tool) => tool.id),
    syncedEmbeddedModules: tools
      .filter((tool) => tool.syncedDirectory && mobileStrategyForTool(tool) === 'embedded_static')
      .map((tool) => tool.id),
    publicLaunchEmbeddedModules: launchExposureSemantics.publicLaunchEmbeddedModules,
    syncedExternalLinks: tools
      .filter((tool) => tool.syncedDirectory && tool.routeKind === 'external-link')
      .map((tool) => tool.id),
    boundaryWarnings,
  },
  launchExposureSemantics,
  contracts: {
    capabilities: Object.fromEntries(tools.map((tool) => [tool.id, tool.capabilities])),
    data: Object.fromEntries(tools.map((tool) => [tool.id, {
      ownedData: tool.ownedData,
      consumedData: tool.consumedData,
    }])),
    events: Object.fromEntries(tools.map((tool) => [tool.id, tool.emittedEvents])),
    actions: Object.fromEntries(tools.map((tool) => [tool.id, {
      allowedActions: tool.allowedActions,
      approvalRequiredActions: tool.approvalRequiredActions,
    }])),
  },
  experienceServices: {
    contract: registry.experienceServices,
    reservedKeys: experienceReservedKeys,
    usage: Object.fromEntries(tools.map((tool) => [tool.id, tool.experienceServices])),
    modulesUsingKnownKeys: modulesUsingKnownExperienceKeys.map((tool) => tool.id),
    warnings: experienceServiceWarnings,
  },
  dataAggregation: {
    contract: dataAggregationContract,
    moduleSummary,
    capabilitySummary,
    riskSummary,
    approvalSummary,
    reviewWarningCount: dataAggregationReviewWarningCount,
    runtimeBlockerWarningCount: dataAggregationRuntimeBlockerCount,
    evidenceSummary,
    warnings: aggregationWarnings,
  },
  approvalGate: {
    contract: approvalGateContract,
    usage: Object.fromEntries(tools.map((tool) => [tool.id, tool.approvalGate])),
    summary: approvalGateSummary,
    categorySummary: approvalGateCategorySummary,
    requestMatrix: approvalRequestMatrix,
    requestMatrixSummary: approvalRequestMatrixSummary,
    warnings: approvalGateWarnings,
  },
  convergenceMatrix,
  shellRoutes: {
    contract: shellRouteContract,
    routes: shellRoutes,
    routeKeyIndex: shellRouteKeyIndex,
    summary: shellRouteSummary,
    modeAvailabilitySummary: shellRouteModeAvailabilitySummary,
    entryStatusSummary: shellRouteEntryStatusSummary,
    warnings: shellRouteWarnings,
  },
  registryDriftGuard: {
    summary: registryDriftGuardSummary,
    warnings: registryDriftWarnings,
  },
  moduleOwnershipStatusRegistry: {
    summary: moduleOwnershipStatusSummary,
    modules: moduleOwnershipStatusRegistry,
  },
  artifactVisibility: {
    contract: artifactVisibilityContract,
    roots: artifactRoots,
    summary: artifactVisibilitySummary,
    reportArtifacts,
    evidenceLinks: reportArtifacts.flatMap((artifact) => artifact.evidenceLinks),
    qaStatusSummary,
    warnings: artifactVisibilityWarnings,
  },
  artifactStatusVisibility: {
    contract: artifactStatusVisibilityContract,
    summary: artifactStatusVisibilitySummary,
    currentQueue: artifactStatusCurrentQueue,
    records: artifactStatusRecords,
    warnings: artifactStatusVisibilityWarnings,
  },
  localDataRecords: {
    contract: localDataRecords.implementation,
    summary: localDataRecords.summary,
    boundaries: localDataRecords.boundaries,
    artifactRecords: localDataRecords.artifactRecords,
    handoffRecords: localDataRecords.handoffRecords,
    gateRecords: localDataRecords.gateRecords,
    warnings: localDataRecords.warnings,
  },
  shellDiscoveryEntrySlice: {
    contract: shellDiscoveryEntryContract,
    summary: shellDiscoveryEntrySliceSummary,
    moduleStatusSummary: {
      entryStatusSummary: shellRouteEntryStatusSummary,
      modeAvailabilitySummary: shellRouteModeAvailabilitySummary,
      ownershipStatusSummary: moduleOwnershipStatusSummary,
    },
    evidenceLocation: shellDiscoveryEntrySliceSummary.evidenceLocation,
    warnings: shellDiscoveryBoundaryWarnings,
  },
  mobileAppIntegration: {
    contract: mobileAppIntegrationContract,
    summary: mobileAppIntegrationSummary,
    modules: mobileAppEntries,
    warnings: mobileAppBoundaryWarnings,
  },
  entitlements: {
    contract: entitlementContract,
    summary: entitlementSummary,
    products: entitlementProducts,
    bundles: entitlementBundles,
    moduleEntitlements,
    shellEntitlementViews,
    boundaries: {
      reportOnly: true,
      changesRuntimeBehavior: false,
      connectsStoreKit: false,
      validatesReceipts: false,
      setsPrices: false,
      writesAppStoreConnect: false,
      callsExternalPaymentService: false,
      approvalGateIsPaywallGate: false,
    },
  },
  launchSku: {
    version: LAUNCH_SKU_VERSION,
    skuKey: LAUNCH_SKU_KEY,
    label: 'Shell + Inventory / purchase-memory + Todo',
    includedModuleIds: [...LAUNCH_INCLUDED_MODULE_IDS],
    launchableBusinessModuleIds: [...LAUNCH_BUSINESS_MODULE_IDS],
    launchSkuAppStoreReady: false,
    appStoreSubmissionEnabled: false,
    summary: launchSkuSummary,
    boundaries: {
      reportOnly: true,
      storeKitEnabled: false,
      realPaymentEnabled: false,
      externalAuthEnabled: false,
      cloudSyncEnabled: false,
      appStoreSubmissionEnabled: false,
      changesRuntimeBehavior: false,
      readsRealData: false,
      writesRealData: false,
    },
    modules: launchSkuModules,
    warnings: launchSkuWarnings,
  },
  launchSurface: {
    version: LAUNCH_SURFACE_VERSION_V0,
    implementation: 'manifest-driven-shell-visibility-contract',
    firstLaunchPromise: 'Shell + Inventory / purchase-memory + Todo',
    appStoreReady: false,
    boundaries: {
      reportAndShellVisibilityOnly: true,
      storeKitEnabled: false,
      realPurchaseEnabled: false,
      externalAuthEnabled: false,
      cloudSyncEnabled: false,
      appStoreSubmissionEnabled: false,
      changesPaymentRuntime: false,
      approvalGateOverridesPaywallGate: true,
    },
    testerAllowlistPolicy: {
      source: 'local_query_or_storage_allowlist',
      accountSystemRequired: false,
      externalFeatureFlagSaaS: false,
      defaultPublicUserSeesSandbox: false,
    },
    summary: launchSurfaceSummary,
    entries: launchSurfaceEntries,
  },
  permissionConsent: permissionConsentContract,
  featureControl: featureControlContract,
  standaloneAppReadiness: standaloneAppReadinessContract,
  securityIncidentReadiness: securityIncidentReadinessContract,
  moduleProductContract,
  moduleTrustBoundary: moduleProductContract.moduleTrustBoundary,
  coreObjectModels: moduleProductContract.coreObjectModels,
  webSurfaceContract,
  nesioDesignSystem: {
    version: nesioDesignSystemContract.version,
    source: nesioDesignSystemContract.source,
    tokens: nesioDesignSystemContract.tokens,
    runtimeSurfaces: nesioDesignSystemContract.runtimeSurfaces,
    guardrails: nesioDesignSystemContract.guardrails,
    assets: nesioDesignSystemAssets,
    summary: nesioDesignSystemSummary,
    boundaries: {
      reportOnly: true,
      changesRuntimeBehavior: false,
      importsDownloadDirectoryAtRuntime: false,
      importsDesignSystemDemoBundleAtRuntime: false,
      wholesaleUiReplacementAllowed: false,
    },
  },
  toolLifecycle: {
    version: TOOL_LIFECYCLE_VERSION,
    stageVocabulary: [...TOOL_LIFECYCLE_STAGES],
    summary: toolLifecycleSummary,
    modules: tools.map((tool) => ({
      moduleId: tool.id,
      label: tool.name,
      ...lifecycleForTool(tool),
      launchStatus: launchStatusForTool(tool),
      approvalGateState: tool.shellEntitlement.approvalGateState,
      paywallState: tool.shellEntitlement.paywallState,
      needsCeoGate: mobileEntryByModuleId.get(tool.id)?.needsCeoGate === true,
    })),
    policy: {
      inventoryTargetStage: 'launchable',
      nonInventoryTargetStage: 'sandbox',
      nonInventoryNextStage: 'candidate',
      monetizedRequiresLaunchable: true,
      realDataExternalAiPaymentRequiresCeoGate: true,
    },
  },
  inventoryFirstLaunch: {
    contract: inventoryFirstLaunchContract,
    summary: inventoryFirstLaunchSummary,
  },
  toolManifest: registry.toolManifest,
  moduleAdapterContract,
  toolDataVersioning: toolDataVersioningContract,
  userIdentityUpgrade: userIdentityUpgradeContract,
  offlineSyncConflict: offlineSyncConflictContract,
  cloudReadiness: cloudReadinessContract,
  aiProviderRouter: aiProviderRouterContract,
  productionActivation: productionActivationContract,
  moduleDataBus: {
    implementation: moduleDataBus.implementation,
    summary: moduleDataBus.summary,
    modules: moduleDataBus.modules,
    dataCatalog: moduleDataBus.dataCatalog,
    edges: moduleDataBus.edges,
    dataKeyOwnershipPolicy: registry.dataKeyOwnership?.keys,
    interconnectPlan: moduleDataBus.interconnectPlan,
    crossBoundarySummary: moduleDataBus.crossBoundarySummary,
    warnings: moduleDataBus.warnings,
    evidence: moduleDataBus.evidence,
    boundaries: moduleDataBus.boundaries,
  },
  tools,
};

console.log(JSON.stringify(report, null, 2));
