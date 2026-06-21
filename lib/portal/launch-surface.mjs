export const LAUNCH_SURFACE_VERSION_V0 = 'launch-surface-v0';

const LAUNCHABLE_MODULE_IDS = Object.freeze(['inventory', 'plan']);
const FUTURE_PAID_MODULE_IDS = Object.freeze(['sanctuary', 'reading', 'fitness', 'quiz', 'lifesim']);
const GATED_MODULE_IDS = Object.freeze(['secretary', 'psychoanalysis', 'health']);
const HIDDEN_MODULE_IDS = Object.freeze(['finance']);
const HIGH_RISK_MODULE_IDS = Object.freeze(['finance', 'health', 'psychoanalysis', 'secretary']);
const TESTER_COHORTS = Object.freeze({
  'reading-lab': Object.freeze(['reading', 'plan', 'inventory']),
  'fitness-lab': Object.freeze(['fitness', 'inventory']),
  'trust-lab': Object.freeze(['secretary', 'psychoanalysis', 'health', 'sanctuary', 'inventory']),
  'all-sandbox': Object.freeze(['plan', 'reading', 'sanctuary', 'fitness', 'quiz', 'lifesim', 'inventory']),
});

function inferLaunchStatus(tool) {
  if (tool.launchStatus) return tool.launchStatus;
  if (LAUNCHABLE_MODULE_IDS.includes(tool.id)) return 'launchable';
  if (HIDDEN_MODULE_IDS.includes(tool.id)) return 'hidden';
  if (GATED_MODULE_IDS.includes(tool.id)) return 'gated';
  if (FUTURE_PAID_MODULE_IDS.includes(tool.id)) return 'future_paid';
  return 'internal_registry_only';
}

function inferLifecycle(tool, launchStatus) {
  if (tool.toolLifecycle) return tool.toolLifecycle;
  return launchStatus === 'launchable' ? 'launchable' : 'sandbox';
}

function inferProdExposure(tool, launchStatus, lifecycle) {
  if (tool.prodExposure) return tool.prodExposure;
  if (launchStatus === 'launchable' && LAUNCHABLE_MODULE_IDS.includes(tool.id)) return 'public';
  if (launchStatus === 'hidden' || launchStatus === 'gated') return 'hidden';
  if (lifecycle === 'sandbox' || lifecycle === 'candidate') return 'tester_only';
  return 'hidden';
}

function paywallStateForTool(tool, launchStatus, prodExposure) {
  if (launchStatus === 'launchable' && prodExposure === 'public') return 'free';
  return tool.paywallState || tool.entitlementPolicy?.paywallState || tool.commercial?.defaultPaywallState || 'locked';
}

function approvalRequiredForTool(tool, launchStatus) {
  const actions = tool.approvalRequiredActions || tool.capabilities?.approvalRequiredActions || [];
  const highRiskAction = actions.some((action) => [
    'payment-or-billing',
    'external-financial-service',
    'financial-data-read',
    'financial-data-write',
    'pii-storage',
    'open_sensitive_health_context',
    'start_sensitive_session',
    'send_external_request',
  ].includes(action));
  return highRiskAction || launchStatus === 'gated' || HIDDEN_MODULE_IDS.includes(tool.id);
}

export function resolveTesterCohort(cohortCode) {
  const normalized = typeof cohortCode === 'string' ? cohortCode.trim() : '';
  const moduleIds = TESTER_COHORTS[normalized] || [];
  return {
    code: normalized || null,
    source: moduleIds.length ? 'local_cohort_code' : 'none',
    moduleIds: [...moduleIds],
  };
}

function normalizeContext(context = {}) {
  const cohort = resolveTesterCohort(context.testerCohort || context.testerCode || null);
  const allowlist = new Set([
    ...(context.testerAllowlist || []),
    ...cohort.moduleIds,
  ]);
  const viewerRole = context.viewerRole === 'personal_lab'
    ? 'personal_lab'
    : context.viewerRole === 'tester' || cohort.moduleIds.length > 0 ? 'tester' : 'public';
  return {
    viewerRole,
    testerAllowlist: allowlist,
    testerCohort: cohort.code,
    testerCohortSource: cohort.source,
  };
}

export function resolveLaunchSurfaceState(tool, context = {}) {
  const ctx = normalizeContext(context);
  const launchStatus = inferLaunchStatus(tool);
  const toolLifecycle = inferLifecycle(tool, launchStatus);
  const prodExposure = inferProdExposure(tool, launchStatus, toolLifecycle);
  const paywallState = paywallStateForTool(tool, launchStatus, prodExposure);
  const approvalRequired = approvalRequiredForTool(tool, launchStatus);
  const approvalGateState = approvalRequired ? 'required' : 'none';
  const blockedByApprovalGate = approvalGateState !== 'none';
  const blockedByPaywallGate = ['locked', 'expired', 'restore_required'].includes(paywallState);
  const testerAllowed = ctx.viewerRole === 'tester' &&
    (ctx.testerAllowlist.has(tool.id) || prodExposure === 'beta_opt_in');

  let visible = false;
  let reason = 'not_public';

  if (ctx.viewerRole === 'personal_lab') {
    visible = true;
    reason = 'personal_lab';
  } else if (launchStatus === 'launchable' && prodExposure === 'public') {
    visible = true;
    reason = 'public_launch';
  } else if (prodExposure === 'tester_only') {
    visible = testerAllowed;
    reason = testerAllowed ? 'tester_allowlist' : 'tester_only';
  } else if (prodExposure === 'beta_opt_in') {
    visible = testerAllowed;
    reason = testerAllowed ? 'beta_opt_in' : 'beta_not_enabled';
  } else if (launchStatus === 'gated' || launchStatus === 'hidden') {
    visible = false;
    reason = launchStatus;
  }

  const shellAction = ctx.viewerRole === 'personal_lab' && visible
    ? 'open_lab_preview'
    : !visible
    ? 'hide_for_public'
    : (blockedByApprovalGate
      ? 'show_approval_gate'
      : (blockedByPaywallGate ? 'show_static_locked_preview' : 'open'));

  return {
    moduleId: tool.id,
    launchStatus,
    toolLifecycle,
    prodExposure,
    visible,
    visibleForPublic: visible && ctx.viewerRole === 'public',
    visibleForTester: visible && ctx.viewerRole === 'tester',
    visibleForPersonalLab: visible && ctx.viewerRole === 'personal_lab',
    reason,
    shellAction,
    approvalGateState,
    paywallState,
    blockedByApprovalGate,
    blockedByPaywallGate,
    approvalGateOverridesPaywallGate: true,
    paywallBehavior: blockedByPaywallGate ? 'static_locked_free_preview' : 'free_preview_or_open',
    realPurchaseEnabled: false,
    storeKitEnabled: false,
    realRuntimeEnabled: false,
    personalLabMode: ctx.viewerRole === 'personal_lab',
    betaBadgeRequired: visible && prodExposure !== 'public',
    appStoreMentionAllowed: launchStatus === 'launchable' && prodExposure === 'public',
    screenshotSafe: launchStatus === 'launchable' && prodExposure === 'public',
  };
}

export function filterToolsForLaunchSurface(tools, context = {}) {
  return tools.filter((tool) => resolveLaunchSurfaceState(tool, context).visible);
}

export function buildLaunchReadinessSummary(tools, context = {}) {
  const publicEntries = tools.map((tool) => resolveLaunchSurfaceState(tool, { viewerRole: 'public' }));
  const testerEntries = tools.map((tool) => resolveLaunchSurfaceState(tool, {
    viewerRole: 'tester',
    testerAllowlist: context.testerAllowlist || [],
    testerCohort: context.testerCohort || null,
  }));
  const personalLabEntries = tools.map((tool) => resolveLaunchSurfaceState(tool, { viewerRole: 'personal_lab' }));
  const publicVisibleModuleIds = publicEntries.filter((entry) => entry.visible).map((entry) => entry.moduleId);
  const testerVisibleSandboxModuleIds = testerEntries
    .filter((entry) => entry.visible && entry.prodExposure !== 'public')
    .map((entry) => entry.moduleId);
  const personalLabVisibleModuleIds = personalLabEntries
    .filter((entry) => entry.visible)
    .map((entry) => entry.moduleId);
  const publicHiddenHighRiskModuleIds = publicEntries
    .filter((entry) => HIGH_RISK_MODULE_IDS.includes(entry.moduleId) && !entry.visible)
    .map((entry) => entry.moduleId);

  return {
    version: LAUNCH_SURFACE_VERSION_V0,
    firstLaunchPromise: 'Shell + Inventory / purchase-memory + Todo',
    publicVisibleModuleIds,
    publicVisibleModuleCount: publicVisibleModuleIds.length,
    testerVisibleSandboxModuleIds,
    testerVisibleSandboxModuleCount: testerVisibleSandboxModuleIds.length,
    personalLabVisibleModuleIds,
    personalLabVisibleModuleCount: personalLabVisibleModuleIds.length,
    personalLabRealRuntimeEnabled: false,
    publicHiddenHighRiskModuleIds,
    publicHiddenHighRiskModuleCount: publicHiddenHighRiskModuleIds.length,
    approvalGateOverridesPaywallGate: true,
    paywallMode: 'static_locked_free_preview_only',
    realPurchaseEnabled: false,
    storeKitEnabled: false,
    launchSurfaceAppStoreReady: false,
    launchReadinessStatus: 'candidate_not_release_ready',
    needsCeoGateForSigning: true,
    needsCeoGateForTestFlight: true,
    needsCeoGateForAppStoreSubmission: true,
  };
}

export function readLaunchSurfaceContextFromBrowser() {
  if (typeof window === 'undefined') return { viewerRole: 'public', testerAllowlist: [] };

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('baohePublic') === '1' || params.get('baohe_public') === '1') {
      window.localStorage.removeItem('baohe_personal_lab');
      window.localStorage.removeItem('baohe_lab_mode');
      window.sessionStorage.removeItem('baohe_personal_lab');
      window.sessionStorage.removeItem('baohe_lab_mode');
    }

    const isPersonalLab = params.get('baohePersonal') === '1' ||
      params.get('baohePersonalLab') === '1' ||
      params.get('baohe_personal_lab') === '1' ||
      params.get('baoheLab') === '1' ||
      params.get('baohe_lab') === '1' ||
      window.localStorage.getItem('baohe_personal_lab') === '1' ||
      window.localStorage.getItem('baohe_lab_mode') === '1' ||
      window.sessionStorage.getItem('baohe_personal_lab') === '1' ||
      window.sessionStorage.getItem('baohe_lab_mode') === '1';
    if (isPersonalLab) {
      window.localStorage.setItem('baohe_personal_lab', '1');
      return {
        viewerRole: 'personal_lab',
        testerAllowlist: [],
        testerCohort: null,
      };
    }

    const testerCohort = params.get('baoheTesterCode') ||
      params.get('baohe_tester_code') ||
      window.localStorage.getItem('baohe_tester_code') ||
      window.sessionStorage.getItem('baohe_tester_code') ||
      null;
    const cohort = resolveTesterCohort(testerCohort);
    const isTester = params.get('baoheTester') === '1' ||
      window.localStorage.getItem('baohe_tester') === '1' ||
      window.sessionStorage.getItem('baohe_tester') === '1' ||
      cohort.moduleIds.length > 0;
    const allowlistRaw = params.get('baoheTesterModules') ||
      window.localStorage.getItem('baohe_tester_allowlist') ||
      window.sessionStorage.getItem('baohe_tester_allowlist') ||
      '';
    const testerAllowlist = allowlistRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      viewerRole: isTester ? 'tester' : 'public',
      testerAllowlist: [...new Set([...testerAllowlist, ...cohort.moduleIds])],
      testerCohort: cohort.code,
    };
  } catch (_) {
    return { viewerRole: 'public', testerAllowlist: [] };
  }
}
