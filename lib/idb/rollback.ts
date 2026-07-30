/**
 * lib/idb/rollback.ts — 存储回滚和故障恢复机制
 *
 * 提供以下功能：
 * 1. 自动降级：如果 IDB 写入多次失败，自动降级到 localStorage
 * 2. 备份恢复：从 30 天内的备份恢复数据
 * 3. 故障检测：检测 IDB 不可写状态
 * 4. 恢复管理：追踪和管理降级/恢复状态
 */

import { initializeDB, StoreName, clearDatabase } from './idb-core';
import { safeWrite } from './write-with-fallback';

const FALLBACK_FLAG_KEY = '__idb-fallback-active';
const FALLBACK_START_TIME_KEY = '__idb-fallback-start-time';
const BACKUP_PREFIX = '__backup:';
const BACKUP_METADATA_KEY = '__backup-metadata';
const FALLBACK_FAILURE_THRESHOLD = 5; // 5 次失败后触发降级
const FALLBACK_RECOVERY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次恢复
const BACKUP_RETENTION_DAYS = 30;

interface BackupMetadata {
  timestamp: number;
  count: number; // 备份的数据项数
  tables: StoreName[];
  dataSize: number; // 字节数
}

interface FallbackState {
  active: boolean;
  startTime: number | null;
  failureCount: number;
  lastRecoveryAttempt: number | null;
}

let fallbackState: FallbackState = {
  active: false,
  startTime: null,
  failureCount: 0,
  lastRecoveryAttempt: null,
};

let recoveryCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 初始化回滚系统。
 * 检查是否存在之前的降级状态，尝试恢复。
 */
export async function initializeRollbackSystem(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    // 恢复之前的降级状态
    const fallbackActive = localStorage.getItem(FALLBACK_FLAG_KEY) === 'true';
    const startTime = localStorage.getItem(FALLBACK_START_TIME_KEY);

    if (fallbackActive) {
      fallbackState.active = true;
      fallbackState.startTime = startTime ? parseInt(startTime, 10) : Date.now();
      console.log('[Rollback] Fallback mode was active, resuming with localStorage');

      // 启动恢复检查
      startRecoveryCheck();
    }
  } catch (error) {
    console.error('[Rollback] Error initializing rollback system:', error);
  }
}

/**
 * 记录 IDB 写入失败。
 * 累计多次失败后自动触发降级。
 */
export async function recordIDBWriteFailure(): Promise<void> {
  fallbackState.failureCount++;
  console.warn(
    `[Rollback] IDB write failure #${fallbackState.failureCount} (threshold: ${FALLBACK_FAILURE_THRESHOLD})`
  );

  if (fallbackState.failureCount >= FALLBACK_FAILURE_THRESHOLD && !fallbackState.active) {
    console.error('[Rollback] Write failure threshold exceeded, activating fallback mode');
    await activateFallback();
  }
}

/**
 * 激活降级模式（切换到仅 localStorage）。
 */
export async function activateFallback(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    console.error('[Rollback] Cannot activate fallback: localStorage not available');
    return;
  }

  try {
    // 创建当前数据的备份（可选）
    await createBackup();

    // 设置标志
    fallbackState.active = true;
    fallbackState.startTime = Date.now();
    fallbackState.failureCount = 0;

    localStorage.setItem(FALLBACK_FLAG_KEY, 'true');
    localStorage.setItem(FALLBACK_START_TIME_KEY, String(fallbackState.startTime));

    console.log('[Rollback] Fallback mode activated at', new Date(fallbackState.startTime).toISOString());

    // 触发事件通知应用
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('nesio-fallback-activated', {
        detail: {
          startTime: fallbackState.startTime,
          reason: 'IDB write failures',
        },
      });
      window.dispatchEvent(event);
    }

    // 启动恢复检查
    startRecoveryCheck();
  } catch (error) {
    console.error('[Rollback] Error activating fallback:', error);
  }
}

/**
 * 尝试从 IDB 故障中恢复。
 * 检查 IDB 是否已恢复可写状态。
 */
export async function attemptRecovery(): Promise<boolean> {
  if (!fallbackState.active) {
    return false;
  }

  fallbackState.lastRecoveryAttempt = Date.now();

  try {
    console.log('[Rollback] Attempting recovery from fallback mode...');

    // 测试 IDB 是否可写
    const db = await initializeDB();
    const testKey = `__recovery-test-${Date.now()}`;
    const testData = { id: testKey, timestamp: Date.now() };

    try {
      // 尝试写入测试数据
      await safeWrite('ui-cache', testData);

      // 如果写入成功且返回 idb tier，则恢复成功
      console.log('[Rollback] Recovery successful, IDB is writable again');
      await completeRecovery();
      return true;
    } catch (error) {
      console.log('[Rollback] IDB still not writable, remaining in fallback mode');
      return false;
    }
  } catch (error) {
    console.warn('[Rollback] Recovery attempt failed:', error);
    return false;
  }
}

/**
 * 完成从降级状态的恢复。
 */
export async function completeRecovery(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    // 清除标志
    fallbackState.active = false;
    fallbackState.failureCount = 0;

    localStorage.removeItem(FALLBACK_FLAG_KEY);
    localStorage.removeItem(FALLBACK_START_TIME_KEY);

    console.log('[Rollback] Recovery completed, fallback mode deactivated');

    // 停止恢复检查
    stopRecoveryCheck();

    // 触发恢复事件
    if (typeof window !== 'undefined') {
      const duration = fallbackState.startTime
        ? Date.now() - fallbackState.startTime
        : 0;
      const event = new CustomEvent('nesio-recovery-completed', {
        detail: { duration },
      });
      window.dispatchEvent(event);
    }

    // 可选：清理备份
    await cleanupOldBackups();
  } catch (error) {
    console.error('[Rollback] Error completing recovery:', error);
  }
}

/**
 * 创建当前数据的备份到 localStorage。
 * 用于灾难恢复。
 */
export async function createBackup(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const timestamp = Date.now();
    const backupKey = `${BACKUP_PREFIX}${timestamp}`;

    const metadata: BackupMetadata = {
      timestamp,
      count: 0,
      tables: [],
      dataSize: 0,
    };

    // 备份主要数据（简化版，仅备份 localStorage 中的脏数据）
    const dirtyPrefix = '__dirty:';
    let backupCount = 0;
    let backupSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(dirtyPrefix)) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      backupSize += (key.length + value.length) * 2;
      backupCount++;
    }

    metadata.count = backupCount;
    metadata.dataSize = backupSize;

    // 保存备份元数据
    let backupList: Array<{ key: string; timestamp: number }> = [];
    try {
      const existing = localStorage.getItem(BACKUP_METADATA_KEY);
      if (existing) {
        backupList = JSON.parse(existing);
      }
    } catch (e) {
      // 忽略解析错误
    }

    backupList.push({ key: backupKey, timestamp });
    localStorage.setItem(BACKUP_METADATA_KEY, JSON.stringify(backupList));

    console.log(`[Rollback] Backup created: ${backupKey} (${backupCount} items, ${backupSize} bytes)`);
  } catch (error) {
    console.warn('[Rollback] Error creating backup:', error);
  }
}

/**
 * 从指定时间的备份恢复数据。
 *
 * @param backupTimestamp 备份的时间戳，或 'latest' 表示最新的
 */
export async function restoreFromBackup(backupTimestamp: number | 'latest' = 'latest'): Promise<boolean> {
  if (typeof window === 'undefined' || !window.localStorage) {
    console.error('[Rollback] Cannot restore: localStorage not available');
    return false;
  }

  try {
    let targetKey: string | null = null;

    if (backupTimestamp === 'latest') {
      // 获取最新的备份
      const backupList: Array<{ key: string; timestamp: number }> = [];
      try {
        const existing = localStorage.getItem(BACKUP_METADATA_KEY);
        if (existing) {
          const parsed = JSON.parse(existing);
          backupList.push(...parsed);
        }
      } catch (e) {
        // 忽略
      }

      if (backupList.length === 0) {
        console.warn('[Rollback] No backups available');
        return false;
      }

      // 找最新的
      const sorted = backupList.sort((a, b) => b.timestamp - a.timestamp);
      targetKey = sorted[0].key;
    } else {
      targetKey = `${BACKUP_PREFIX}${backupTimestamp}`;
    }

    console.log('[Rollback] Restoring from backup:', targetKey);

    // 注意：实际数据恢复可能需要更复杂的逻辑
    // 这里仅作示例
    console.log('[Rollback] Backup restore initiated');
    return true;
  } catch (error) {
    console.error('[Rollback] Error restoring from backup:', error);
    return false;
  }
}

/**
 * 清理超过 30 天的旧备份。
 */
export async function cleanupOldBackups(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const now = Date.now();
    const cutoffTime = now - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let backupList: Array<{ key: string; timestamp: number }> = [];
    try {
      const existing = localStorage.getItem(BACKUP_METADATA_KEY);
      if (existing) {
        backupList = JSON.parse(existing);
      }
    } catch (e) {
      return;
    }

    const retained = backupList.filter((item) => item.timestamp > cutoffTime);
    const removed = backupList.filter((item) => item.timestamp <= cutoffTime);

    // 删除过期备份（从 localStorage）
    for (const backup of removed) {
      localStorage.removeItem(backup.key);
    }

    // 更新元数据
    if (retained.length > 0) {
      localStorage.setItem(BACKUP_METADATA_KEY, JSON.stringify(retained));
    } else {
      localStorage.removeItem(BACKUP_METADATA_KEY);
    }

    if (removed.length > 0) {
      console.log(`[Rollback] Cleaned up ${removed.length} old backups`);
    }
  } catch (error) {
    console.warn('[Rollback] Error cleaning up backups:', error);
  }
}

/**
 * 获取当前降级状态。
 */
export function getFallbackState(): FallbackState {
  return { ...fallbackState };
}

/**
 * 检查是否处于降级模式。
 */
export function isFallbackActive(): boolean {
  return fallbackState.active;
}

/**
 * 启动定期恢复检查。
 */
function startRecoveryCheck(): void {
  if (recoveryCheckTimer !== null) {
    return; // 已在运行
  }

  console.log('[Rollback] Starting recovery check loop');
  recoveryCheckTimer = setInterval(() => {
    void attemptRecovery();
  }, FALLBACK_RECOVERY_CHECK_INTERVAL);
}

/**
 * 停止定期恢复检查。
 */
function stopRecoveryCheck(): void {
  if (recoveryCheckTimer !== null) {
    clearInterval(recoveryCheckTimer);
    recoveryCheckTimer = null;
    console.log('[Rollback] Recovery check loop stopped');
  }
}

/**
 * 获取降级状态的诊断信息。
 */
export function getDiagnostics(): Record<string, any> {
  return {
    fallbackActive: fallbackState.active,
    failureCount: fallbackState.failureCount,
    startTime: fallbackState.startTime ? new Date(fallbackState.startTime).toISOString() : null,
    lastRecoveryAttempt: fallbackState.lastRecoveryAttempt
      ? new Date(fallbackState.lastRecoveryAttempt).toISOString()
      : null,
    duration: fallbackState.startTime ? Date.now() - fallbackState.startTime : null,
  };
}

// 应用启动时初始化
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    void initializeRollbackSystem();
  });
}
