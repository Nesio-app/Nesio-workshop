import { spawnSync } from 'node:child_process';

const DATA_CATALOG_SUMMARY_FIELDS = [
  'dataKey',
  'scope',
  'producers',
  'consumers',
  'producerCount',
  'consumerCount',
  'edgeCount',
  'health',
  'reserved',
];

const EDGE_SUMMARY_FIELDS = ['fromModuleId', 'toModuleId', 'dataKey', 'relation', 'risk'];
const SHELL_ROUTE_FIELDS = ['routeKey', 'moduleId', 'label', 'modeAvailability', 'entryStatus', 'emptyStateKey', 'requiredCapabilities', 'approvalGateKeys', 'evidenceLinks'];
const SHELL_ROUTE_WARNING_FIELDS = ['warningKind', 'routeKey', 'moduleId', 'issue'];
const DATA_WARNING_FIELDS = ['warningKind', 'dataKey', 'moduleId', 'issue', 'reason', 'owner', 'evidenceFields'];
const CONVERGENCE_MATRIX_SUMMARY_FIELDS = Object.freeze([
  'moduleId',
  'entryStatus',
  'gateStatus',
  'riskDebtKind',
  'redLineCategories',
  'approvalActions',
]);
const SHELL_ROUTE_SUMMARY_FIELDS = new Set([
  'routeCount',
  'routeKeyCount',
  'readyRouteCount',
  'externalRouteCount',
  'unconnectedRouteCount',
  'gatedRouteCount',
  'missingEvidenceRouteCount',
  'modeAvailabilitySummary',
  'entryStatusSummary',
  'warningCount',
  'warnings',
]);
const CONTRACT_SUMMARY_KEYS = new Set([
  'ok',
  'source',
  'generatedAt',
  'boundaries',
  'modules',
  'sharedDataCatalog',
  'sharedEdges',
  'sharedEdgeCount',
  'interconnectPlan',
  'crossBoundarySummary',
  'warningCount',
  'warnings',
  'shellRoutes',
  'externalConnectionSummary',
  'approvalRequestMatrixCount',
  'approvalNeedsDecisionCount',
  'convergenceMatrixCount',
  'dataAggregationReviewWarningCount',
  'dataAggregationRuntimeBlockerCount',
  'approvalRequestMatrixSummary',
  'convergenceMatrix',
]);
const INTERCONNECT_SUMMARY_KEYS = new Set([
  'version',
  'criticalGapCount',
  'connectionReadyKeyCount',
  'missingLocalProducerCount',
  'orphanedProducerCount',
  'priority',
]);
const CROSS_BOUNDARY_SUMMARY_KEYS = new Set([
  'externalToLocalEdgeCount',
  'localToExternalEdgeCount',
  'externalToLocalEdges',
  'localToExternalEdges',
]);
const EXTERNAL_CONNECTION_SUMMARY_KEYS = new Set([
  'ok',
  'reason',
  'providerCount',
  'enabledCount',
  'providerStates',
]);
const EXTERNAL_PROVIDER_KEYS = new Set([
  'provider',
  'connectionType',
  'status',
  'environment',
  'isEnabled',
]);
const BOUNDARY_KEYS = new Set([
  'implementation',
  'readsRegistryMetadataOnly',
  'readsArtifactFilesOnly',
  'writesRealData',
  'writesNotion',
  'sendsNotifications',
  'authorizesExternalServices',
  'executesActions',
  'productionDeploy',
]);

function hasOnlyWhitelistedKeys(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateSummaryCatalogItem(item) {
  return DATA_CATALOG_SUMMARY_FIELDS.every((field) => item && typeof item === 'object' && field in item);
}

function validateSummaryEdgeItem(item) {
  return EDGE_SUMMARY_FIELDS.every((field) => item && typeof item === 'object' && field in item);
}

function validateBoundary(boundary) {
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) {
    fail('contract boundaries missing');
    return false;
  }
  if (!hasOnlyWhitelistedKeys(boundary, BOUNDARY_KEYS)) {
    fail('contract boundaries include unexpected fields');
    return false;
  }
  return true;
}

function validateShellRouteSummary(summary) {
  if (!summary || typeof summary !== 'object') return false;
  for (const key of SHELL_ROUTE_SUMMARY_FIELDS) {
    if (key === 'warnings') continue;
    if (!(key in summary)) return false;
  }
  if (!Number.isInteger(summary.routeCount) || !Number.isInteger(summary.routeKeyCount)) return false;
  if (!Array.isArray(summary.warnings)) return false;
  return true;
}

function validateDataWarning(item) {
  return DATA_WARNING_FIELDS.every((field) => item && typeof item === 'object' && field in item);
}

function normalizeOwner(fields) {
  return [
    fields?.owner,
    fields?.responsibleAgent,
    fields?.maintainer,
    fields?.evidenceOwner,
    fields?.gateOwner,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0) || null;
}

function normalizeEvidenceFields(warning) {
  const fields = new Set(['warningKind', 'issue']);
  if (warning.warningKind) fields.add('warningKind');
  if (warning.dataKey) fields.add('dataKey');
  if (warning.moduleId) fields.add('moduleId');
  if (Array.isArray(warning.producers)) fields.add('producers');
  if (Array.isArray(warning.consumers)) fields.add('consumers');
  if (Array.isArray(warning.dataKeys)) fields.add('dataKeys');
  return Array.from(fields);
}

function pickWarningOwner(warning, ownershipMap) {
  const candidates = []
    .concat(
      warning.moduleId ? [warning.moduleId] : [],
      Array.isArray(warning.producers) ? warning.producers : [],
      Array.isArray(warning.consumers) ? warning.consumers : [],
      Array.isArray(warning.dataKeys) ? warning.dataKeys : [],
    )
    .filter(Boolean);

  const seen = new Set();
  for (const moduleId of candidates) {
    if (seen.has(moduleId)) continue;
    seen.add(moduleId);
    if (ownershipMap.has(moduleId)) return ownershipMap.get(moduleId);
  }
  return 'unassigned';
}

function validateShellRouteSummaryWarning(item) {
  return SHELL_ROUTE_WARNING_FIELDS.every((field) => item && typeof item === 'object' && field in item);
}

function validateShellRouteItem(item) {
  return SHELL_ROUTE_FIELDS.every((field) => item && typeof item === 'object' && field in item);
}

function fail(message, detail) {
  const payload = detail === undefined ? '' : `: ${JSON.stringify(detail)}`;
  console.error(`[module-data-network precheck] ERROR: ${message}${payload}`);
  process.exitCode = 1;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    offline: args.includes('--offline'),
    includeExternal: args.includes('--include-external'),
    format: args.includes('--full') ? 'full' : 'summary',
    baseUrl: process.env.MODULE_DATA_NETWORK_BASE_URL || 'http://localhost:3000',
  };
}

function pickFields(item, fields) {
  return fields.reduce((acc, field) => {
    acc[field] = item[field];
    return acc;
  }, {});
}

function buildSharedSummaryFromReport(report) {
  const moduleDataBus = report.moduleDataBus || {};
  const ownershipItems = Array.isArray(report.moduleOwnershipStatusRegistry?.modules)
    ? report.moduleOwnershipStatusRegistry.modules
    : [];
  const ownershipMap = new Map(
    ownershipItems.map((item) => [item?.moduleId, normalizeOwner(item)]).filter(([moduleId, owner]) => moduleId && owner),
  );
  const dataCatalog = Array.isArray(moduleDataBus.dataCatalog) ? moduleDataBus.dataCatalog : [];
  const edges = Array.isArray(moduleDataBus.edges) ? moduleDataBus.edges : [];
  const interconnectPlan = moduleDataBus.interconnectPlan || {};
  const crossBoundarySummary = moduleDataBus.crossBoundarySummary || {};
  const warnings = Array.isArray(moduleDataBus.warnings) ? moduleDataBus.warnings : [];
  const approvalGate = report?.approvalGate || {};
  const approvalRequestMatrix = Array.isArray(approvalGate.requestMatrix) ? approvalGate.requestMatrix : [];
  const approvalRequestMatrixSummary = approvalGate.requestMatrixSummary || {
    totalRequestCount: approvalRequestMatrix.length,
    runtimeReviewOnlyCount: 0,
    runtimeBlockerCount: 0,
    statusSummary: {},
  };
  const convergenceMatrix = Array.isArray(report?.convergenceMatrix) ? report.convergenceMatrix : [];
  const dataAggregation = report?.dataAggregation || {};
  const dataAggregationReviewWarningCount = Number.isFinite(Number(dataAggregation.reviewWarningCount))
    ? Number(dataAggregation.reviewWarningCount)
    : Number.isFinite(Number(dataAggregation.dataAggregationReviewWarningCount))
      ? Number(dataAggregation.dataAggregationReviewWarningCount)
      : 0;
  const dataAggregationRuntimeBlockerCount = Number.isFinite(Number(dataAggregation.runtimeBlockerWarningCount))
    ? Number(dataAggregation.runtimeBlockerWarningCount)
    : Number.isFinite(Number(dataAggregation.dataAggregationRuntimeBlockerCount))
      ? Number(dataAggregation.dataAggregationRuntimeBlockerCount)
      : 0;
  const convergenceMatrixSummary = convergenceMatrix
    .filter((item) => item && typeof item === 'object')
    .map((entry) => ({
      moduleId: entry.moduleId,
      entryStatus: entry.entryStatus,
      gateStatus: entry.gateStatus,
      riskDebtKind: entry.riskDebtKind,
      redLineCategories: entry.redLineCategories || [],
      approvalActions: Array.isArray(entry.approvalActions) ? entry.approvalActions : [],
    }))
    .filter((entry) => typeof entry.moduleId === 'string' && entry.moduleId.length > 0);

  const sharedCatalog = dataCatalog
    .filter((item) => item?.ownership?.sharingKind === 'shared')
    .map((item) => pickFields(item, DATA_CATALOG_SUMMARY_FIELDS));

  const sharedKeys = new Set(sharedCatalog.map((item) => item.dataKey));
  const sharedEdges = edges
    .filter((edge) => sharedKeys.has(edge.dataKey))
    .map((edge) => pickFields(edge, EDGE_SUMMARY_FIELDS));
  const shellRouteSources = Array.isArray(report?.shellRoutes?.routes) ? report.shellRoutes.routes : [];
  const shellRouteSummaryFromReport = report?.shellRoutes?.summary || {};
  const moduleIds = new Set((moduleDataBus.modules || []).map((module) => module?.moduleId).filter(Boolean));
  const shellRouteSummary = {
    ...shellRouteSummaryFromReport,
    routeCount: shellRouteSummaryFromReport.routeCount || shellRouteSources.length,
    routeKeyCount: shellRouteSummaryFromReport.routeKeyCount || new Set(shellRouteSources.map((route) => route?.routeKey)).size,
    readyRouteCount: shellRouteSummaryFromReport.readyRouteCount
      ?? shellRouteSources.filter((route) => route?.entryStatus === 'ready').length,
    externalRouteCount: shellRouteSummaryFromReport.externalRouteCount
      ?? shellRouteSources.filter((route) => route?.entryStatus === 'external').length,
    unconnectedRouteCount: shellRouteSummaryFromReport.unconnectedRouteCount
      ?? shellRouteSources.filter((route) => route?.entryStatus === 'unconnected').length,
    gatedRouteCount: shellRouteSummaryFromReport.gatedRouteCount
      ?? shellRouteSources.filter((route) => (route?.approvalGateKeys || []).length > 0).length,
    missingEvidenceRouteCount: shellRouteSummaryFromReport.missingEvidenceRouteCount
      ?? shellRouteSources.filter((route) => (route?.evidenceLinks || []).length === 0).length,
    modeAvailabilitySummary: shellRouteSummaryFromReport.modeAvailabilitySummary || {
      personal: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
      demo: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
      market: { available: 0, hidden: 0, not_ready: 0, gated: 0 },
    },
    entryStatusSummary: shellRouteSummaryFromReport.entryStatusSummary || {
      ready: 0,
      not_ready: 0,
      external: 0,
      unconnected: 0,
      contract_only: 0,
      gated: 0,
    },
    warningCount: shellRouteSummaryFromReport.warningCount || 0,
    warnings: shellRouteSummaryFromReport.warnings || [],
  };
  for (const route of shellRouteSources) {
    const modeAvailability = route?.modeAvailability || {};
    for (const mode of ['personal', 'demo', 'market']) {
      const value = String(modeAvailability[mode] || 'not_ready');
      const summaryValue = shellRouteSummary.modeAvailabilitySummary?.[mode]?.[value];
      if (typeof summaryValue === 'number') {
        shellRouteSummary.modeAvailabilitySummary[mode][value] = (summaryValue || 0) + 1;
      }
    }
    const status = route?.entryStatus || 'not_ready';
    if (shellRouteSummary.entryStatusSummary && typeof shellRouteSummary.entryStatusSummary[status] === 'number') {
      shellRouteSummary.entryStatusSummary[status] += 1;
    }
    if (!route?.moduleId || !moduleIds.has(route.moduleId)) {
      shellRouteSummary.warnings.push({
        warningKind: 'unknown_module_id',
        routeKey: route?.routeKey,
        moduleId: route?.moduleId,
        issue: 'shell route references module id missing from module registry',
      });
      shellRouteSummary.warningCount += 1;
    }
    if (!(route?.evidenceLinks || []).length) {
      shellRouteSummary.warnings.push({
        warningKind: 'missing_evidence_link',
        routeKey: route?.routeKey,
        issue: 'shell route has no evidence links',
      });
      shellRouteSummary.warningCount += 1;
    }
  }

  const mappedWarnings = warnings.map((warning) => ({
    warningKind: warning.warningKind,
    dataKey: warning.dataKey,
    moduleId: warning.moduleId,
    issue: warning.issue,
    reason: warning.issue,
    owner: pickWarningOwner(warning, ownershipMap),
    evidenceFields: normalizeEvidenceFields(warning),
  }));

  return {
    ok: true,
    generatedAt: moduleDataBus.generatedAt || new Date().toISOString(),
    sharedDataCatalog: sharedCatalog,
    sharedEdges,
    sharedEdgeCount: sharedEdges.length,
    warningCount: mappedWarnings.length,
    modules: moduleDataBus.summary || {},
    interconnectPlan: {
      version: interconnectPlan.version,
      criticalGapCount: interconnectPlan.criticalGapCount,
      connectionReadyKeyCount: interconnectPlan.connectionReadyKeyCount,
      missingLocalProducerCount: interconnectPlan.missingLocalProducerCount,
      orphanedProducerCount: interconnectPlan.orphanedProducerCount,
      priority: interconnectPlan.priority,
    },
    crossBoundarySummary,
    warnings: mappedWarnings,
    shellRoutes: {
      routes: shellRouteSources.map((route) => pickFields(route, SHELL_ROUTE_FIELDS)),
      summary: shellRouteSummary,
    },
    approvalRequestMatrixCount: approvalRequestMatrixSummary.totalRequestCount,
    approvalNeedsDecisionCount: approvalRequestMatrixSummary.statusSummary?.needs_decision || 0,
    convergenceMatrixCount: convergenceMatrix.length,
    dataAggregationReviewWarningCount,
    dataAggregationRuntimeBlockerCount,
    approvalRequestMatrixSummary,
    convergenceMatrix: convergenceMatrixSummary,
  };
}

async function fetchSummary(baseUrl, format, includeExternal = false) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/portal/module-data-network?format=${format}${
    includeExternal ? '&includeExternal=true' : ''
  }`;
  const response = await fetch(url);
  if (!response.ok) {
    fail('route request failed', { url, status: response.status });
    return null;
  }
  return await response.json();
}

function validateContract(contract, modulesCountExpected) {
  if (!contract || typeof contract !== 'object') {
    fail('contract missing or malformed');
    return false;
  }

  if (!hasOnlyWhitelistedKeys(contract, CONTRACT_SUMMARY_KEYS)) {
    fail('contract includes unexpected summary fields');
    return false;
  }

  if (contract.ok !== true) {
    fail('contract indicates failure');
    return false;
  }

  if (!contract.modules || contract.modules.dataKeyCount === undefined || typeof contract.modules.dataKeyCount !== 'number') {
    fail('contract.modules missing expected summary');
    return false;
  }

  if (contract.modules.moduleCount !== modulesCountExpected) {
    fail('module count unexpected', {
      expected: modulesCountExpected,
      actual: contract.modules.moduleCount,
    });
    return false;
  }

  if (contract.boundaries && !validateBoundary(contract.boundaries)) {
    return false;
  }

  const sharedDataCatalog = Array.isArray(contract.sharedDataCatalog) ? contract.sharedDataCatalog : [];
  const sharedEdges = Array.isArray(contract.sharedEdges) ? contract.sharedEdges : [];
  const sharedKeySet = new Set(sharedDataCatalog.map((item) => item?.dataKey).filter(Boolean));

  for (const edge of sharedEdges) {
    if (!sharedKeySet.has(edge.dataKey)) {
      fail('shared edge references non-shared data key', edge);
      return false;
    }
  }

  for (const item of sharedDataCatalog) {
    if (!validateSummaryCatalogItem(item)) {
      fail('sharedDataCatalog item missing summary field', item);
      return false;
    }
  }

  for (const edge of sharedEdges) {
    if (!validateSummaryEdgeItem(edge)) {
      fail('sharedEdges item missing summary field', edge);
      return false;
    }
  }

  if (contract.sharedEdgeCount !== sharedEdges.length) {
    fail('sharedEdgeCount mismatch', {
      declared: contract.sharedEdgeCount,
      actual: sharedEdges.length,
    });
    return false;
  }

  if (!contract.interconnectPlan || contract.interconnectPlan.version !== 'v1') {
    fail('interconnect plan missing', contract.interconnectPlan);
    return false;
  }

  if (!hasOnlyWhitelistedKeys(contract.interconnectPlan, INTERCONNECT_SUMMARY_KEYS)) {
    fail('interconnect plan includes unexpected fields');
    return false;
  }

  if (!hasOnlyWhitelistedKeys(contract.crossBoundarySummary, CROSS_BOUNDARY_SUMMARY_KEYS)) {
    fail('cross boundary summary includes unexpected fields');
    return false;
  }

  if (!contract.shellRoutes || typeof contract.shellRoutes !== 'object') {
    fail('shellRoutes missing');
    return false;
  }
  const shellRoutes = Array.isArray(contract.shellRoutes.routes) ? contract.shellRoutes.routes : [];
  const shellRouteSummary = contract.shellRoutes.summary || {};
  if (!validateShellRouteSummary(shellRouteSummary)) {
    fail('shell route summary invalid');
    return false;
  }
  for (const warning of shellRouteSummary.warnings) {
    if (!validateShellRouteSummaryWarning(warning)) {
      fail('shell route warning invalid', warning);
      return false;
    }
  }
  for (const route of shellRoutes) {
    if (!validateShellRouteItem(route)) {
      fail('shell route item missing required field', route);
      return false;
    }
  }

  if (contract.externalConnectionSummary != null) {
    if (!hasOnlyWhitelistedKeys(contract.externalConnectionSummary, EXTERNAL_CONNECTION_SUMMARY_KEYS)) {
      fail('externalConnectionSummary has unexpected keys');
      return false;
    }
    if (!Number.isInteger(contract.externalConnectionSummary.providerCount)
      || !Number.isInteger(contract.externalConnectionSummary.enabledCount)) {
      fail('externalConnectionSummary counts must be integers');
      return false;
    }
    if (!Array.isArray(contract.externalConnectionSummary.providerStates)) {
      fail('externalConnectionSummary.providerStates should be array');
      return false;
    }
    for (const providerState of contract.externalConnectionSummary.providerStates) {
      if (!hasOnlyWhitelistedKeys(providerState, EXTERNAL_PROVIDER_KEYS)) {
        fail('externalConnectionSummary.providerStates item has unexpected keys', providerState);
        return false;
      }
      if (typeof providerState.provider !== 'string' || providerState.provider.length === 0) {
        fail('externalConnectionSummary.providerStates item missing provider', providerState);
        return false;
      }
    }
  }

  for (const warning of contract.warnings) {
    if (!validateDataWarning(warning)) {
      fail('contract warning summary invalid', warning);
      return false;
    }
  }
  if (contract.approvalRequestMatrixSummary && typeof contract.approvalRequestMatrixSummary !== 'object') {
    fail('approvalRequestMatrixSummary should be an object');
    return false;
  }
  if (contract.convergenceMatrix && !Array.isArray(contract.convergenceMatrix)) {
    fail('convergenceMatrix should be an array');
    return false;
  }

  return true;
}

function validateOfflineContract(contract, modulesCountExpected) {
  if (!validateContract(contract, modulesCountExpected)) return false;

  return true;
}

async function main() {
  const { offline, format, baseUrl, includeExternal } = parseArgs();
  let payload;

  if (offline) {
    const reportResult = spawnSync('node', ['scripts/report-module-registry.mjs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    if (reportResult.status !== 0) {
      fail('local report generation failed', {
        status: reportResult.status,
        stderr: reportResult.stderr?.trim(),
      });
      return;
    }
    const report = JSON.parse(reportResult.stdout);
    const network = buildSharedSummaryFromReport(report);
    const expectedModuleCount = report.summary?.moduleCount || network.modules?.moduleCount || 0;
    if (!validateOfflineContract(network, expectedModuleCount)) {
      return;
    }
    payload = network;
  } else {
    const body = await fetchSummary(baseUrl, format, includeExternal);
    if (body == null) return;
    if (!body.contract || !body.contract.sharedDataCatalog) {
      fail('route contract payload malformed');
      return;
    }
    if (!validateContract(body.contract, body.contract.modules?.moduleCount || 10)) return;
    payload = body.contract;
  }

  if (process.exitCode === 1) return;
  console.log('module-data-network precheck passed');
  console.log(JSON.stringify({
    ok: true,
    modules: payload.modules?.moduleCount || payload.modules?.moduleCount || null,
    sharedDataKeyCount: payload.sharedDataCatalog?.length || 0,
    sharedEdgeCount: payload.sharedEdgeCount,
    criticalGapCount: payload.interconnectPlan?.criticalGapCount,
    priority: payload.interconnectPlan?.priority,
    warningCount: payload.warningCount || 0,
    dataAggregationReviewWarningCount: payload.dataAggregationReviewWarningCount || 0,
    dataAggregationRuntimeBlockerCount: payload.dataAggregationRuntimeBlockerCount || 0,
    approvalRequestMatrixCount: payload.approvalRequestMatrixCount || 0,
    approvalNeedsDecisionCount: payload.approvalNeedsDecisionCount || 0,
    convergenceMatrixCount: payload.convergenceMatrixCount || 0,
  }, null, 2));
}

await main();
