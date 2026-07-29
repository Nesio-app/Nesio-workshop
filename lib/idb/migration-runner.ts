/**
 * migration-runner.ts — P0 数据迁移协调器
 *
 * 按顺序执行所有迁移器：
 * 1. 生活图谱 (Life Graph)
 * 2. 银行数据 (Bank Transactions/Accounts/Holdings)
 * 3. 健康数据 (Health Metrics)
 * 4. 人物记录 (Person Records)
 *
 * 记录迁移日志，失败时保留 localStorage 并标记为待重试。
 */

import { initializeDB } from './idb-core';
import { migrateLifeGraph } from './migrators/life-graph-migrator';
import { migrateBankData } from './migrators/bank-tx-migrator';
import { migrateHealth } from './migrators/health-migrator';
import { migratePersonRecords } from './migrators/person-records-migrator';
import { setGlobalLamportClock } from './version-manager';

export interface MigrationLog {
  timestamp: string;
  version: number;
  status: 'success' | 'partial' | 'failed';
  steps: StepLog[];
  error?: string;
}

export interface StepLog {
  name: string;
  success: boolean;
  itemCount: number;
  checksum: string;
  error?: string;
  duration: number; // ms
}

const MIGRATION_LOG_KEY = 'nesio-migration-log-v1';
const MIGRATION_MARKER_KEY = 'nesio-migration-completed-v1';

/**
 * 从 IDB 中获取最大的 Lamport 时钟值。
 * 用于初始化全局时钟，确保迁移后的版本不会冲突。
 */
async function getMaxLamportClockFromIDB(idb: IDBDatabase): Promise<number> {
  try {
    let maxClock = 0;

    // 检查 signals 表
    const signalsTx = idb.transaction(['signals'], 'readonly');
    const signalsStore = signalsTx.objectStore('signals');

    await new Promise<void>((resolve) => {
      const request = signalsStore.getAll();
      request.onsuccess = () => {
        const items = request.result as any[];
        for (const item of items) {
          if (item?.__version?.lamportClock) {
            maxClock = Math.max(maxClock, item.__version.lamportClock);
          }
        }
        resolve();
      };
      request.onerror = () => resolve();
    });

    // 检查 user_module_data 表
    const moduleTx = idb.transaction(['user_module_data'], 'readonly');
    const moduleStore = moduleTx.objectStore('user_module_data');

    await new Promise<void>((resolve) => {
      const request = moduleStore.getAll();
      request.onsuccess = () => {
        const items = request.result as any[];
        for (const item of items) {
          if (item?.__version?.lamportClock) {
            maxClock = Math.max(maxClock, item.__version.lamportClock);
          }
        }
        resolve();
      };
      request.onerror = () => resolve();
    });

    console.log(`[MigrationRunner] Max Lamport clock found in IDB: ${maxClock}`);
    return maxClock;
  } catch (error) {
    console.warn('[MigrationRunner] Failed to get max Lamport clock:', error);
    return 0;
  }
}

/**
 * 获取迁移日志。
 */
export function getMigrationLog(): MigrationLog | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(MIGRATION_LOG_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * 检查迁移是否已完成。
 */
export function isMigrationCompleted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(MIGRATION_MARKER_KEY) === 'true';
}

/**
 * 保存迁移日志。
 */
function saveMigrationLog(log: MigrationLog): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.error('[MigrationRunner] Failed to save log:', e);
  }
}

/**
 * 标记迁移已完成。
 */
function markMigrationCompleted(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MIGRATION_MARKER_KEY, 'true');
  } catch (e) {
    console.error('[MigrationRunner] Failed to mark migration as completed:', e);
  }
}

/**
 * 主迁移函数：按顺序执行所有迁移器。
 * 返回完整的迁移日志。
 */
export async function runMigrations(): Promise<MigrationLog> {
  const startTime = Date.now();
  const steps: StepLog[] = [];
  let overallStatus: 'success' | 'partial' | 'failed' = 'success';
  let overallError: string | undefined = undefined;

  if (typeof window === 'undefined') {
    const errorLog: MigrationLog = {
      timestamp: new Date().toISOString(),
      version: 1,
      status: 'failed',
      steps: [],
      error: 'Not in browser environment',
    };
    return errorLog;
  }

  // 检查是否已迁移
  if (isMigrationCompleted()) {
    console.log('[MigrationRunner] Migration already completed, skipping');
    return getMigrationLog() || {
      timestamp: new Date().toISOString(),
      version: 1,
      status: 'success',
      steps: [],
    };
  }

  try {
    // 初始化 IDB
    const idb = await initializeDB();
    console.log('[MigrationRunner] IDB initialized, starting migrations');

    // 初始化全局 Lamport 时钟
    // 从 IDB 读取最大时钟值，确保新版本不会重复
    let maxLamportClockSeen = await getMaxLamportClockFromIDB(idb);
    if (maxLamportClockSeen > 0) {
      setGlobalLamportClock(maxLamportClockSeen);
    }

    // 步骤 1: 迁移生活图谱
    let stepStartTime = Date.now();
    try {
      const result = await migrateLifeGraph(idb);
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'life-graph',
        success: result.success,
        itemCount: result.itemCount,
        checksum: result.checksum,
        error: result.error,
        duration,
      });
      if (!result.success) {
        overallStatus = 'partial';
        console.error('[MigrationRunner] LifeGraph migration failed:', result.error);
      } else {
        console.log(`[MigrationRunner] LifeGraph: ${result.itemCount} items migrated`);
      }
    } catch (e) {
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'life-graph',
        success: false,
        itemCount: 0,
        checksum: '',
        error: e instanceof Error ? e.message : String(e),
        duration,
      });
      overallStatus = 'partial';
      console.error('[MigrationRunner] LifeGraph migration error:', e);
    }

    // 步骤 2: 迁移银行数据
    stepStartTime = Date.now();
    try {
      const result = await migrateBankData(idb);
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'bank-data',
        success: result.success,
        itemCount: result.txCount + result.accountCount + result.holdingCount,
        checksum: `tx:${result.txChecksum.slice(0, 8)}|acc:${result.accountsChecksum.slice(0, 8)}|hold:${result.holdingsChecksum.slice(0, 8)}`,
        error: result.error,
        duration,
      });
      if (!result.success) {
        overallStatus = 'partial';
        console.error('[MigrationRunner] Bank migration failed:', result.error);
      } else {
        console.log(
          `[MigrationRunner] Bank: ${result.txCount} tx, ${result.accountCount} accounts, ${result.holdingCount} holdings`
        );
      }
    } catch (e) {
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'bank-data',
        success: false,
        itemCount: 0,
        checksum: '',
        error: e instanceof Error ? e.message : String(e),
        duration,
      });
      overallStatus = 'partial';
      console.error('[MigrationRunner] Bank migration error:', e);
    }

    // 步骤 3: 迁移健康数据
    stepStartTime = Date.now();
    try {
      const result = await migrateHealth(idb);
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'health',
        success: result.success,
        itemCount: result.itemCount,
        checksum: result.checksum,
        error: result.error,
        duration,
      });
      if (!result.success) {
        overallStatus = 'partial';
        console.error('[MigrationRunner] Health migration failed:', result.error);
      } else {
        console.log(`[MigrationRunner] Health: ${result.itemCount} items migrated`);
      }
    } catch (e) {
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'health',
        success: false,
        itemCount: 0,
        checksum: '',
        error: e instanceof Error ? e.message : String(e),
        duration,
      });
      overallStatus = 'partial';
      console.error('[MigrationRunner] Health migration error:', e);
    }

    // 步骤 4: 迁移人物记录
    stepStartTime = Date.now();
    try {
      const result = await migratePersonRecords(idb);
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'person-records',
        success: result.success,
        itemCount: result.itemCount,
        checksum: result.checksum,
        error: result.error,
        duration,
      });
      if (!result.success) {
        overallStatus = 'partial';
        console.error('[MigrationRunner] PersonRecords migration failed:', result.error);
      } else {
        console.log(`[MigrationRunner] PersonRecords: ${result.itemCount} items migrated`);
      }
    } catch (e) {
      const duration = Date.now() - stepStartTime;
      steps.push({
        name: 'person-records',
        success: false,
        itemCount: 0,
        checksum: '',
        error: e instanceof Error ? e.message : String(e),
        duration,
      });
      overallStatus = 'partial';
      console.error('[MigrationRunner] PersonRecords migration error:', e);
    }

    // 如果所有迁移都成功，标记为完成
    if (overallStatus === 'success') {
      markMigrationCompleted();
      console.log('[MigrationRunner] All migrations completed successfully');
    } else {
      console.warn('[MigrationRunner] Some migrations failed or had issues - localStorage preserved for retry');
    }
  } catch (error) {
    overallStatus = 'failed';
    overallError = error instanceof Error ? error.message : String(error);
    console.error('[MigrationRunner] Fatal migration error:', error);
  }

  const totalDuration = Date.now() - startTime;
  const log: MigrationLog = {
    timestamp: new Date().toISOString(),
    version: 1,
    status: overallStatus,
    steps,
    error: overallError,
  };

  saveMigrationLog(log);
  console.log(
    `[MigrationRunner] Migration completed in ${totalDuration}ms with status: ${overallStatus}`
  );

  return log;
}

/**
 * 重试迁移（供需要手动重试的场景）。
 * 清除 MIGRATION_MARKER_KEY，允许 runMigrations() 再次执行。
 */
export function resetMigrationState(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(MIGRATION_MARKER_KEY);
    console.log('[MigrationRunner] Migration state reset - ready for retry');
  } catch (e) {
    console.error('[MigrationRunner] Failed to reset migration state:', e);
  }
}
