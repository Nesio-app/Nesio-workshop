/**
 * lib/idb — IndexedDB 核心基础设施导出
 *
 * 完整的离线数据存储解决方案，包括：
 * - IDB 初始化和配额管理
 * - 版本化和冲突检测
 * - 安全写入（失败自动降级）
 * - 离线同步队列
 * - 自动清理机制
 */

// === idb-core.ts ===
export type { StoreName } from './idb-core';
export {
  initializeDB,
  getStore,
  getTransaction,
  checkQuota,
  shouldRequestPersistent,
  requestPersistentStorage,
  estimateDBSize,
  clearDatabase,
  closeDatabase,
  healthCheck,
} from './idb-core';

// === version-manager.ts ===
export type { VersionInfo, VersionedData } from './version-manager';
export {
  generateVersion,
  setVersion,
  getVersion,
  stripVersion,
  sha256,
  computeChecksum,
  compareVersions,
  resolveLWW,
  verifyIntegrity,
  markChecksum,
  setGlobalLamportClock,
  getGlobalLamportClock,
} from './version-manager';

// === write-with-fallback.ts ===
export type { SafeWriteResult } from './write-with-fallback';
export {
  safeWrite,
  safeWriteBatch,
  getDirtyData,
  clearAllDirtyMarks,
  listenToWriteEvents,
} from './write-with-fallback';

// === offline-queue.ts ===
export type { SyncQueueItem, SyncStatus } from './offline-queue';
export {
  enqueue,
  enqueueBatch,
  dequeue,
  markSuccess,
  markFailure,
  retryFailed,
  getQueueStats,
  estimateOfflineCapacity,
  cleanupExpired as cleanupQueueExpired,
} from './offline-queue';

// === cleanup.ts ===
export {
  cleanupExpiredByTTL,
  cleanupLRU,
  cleanupExpiredCache,
  performFullCleanup,
  startPeriodicCleanup,
  stopPeriodicCleanup,
  getCleanupStats,
  getPhase1CleanupStats,
} from './cleanup';

// === migration-runner.ts ===
export type { MigrationLog, StepLog } from './migration-runner';
export {
  runMigrations,
  getMigrationLog,
  isMigrationCompleted,
  resetMigrationState,
} from './migration-runner';

// === migrators ===
export { migrateLifeGraph } from './migrators/life-graph-migrator';
export { migrateBankData } from './migrators/bank-tx-migrator';
export { migrateHealth } from './migrators/health-migrator';
export { migratePersonRecords } from './migrators/person-records-migrator';

// === Phase 1 Cache Migrators ===
export type { CacheSyncStateMigrationResult } from './migrators/cache-sync-state-migrator';
export {
  migrateSyncStateCache,
  verifySyncStateCache,
  rollbackSyncStateCache,
} from './migrators/cache-sync-state-migrator';

export type { CacheApiCacheMigrationResult } from './migrators/cache-api-cache-migrator';
export {
  migrateApiCache,
  verifyApiCache,
  rollbackApiCache,
} from './migrators/cache-api-cache-migrator';

export type { CacheMapMigrationResult } from './migrators/cache-map-migrator';
export {
  migrateMapCache,
  verifyMapCache,
  rollbackMapCache,
} from './migrators/cache-map-migrator';

export type { CacheThumbnailsMigrationResult } from './migrators/cache-thumbnails-migrator';
export {
  migrateThumbnailsCache,
  verifyThumbnailsCache,
  rollbackThumbnailsCache,
} from './migrators/cache-thumbnails-migrator';

// === init-hook.ts ===
export type { InitHookOptions } from './init-hook';
export {
  initializeStorageOnApp,
  resetInitializationState,
} from './init-hook';

// === storage-monitor.ts ===
export type { StorageMetrics } from './storage-monitor';
export {
  getStorageMetrics,
  recordWriteAttempt,
  resetFailureRateStats,
  startPeriodicStatsReset,
  formatStorageMetrics,
  getDetailedStorageReport,
  shouldWarnUser,
  getStorageProblemSummary,
  getMigrationProgress,
} from './storage-monitor';

// === integrity-checker.ts ===
export type { IntegrityCheckResult } from './integrity-checker';
export {
  generateChecksum,
  verifyChecksum,
  verifyMigration,
  performSamplingVerification,
  performFullVerification,
  getLocalStorageKeySize,
  getTotalLocalStorageSize,
} from './integrity-checker';

// === backup-manager.ts ===
export type { BackupItem, BackupSummary } from './backup-manager';
export {
  createBackup,
  hasBackup,
  restoreFromBackup,
  listBackups,
  cleanupOldBackups,
  deleteBackups,
  getTotalBackupSize,
  getBackupSummary,
} from './backup-manager';

// === migration-validator.ts ===
export type { MigrationValidationResult } from './migration-validator';
export {
  validateMigration,
  validateMultipleMigrations,
  generateValidationReport,
} from './migration-validator';

// === sync-queue-engine.ts ===
export type { SyncQueueEntry } from './sync-queue-engine';
export {
  enqueueSyncItem,
  dequeueSyncItem,
  markSyncItemSucceeded,
  markSyncItemFailed,
  getSyncQueueStats,
  getPendingRetryItems,
  cleanupSucceededItems,
} from './sync-queue-engine';

// === phase1-migration.ts ===
export type { Phase1MigrationResult } from './phase1-migration';
export {
  executePhase1Migration,
  getLastMigrationLog,
  generateMigrationReport,
} from './phase1-migration';

// === phase1-rollback.ts ===
export type { RollbackResult } from './phase1-rollback';
export {
  rollbackPhase1,
  rollbackSingleKey,
  rollbackCategory,
  getLastRollbackLog,
  getAllRollbackLogs,
  cleanupOldRollbackLogs,
} from './phase1-rollback';

// === rollback.ts ===
export {
  initializeRollbackSystem,
  recordIDBWriteFailure,
  activateFallback,
  attemptRecovery,
  completeRecovery,
  createBackup,
  restoreFromBackup,
  cleanupOldBackups,
  getFallbackState,
  isFallbackActive,
  getDiagnostics as getRollbackDiagnostics,
} from './rollback';

// === health-check.ts ===
export type { HealthCheckResult } from './health-check';
export {
  performHealthCheck,
  recordDiagnostic,
  flushDiagnostics,
  startPeriodicHealthCheck,
  stopPeriodicHealthCheck,
  getPendingDiagnosticsCount,
  getDiagnosticsReport,
} from './health-check';

/**
 * 初始化 IDB 基础设施的便捷函数。
 * 在应用启动时调用一次。
 */
export async function initializeIDBInfrastructure(options?: {
  enablePeriodicCleanup?: boolean;
  cleanupIntervalMs?: number;
  requestPersistentStorage?: boolean;
}): Promise<void> {
  // 延迟导入以避免循环依赖
  const core = await import('./idb-core');
  const cleanup = await import('./cleanup');

  try {
    // 1. 初始化数据库
    await core.initializeDB();
    console.log('[IDB] Database initialized successfully');

    // 2. 检查健康状态
    const healthy = await core.healthCheck();
    if (!healthy) {
      console.warn('[IDB] Health check failed, but continuing anyway');
    }

    // 3. 可选：请求持久化存储
    if (options?.requestPersistentStorage) {
      const shouldRequest = await core.shouldRequestPersistent();
      if (shouldRequest) {
        await core.requestPersistentStorage();
      }
    }

    // 4. 可选：启动定期清理
    if (options?.enablePeriodicCleanup !== false) {
      cleanup.startPeriodicCleanup(options?.cleanupIntervalMs);
    }

    console.log('[IDB] Infrastructure initialization complete');
  } catch (error) {
    console.error('[IDB] Infrastructure initialization failed:', error);
    throw error;
  }
}
