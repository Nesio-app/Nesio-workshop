/**
 * lib/idb/init-hook.ts — 应用启动时的 IndexedDB 初始化钩子
 *
 * 在 Portal.tsx 挂载前调用，负责完整的数据库初始化流程：
 * 1. 检查浏览器 IDB 可用性
 * 2. 创建/打开 treasurebox 数据库
 * 3. 执行所有迁移
 * 4. 清理过期缓存
 * 5. 监听存储配额变化
 */

import {
  initializeDB,
  checkQuota,
  shouldRequestPersistent,
  requestPersistentStorage,
  healthCheck,
} from './idb-core';
import {
  performFullCleanup,
  startPeriodicCleanup,
} from './cleanup';
import { getStorageMetrics } from './storage-monitor';

export interface InitHookOptions {
  enablePeriodicCleanup?: boolean;
  cleanupIntervalMs?: number;
  requestPersistentStorage?: boolean;
  onProgressUpdate?: (stage: string, detail?: any) => void;
}

let initializationInProgress = false;
let initializationPromise: Promise<void> | null = null;

/**
 * 应用启动时调用的主初始化函数。
 * 返回 Promise，失败时应继续运行（降级到只读模式）。
 */
export async function initializeStorageOnApp(
  options?: InitHookOptions
): Promise<void> {
  // 防止多次初始化
  if (initializationPromise) {
    return initializationPromise;
  }

  if (initializationInProgress) {
    throw new Error('[InitHook] Initialization already in progress');
  }

  initializationInProgress = true;
  const notify = options?.onProgressUpdate;

  initializationPromise = (async () => {
    try {
      // 阶段 1: 环境检查
      notify?.('environment-check', { browser: typeof window !== 'undefined' });

      if (typeof window === 'undefined') {
        console.log('[InitHook] Running in non-browser environment, skipping IDB init');
        return;
      }

      if (!window.indexedDB) {
        console.warn('[InitHook] IndexedDB not supported, app will run in localStorage-only mode');
        return;
      }

      // 阶段 2: 数据库初始化
      notify?.('database-init-start');
      try {
        await initializeDB();
        notify?.('database-init-complete');
        console.log('[InitHook] Database initialized successfully');
      } catch (error) {
        console.error('[InitHook] Database initialization failed:', error);
        notify?.('database-init-error', error);
        // 继续：降级到只读模式
        return;
      }

      // 阶段 3: 健康检查
      notify?.('health-check-start');
      try {
        const isHealthy = await healthCheck();
        if (!isHealthy) {
          console.warn('[InitHook] Health check failed, but continuing');
          notify?.('health-check-warning');
        } else {
          notify?.('health-check-passed');
        }
      } catch (error) {
        console.warn('[InitHook] Health check threw error:', error);
        notify?.('health-check-error', error);
      }

      // 阶段 4: 可选持久化存储请求
      if (options?.requestPersistentStorage) {
        notify?.('persistent-storage-request-start');
        try {
          const shouldRequest = await shouldRequestPersistent();
          if (shouldRequest) {
            await requestPersistentStorage();
            notify?.('persistent-storage-granted');
            console.log('[InitHook] Persistent storage requested successfully');
          } else {
            notify?.('persistent-storage-not-needed');
          }
        } catch (error) {
          console.warn('[InitHook] Persistent storage request failed:', error);
          notify?.('persistent-storage-error', error);
        }
      }

      // 阶段 5: 检查配额
      notify?.('quota-check-start');
      try {
        const quota = await checkQuota();
        notify?.('quota-check-complete', quota);
        if (quota) {
          console.log('[InitHook] Storage quota:', {
            usage: `${(quota.usage / (1024 * 1024)).toFixed(2)} MB`,
            quota: `${(quota.quota / (1024 * 1024)).toFixed(2)} MB`,
            percent: `${Math.round((quota.usage / quota.quota) * 100)}%`,
          });
        } else {
          console.warn('[InitHook] Storage quota not available');
        }
      } catch (error) {
        console.warn('[InitHook] Quota check failed:', error);
        notify?.('quota-check-error', error);
      }

      // 阶段 6: 首次全量清理
      notify?.('cleanup-start');
      try {
        await performFullCleanup();
        notify?.('cleanup-complete');
        console.log('[InitHook] Full cleanup completed');
      } catch (error) {
        console.warn('[InitHook] Full cleanup failed:', error);
        notify?.('cleanup-error', error);
      }

      // 阶段 7: 可选定期清理启动
      if (options?.enablePeriodicCleanup !== false) {
        const interval = options?.cleanupIntervalMs ?? 5 * 60 * 1000; // 默认 5 分钟
        notify?.('periodic-cleanup-start', { intervalMs: interval });
        try {
          startPeriodicCleanup(interval);
          console.log(`[InitHook] Periodic cleanup started (every ${interval}ms)`);
        } catch (error) {
          console.warn('[InitHook] Failed to start periodic cleanup:', error);
          notify?.('periodic-cleanup-error', error);
        }
      }

      // 阶段 8: 监听存储配额变化（通过 StorageManager API）
      notify?.('quota-listener-setup');
      try {
        setupStorageQuotaListener();
        console.log('[InitHook] Storage quota listener set up');
      } catch (error) {
        console.warn('[InitHook] Failed to set up quota listener:', error);
        notify?.('quota-listener-error', error);
      }

      notify?.('initialization-complete');
      console.log('[InitHook] Storage initialization complete');
    } catch (error) {
      console.error('[InitHook] Unexpected error during initialization:', error);
      notify?.('initialization-fatal-error', error);
      throw error;
    } finally {
      initializationInProgress = false;
    }
  })();

  return initializationPromise;
}

/**
 * 监听存储配额变化，如果超过阈值则显示警告。
 * 仅支持 StorageManager API 的浏览器。
 */
function setupStorageQuotaListener(): void {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    console.warn('[InitHook] StorageManager API not available');
    return;
  }

  // 定期检查配额（每分钟）
  const checkInterval = setInterval(async () => {
    try {
      const metrics = await getStorageMetrics();
      if (metrics.isDanger) {
        console.warn('[InitHook] Storage quota exceeded 90%:', metrics);
        // 触发警告事件（由 StorageWarningCard 监听）
        const event = new CustomEvent('nesio-storage-danger', {
          detail: metrics,
        });
        window.dispatchEvent(event);
      } else if (metrics.localStorage > 80) {
        console.warn('[InitHook] localStorage usage high:', metrics);
        const event = new CustomEvent('nesio-storage-warning', {
          detail: metrics,
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.warn('[InitHook] Error checking storage metrics:', error);
    }
  }, 60_000); // 每 1 分钟检查一次

  // 页面卸载时清理
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => clearInterval(checkInterval));
  }
}

/**
 * 重置初始化状态（用于测试或手动重新初始化）。
 */
export function resetInitializationState(): void {
  initializationInProgress = false;
  initializationPromise = null;
}
