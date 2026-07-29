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
