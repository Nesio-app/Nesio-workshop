import { spawnSync } from 'node:child_process';

const EXPECTED_STRATEGIES = new Set([
  'embedded_static',
  'external_webview_gated',
  'native_bridge_deferred',
  'not_ready',
]);

const HARD_GATE_CATEGORIES = new Set([
  'real_data_read',
  'real_data_write',
  'real_data_migration',
  'external_authorization',
  'notification_send',
  'purchase_payment',
  'p0_p1_privacy_trust_risk',
  'production_deploy',
]);

function fail(message, detail) {
  const payload = detail === undefined ? '' : `: ${JSON.stringify(detail)}`;
  console.error(`[mobile-app-integration precheck] ERROR: ${message}${payload}`);
  process.exitCode = 1;
}

function runReport() {
  const result = spawnSync('node', ['scripts/report-module-registry.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    fail('report generation failed', {
      status: result.status,
      stderr: result.stderr?.trim(),
    });
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail('report output is not valid JSON', {
      error: error instanceof Error ? error.message : 'unknown parse error',
    });
    return null;
  }
}

function validateBoundaries(contract) {
  const boundaries = contract?.boundaries;
  if (!boundaries || typeof boundaries !== 'object') {
    fail('contract boundaries missing');
    return false;
  }

  const expected = {
    staticRegistryOnly: true,
    changesNativeProject: false,
    runsCapacitorSync: false,
    opensXcode: false,
    appStoreSubmission: false,
    runtimeNativeBridge: false,
    readsRealData: false,
    writesRealData: false,
    writesNotion: false,
    sendsNotifications: false,
    authorizesExternalServices: false,
    executesActions: false,
    productionDeploy: false,
  };

  for (const [key, value] of Object.entries(expected)) {
    if (boundaries[key] !== value) {
      fail('boundary flag mismatch', { key, expected: value, actual: boundaries[key] });
      return false;
    }
  }

  return true;
}

function validateModuleEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.moduleId !== 'string' || entry.moduleId.length === 0) return false;
  if (!EXPECTED_STRATEGIES.has(entry.mobileStrategy)) return false;
  if (typeof entry.appSurface !== 'string' || entry.appSurface.length === 0) return false;
  if (!Array.isArray(entry.gateCategories)) return false;
  if (typeof entry.needsCeoGate !== 'boolean') return false;
  if (entry.readsRealData !== false || entry.writesRealData !== false) return false;
  if (entry.nativeBridgeRequired === true && entry.mobileStrategy !== 'native_bridge_deferred') return false;
  if (entry.mobileStrategy === 'embedded_static') {
    if (typeof entry.publicIndexPath !== 'string' || entry.publicIndexPath.length === 0) return false;
    if (entry.publicIndex !== true) return false;
  }
  return true;
}

function validateMobileIntegration(report) {
  const mobile = report?.mobileAppIntegration;
  if (!mobile || typeof mobile !== 'object') {
    fail('mobileAppIntegration section missing');
    return null;
  }

  if (!validateBoundaries(mobile.contract)) return null;

  const modules = Array.isArray(mobile.modules) ? mobile.modules : [];
  const summary = mobile.summary || {};
  if (modules.length !== report.summary?.moduleCount) {
    fail('mobile module count mismatch', {
      expected: report.summary?.moduleCount,
      actual: modules.length,
    });
    return null;
  }

  for (const entry of modules) {
    if (!validateModuleEntry(entry)) {
      fail('mobile module entry invalid', entry);
      return null;
    }
  }

  const byId = new Map(modules.map((entry) => [entry.moduleId, entry]));
  const finance = byId.get('finance');
  if (!finance || finance.mobileStrategy !== 'native_bridge_deferred' || finance.needsCeoGate !== true) {
    fail('finance must stay native_bridge_deferred and CEO-gated in static mobile slice', finance);
    return null;
  }

  const expectedCeoGateCount = modules.filter((entry) => (
    entry.gateCategories.some((category) => HARD_GATE_CATEGORIES.has(category))
  )).length;
  if (summary.ceoGateModuleCount !== expectedCeoGateCount) {
    fail('ceo gate module count mismatch', {
      expected: expectedCeoGateCount,
      actual: summary.ceoGateModuleCount,
    });
    return null;
  }

  if (summary.warningCount !== 0 || (mobile.warnings || []).length !== 0) {
    fail('mobile integration warnings present', {
      summaryWarningCount: summary.warningCount,
      warningCount: (mobile.warnings || []).length,
    });
    return null;
  }

  return { mobile, modules, summary };
}

function main() {
  const report = runReport();
  if (!report) return;

  const result = validateMobileIntegration(report);
  if (!result || process.exitCode === 1) return;

  const { modules, summary } = result;
  console.log('mobile-app-integration precheck passed');
  console.log(JSON.stringify({
    ok: true,
    moduleCount: summary.moduleCount,
    embeddedStaticCount: summary.embeddedStaticCount,
    externalWebviewGatedCount: summary.externalWebviewGatedCount,
    nativeBridgeDeferredCount: summary.nativeBridgeDeferredCount,
    ceoGateModuleCount: summary.ceoGateModuleCount,
    warningCount: summary.warningCount,
    strategies: Object.fromEntries([...EXPECTED_STRATEGIES].map((strategy) => [
      strategy,
      modules.filter((entry) => entry.mobileStrategy === strategy).map((entry) => entry.moduleId),
    ])),
  }, null, 2));
}

main();
