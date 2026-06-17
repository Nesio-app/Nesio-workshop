export const WEB_SURFACE_CONTRACT_VERSION_V0 = 'web-surface-contract-v0';

const PUBLIC_LAUNCH_MODULE_IDS = Object.freeze(['shell', 'inventory']);
const HIGH_TRUST_MODULE_IDS = Object.freeze(['finance', 'health', 'psychoanalysis', 'secretary', 'lifesim']);

function moduleId(tool) {
  return tool.moduleId || tool.id;
}

function moduleProductById(moduleProductContract) {
  return new Map((moduleProductContract?.modules || []).map((entry) => [entry.moduleId, entry]));
}

function webSurfaceModuleEntry(tool, productById) {
  const id = moduleId(tool);
  const product = productById.get(id);
  const firstLaunch = product?.launchCohort === 'first_launch';
  const highTrust = product?.trustBoundary?.requiresCEOApproval === true || HIGH_TRUST_MODULE_IDS.includes(id);

  return {
    moduleId: id,
    label: tool.name || product?.label || id,
    launchCohort: product?.launchCohort || 'sandbox',
    mobileWebEntry: firstLaunch ? 'supported' : 'gated_or_hidden',
    desktopWebEntry: firstLaunch ? 'preview_frame' : 'not_promised',
    desktopProductPromise: false,
    publicLaunchModule: firstLaunch,
    sandboxOrGated: !firstLaunch,
    highTrust,
    appStoreMentionAllowed: product?.appStore?.appStoreMentionAllowed === true,
    shellStateLabel: product?.shellDisplay?.stateLabel || '建设中',
  };
}

function buildWarnings(contract) {
  const warnings = [];
  if (contract.desktopWeb.desktopSaasDashboardEnabled) {
    warnings.push({
      warningKind: 'desktop_dashboard_enabled',
      issue: 'Desktop Web must remain preview-only for v0.1.',
      reason: 'The current launch scope is mobile-first, not a desktop SaaS/dashboard.',
      owner: 'Qiao',
      evidenceFields: ['webSurfaceContract.desktopWeb.desktopSaasDashboardEnabled'],
    });
  }
  if (!contract.mobileWeb.mobileFirst || contract.mobileWeb.supportLevel !== 'official') {
    warnings.push({
      warningKind: 'mobile_web_not_official',
      issue: 'Mobile Web / PWA must be the official web surface.',
      reason: 'Baohe v0.1 launch scope is mobile-first personal toolbox.',
      owner: 'Qiao',
      evidenceFields: ['webSurfaceContract.mobileWeb'],
    });
  }
  const desktopPromised = contract.modules.filter((entry) => entry.desktopProductPromise);
  for (const entry of desktopPromised) {
    warnings.push({
      moduleId: entry.moduleId,
      warningKind: 'desktop_product_promise_enabled',
      issue: 'Desktop Web must not promise a full desktop productivity app in v0.1.',
      reason: 'Desktop is compatibility/preview only.',
      owner: 'Qiao',
      evidenceFields: ['webSurfaceContract.modules.desktopProductPromise'],
    });
  }
  return warnings;
}

export function buildWebSurfaceContractV0({
  modules = [],
  moduleProductContract = null,
  mobileAppIntegration = null,
} = {}) {
  const productById = moduleProductById(moduleProductContract);
  const moduleEntries = modules.map((tool) => webSurfaceModuleEntry(tool, productById));

  const contract = {
    version: WEB_SURFACE_CONTRACT_VERSION_V0,
    implementation: 'static-surface-contract-only',
    primaryExperience: 'mobile_web_pwa',
    boundaries: {
      changesUI: false,
      desktopDashboardEnabled: false,
      productionDeployEnabled: false,
      appStoreSubmissionEnabled: false,
      readsRealData: false,
      writesRealData: false,
      connectsExternalServices: false,
      enablesStoreKit: false,
      enablesCloudSync: false,
    },
    mobileWeb: {
      supportLevel: 'official',
      mobileFirst: true,
      supportedBrowsers: ['iOS Safari', 'Android Chrome'],
      supportedViewport: {
        minWidthPx: 320,
        targetMaxWidthPx: 480,
      },
      pwa: {
        addToHomeScreenSupported: true,
        installPromptPromised: false,
        offlineModePromised: false,
      },
      launchScope: {
        productPositioning: 'Baohe v0.1 is a mobile-first personal toolbox.',
        publicModuleIds: [...PUBLIC_LAUNCH_MODULE_IDS],
        shellRequired: true,
        inventoryPurchaseMemoryRequired: true,
        otherModulesSandboxOrGated: true,
      },
      qaChecklist: [
        'iPhone Safari small viewport',
        'Android Chrome small viewport',
        'Add to Home Screen smoke',
        'Shell + Inventory / purchase-memory path',
        'No horizontal overflow at 320/375/390px',
      ],
    },
    desktopWeb: {
      supportLevel: 'preview_compatibility',
      desktopSaasDashboardEnabled: false,
      mobileAppFrame: {
        centered: true,
        minWidthPx: 320,
        maxWidthPx: 480,
      },
      userNotice: '当前体验为移动端优先；桌面端仅用于预览和支持访问。',
      productPromise: 'Preview and support access only; not a desktop productivity app.',
      layoutPolicy: {
        noMultiColumnDashboard: true,
        noDesktopProductivityPromise: true,
        avoidHorizontalOverflow: true,
      },
    },
    appPositioning: {
      launchLine: 'Baohe v0.1 is a mobile-first personal toolbox.',
      supportedNow: ['Mobile Web / PWA', 'iOS Web', 'Android mobile browser'],
      previewOnly: ['Desktop Web'],
      futurePath: ['iOS wrapper'],
      notPromised: ['Desktop SaaS dashboard', 'Desktop productivity app', 'All 11 tools publicly available'],
    },
    evidence: {
      mobileAppIntegrationVersion: mobileAppIntegration?.version || null,
      moduleProductContractVersion: moduleProductContract?.version || null,
      source: 'static-report-contract',
    },
    modules: moduleEntries,
  };

  const warnings = buildWarnings(contract);
  return {
    ...contract,
    summary: {
      mobileWebSupported: true,
      pwaSupported: true,
      desktopPreviewOnly: true,
      desktopDashboardEnabled: false,
      publicLaunchModuleCount: moduleEntries.filter((entry) => entry.publicLaunchModule).length,
      desktopPromisedModuleCount: moduleEntries.filter((entry) => entry.desktopProductPromise).length,
      highTrustGatedModuleCount: moduleEntries.filter((entry) => entry.highTrust).length,
      warningCount: warnings.length,
    },
    warnings,
  };
}
