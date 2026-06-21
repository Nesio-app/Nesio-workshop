import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const args = new Set(process.argv.slice(2));

function runModuleRegistryReport() {
  const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
  });
  return JSON.parse(output);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildLaunchReadinessSummary(report) {
  const launchSurface = report.launchSurface?.summary || {};
  const launchSku = report.launchSku || {};
  const inventory = report.inventoryFirstLaunch?.summary || {};
  const webSurface = report.webSurfaceContract || {};
  const summary = report.summary || {};
  const modules = Array.isArray(report.launchSku?.modules) ? report.launchSku.modules : [];

  const launchableModules = modules
    .filter((entry) => entry.launchStatus === 'launchable')
    .map((entry) => entry.moduleId);
  const excludedModules = modules
    .filter((entry) => entry.excludedFromLaunch)
    .map((entry) => entry.moduleId);
  const ceoGatedModules = modules
    .filter((entry) => entry.needsCeoGate && entry.launchStatus !== 'launchable')
    .map((entry) => entry.moduleId);
  const launchableModulesWithDeferredApproval = modules
    .filter((entry) => entry.needsCeoGate && entry.launchStatus === 'launchable')
    .map((entry) => entry.moduleId);

  const releaseBlockers = [];
  if (summary.launchSkuAppStoreReady !== true) {
    releaseBlockers.push('launchSkuAppStoreReady=false');
  }
  if (launchSku.launchSkuAppStoreReady !== true) {
    releaseBlockers.push('launch SKU remains candidate, not App Store ready');
  }
  if (summary.launchSurfaceAppStoreReady !== true) {
    releaseBlockers.push('launchSurfaceAppStoreReady=false');
  }
  if (summary.cloudSyncEnabled !== false) {
    releaseBlockers.push('cloudSyncEnabled must remain false for PWA self-use launch');
  }
  if (summary.entitlementBehaviorEnabled !== false || summary.entitlementStoreKitEnabled !== false) {
    releaseBlockers.push('entitlement behavior / StoreKit must remain disabled');
  }

  return {
    version: 'launch-readiness-summary-v0',
    generatedFrom: 'report-module-registry.mjs',
    status: releaseBlockers.length ? 'candidate_not_release_ready' : 'ready_for_release_review',
    firstLaunchPromise: launchSurface.firstLaunchPromise || launchSku.label || 'Shell + Inventory / purchase-memory + Todo',
    appStoreReady: false,
    testFlightReady: false,
    ordinaryUserPublicModules: unique(launchSurface.publicVisibleModuleIds || []),
    launchableModules,
    excludedFromLaunchModules: excludedModules,
    ceoGatedModules,
    launchableModulesWithDeferredApproval,
    sandboxTesterModules: unique(launchSurface.testerVisibleSandboxModuleIds || []),
    inventoryLocalFlow: {
      demoItemCount: summary.inventoryFirstLaunchDemoItemCount ?? inventory.demoItemCount ?? null,
      readsRealData: summary.inventoryFirstLaunchReadsRealData,
      writesRealData: summary.inventoryFirstLaunchWritesRealData,
      cloudSyncEnabled: summary.inventoryFirstLaunchCloudSyncEnabled,
      externalAuthEnabled: summary.inventoryFirstLaunchExternalAuthEnabled,
      paymentIntegrationEnabled: summary.inventoryFirstLaunchPaymentIntegrationEnabled,
    },
    webSurface: {
      mobileWebSupported: summary.mobileWebSupported ?? webSurface.mobileWebSupported,
      pwaSupported: summary.pwaSupported ?? webSurface.pwaSupported,
      desktopPreviewOnly: summary.desktopPreviewOnly ?? webSurface.desktopPreviewOnly,
      desktopDashboardEnabled: summary.desktopDashboardEnabled ?? webSurface.desktopDashboardEnabled,
    },
    gates: {
      approvalGateOverridesPaywallGate: launchSurface.approvalGateOverridesPaywallGate === true,
      realPurchaseEnabled: launchSurface.realPurchaseEnabled === true,
      storeKitEnabled: launchSurface.storeKitEnabled === true || summary.entitlementStoreKitEnabled === true,
      appStoreSubmissionEnabled: launchSku.boundaries?.appStoreSubmissionEnabled === true,
      externalAuthEnabled: launchSku.boundaries?.externalAuthEnabled === true,
      cloudSyncEnabled: launchSku.boundaries?.cloudSyncEnabled === true,
    },
    warningCounts: {
      dataAggregationReviewWarningCount: summary.dataAggregationReviewWarningCount,
      dataAggregationRuntimeBlockerCount: summary.dataAggregationRuntimeBlockerCount,
      launchSkuWarningCount: summary.launchSkuWarningCount,
      launchSurfaceWarningCount: summary.launchSurfaceWarningCount ?? 0,
      toolManifestWarningCount: summary.toolManifestWarningCount,
      webSurfaceWarningCount: summary.webSurfaceWarningCount,
    },
    requiredQaCommands: [
      'npm run report:launch-readiness',
      'npm run test:qa:static',
      'npm run test:e2e',
      'npm run lint',
      'npx tsc --noEmit --incremental false',
    ],
    releaseBlockers: unique(releaseBlockers),
    nextOwner: 'Ming',
    needsCeoGateForRelease: true,
    ceoGateTriggers: [
      'TestFlight submission',
      'App Store submission',
      'real cloud sync',
      'real StoreKit/payment',
      'external authorization',
      'AI runtime',
      'health/finance/psychology public claims',
    ],
  };
}

function renderMarkdown(summary) {
  return [
    '# Baohe Launch Readiness Summary v0',
    '',
    `Status: ${summary.status}`,
    `First launch promise: ${summary.firstLaunchPromise}`,
    `App Store ready: ${summary.appStoreReady}`,
    `TestFlight ready: ${summary.testFlightReady}`,
    '',
    '## Public Surface',
    '',
    `Ordinary user public modules: ${summary.ordinaryUserPublicModules.join(', ') || 'none'}`,
    `Launchable modules: ${summary.launchableModules.join(', ') || 'none'}`,
    `Excluded from launch: ${summary.excludedFromLaunchModules.join(', ') || 'none'}`,
    `CEO-gated modules: ${summary.ceoGatedModules.join(', ') || 'none'}`,
    `Launchable modules with deferred approval-sensitive actions: ${summary.launchableModulesWithDeferredApproval.join(', ') || 'none'}`,
    `Tester sandbox modules: ${summary.sandboxTesterModules.join(', ') || 'none'}`,
    '',
    '## Inventory Local Flow',
    '',
    `Reads real data: ${summary.inventoryLocalFlow.readsRealData}`,
    `Writes real data: ${summary.inventoryLocalFlow.writesRealData}`,
    `Cloud sync enabled: ${summary.inventoryLocalFlow.cloudSyncEnabled}`,
    `External auth enabled: ${summary.inventoryLocalFlow.externalAuthEnabled}`,
    `Payment integration enabled: ${summary.inventoryLocalFlow.paymentIntegrationEnabled}`,
    '',
    '## Web Surface',
    '',
    `Mobile web supported: ${summary.webSurface.mobileWebSupported}`,
    `PWA supported: ${summary.webSurface.pwaSupported}`,
    `Desktop preview only: ${summary.webSurface.desktopPreviewOnly}`,
    `Desktop dashboard enabled: ${summary.webSurface.desktopDashboardEnabled}`,
    '',
    '## Required QA Commands',
    '',
    ...summary.requiredQaCommands.map((command) => `- \`${command}\``),
    '',
    '## Release Blockers',
    '',
    ...(summary.releaseBlockers.length
      ? summary.releaseBlockers.map((blocker) => `- ${blocker}`)
      : ['- none']),
    '',
    '## CEO Gate Triggers',
    '',
    ...summary.ceoGateTriggers.map((trigger) => `- ${trigger}`),
    '',
  ].join('\n');
}

const report = runModuleRegistryReport();
const summary = buildLaunchReadinessSummary(report);

if (args.has('--markdown')) {
  console.log(renderMarkdown(summary));
} else {
  console.log(JSON.stringify(summary, null, 2));
}

export {
  buildLaunchReadinessSummary,
  renderMarkdown,
};
