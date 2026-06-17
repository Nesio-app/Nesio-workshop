const CONTRACT_VERSION = 'offline-sync-conflict-contract-v0';

const CONFLICT_STATES = Object.freeze(['none', 'pending', 'conflict', 'resolved', 'failed']);
const RETRY_STATES = Object.freeze(['idle', 'queued', 'retrying', 'paused', 'failed', 'abandoned']);

const BOUNDARIES = Object.freeze({
  syncEnabled: false,
  cloudSyncEnabled: false,
  backgroundWorkerEnabled: false,
  networkRequestsEnabled: false,
  uploadsUserData: false,
  realConflictMergeEnabled: false,
  realSyncRequiresCeoGate: true,
});

function readinessForTool(tool) {
  if (tool.id === 'inventory') {
    return {
      syncMode: 'local_only_now',
      syncReadiness: 'sync_candidate_later',
      localQueueModel: 'future_offline_queue_contract_only',
      mergePolicy: 'manual_merge_for_future_multi_device',
    };
  }

  return {
    syncMode: 'local_only_now',
    syncReadiness: tool.ready ? 'local_only_now' : 'not_eligible_yet',
    localQueueModel: 'none_in_v0',
    mergePolicy: 'manual_merge_required_if_sync_added',
  };
}

function buildSyncEntry(tool) {
  const readiness = readinessForTool(tool);

  return {
    moduleId: tool.id,
    label: tool.name,
    ...readiness,
    syncEnabled: false,
    cloudSyncEnabled: false,
    backgroundWorkerEnabled: false,
    networkRequestsEnabled: false,
    uploadsUserData: false,
    defaultConflictState: 'none',
    retryState: 'idle',
    lastWriteWinsAllowedForLowRiskMetadata: false,
    manualMergeRequiredForUserData: true,
    syncRequiresCeoGate: true,
  };
}

export function buildOfflineSyncConflictContract(tools) {
  const modules = tools.map((tool) => buildSyncEntry(tool));
  const syncEnabledCount = modules.filter((entry) => entry.syncEnabled).length;

  return {
    version: CONTRACT_VERSION,
    implementation: 'report-only',
    boundaries: { ...BOUNDARIES },
    conflictStates: [...CONFLICT_STATES],
    retryStates: [...RETRY_STATES],
    futureOfflineQueue: {
      enabledNow: false,
      workerEnabled: false,
      storage: 'local_contract_only',
      queueRecordShape: {
        queueId: 'string',
        moduleId: 'string',
        operationKind: 'create|update|delete|merge',
        localRevision: 'string',
        retryState: [...RETRY_STATES],
        conflictState: [...CONFLICT_STATES],
      },
      sendsNetworkRequests: false,
    },
    mergePolicies: {
      lastWriteWins: {
        enabledNow: false,
        allowedOnlyForFutureLowRiskMetadata: true,
      },
      manualMerge: {
        enabledNow: false,
        defaultForSensitiveData: true,
        requiredForInventoryUserData: true,
      },
    },
    summary: {
      moduleCount: modules.length,
      syncEnabledModuleCount: syncEnabledCount,
      cloudSyncEnabled: false,
      offlineQueueEnabledNow: false,
      syncConflictModelReadable: true,
      inventorySyncReadiness: modules.find((entry) => entry.moduleId === 'inventory')?.syncReadiness || 'not_found',
    },
    modules,
    warnings: [],
  };
}
