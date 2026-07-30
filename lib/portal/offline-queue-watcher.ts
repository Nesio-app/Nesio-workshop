/**
 * Phase 2 离线队列监控 —— 自动重试 + 用户可见状态
 *
 * 职责：
 * - 监听队列变化（新增项、重试成功/失败）
 * - 网络恢复时自动触发重试
 * - 提供队列统计给 OfflineIndicator 显示
 * - 暴露订阅接口给监控面板
 */

import {
  getRetryQueue,
  getQueueStats,
  removeFromRetryQueue,
  retryQueueItem,
  cleanupExpiredBackups,
  type RetryQueueItem,
} from './data-protection-layer';
import { logDropped } from './storage-health';

export interface QueueStats {
  count: number;
  totalBytes: number;
  oldestCreatedAt: number | null;
  highPriorityCount: number;
  isOnline: boolean;
}

const QUEUE_STATS_EVENT = 'nesio-queue-stats-changed';
const AUTO_RETRY_INTERVAL = 30_000; // 30 秒重试一次

let queueWatcherInitialized = false;
let autoRetryTimerId: NodeJS.Timeout | null = null;
let currentStats: QueueStats | null = null;

/**
 * 初始化离线队列监控（应在 Portal 挂载时调用）
 */
export function initializeQueueWatcher(): void {
  if (typeof window === 'undefined' || queueWatcherInitialized) return;

  queueWatcherInitialized = true;

  // 监听网络变化
  window.addEventListener('online', () => {
    logDropped('queue-watcher:online-detected');
    triggerAutoRetry();
  });
  window.addEventListener('offline', () => {
    logDropped('queue-watcher:offline-detected');
    updateQueueStats();
  });

  // 监听队列变化事件
  window.addEventListener('nesio-retry-queue-changed', () => {
    updateQueueStats();
  });

  // 定期自动重试（即使浏览器认为在线，网络也可能不稳定）
  if (autoRetryTimerId) clearInterval(autoRetryTimerId);
  autoRetryTimerId = setInterval(() => {
    if (navigator.onLine) {
      triggerAutoRetry();
    }
  }, AUTO_RETRY_INTERVAL);

  // 初始化统计
  updateQueueStats();

  // 定期清理过期备份
  setInterval(() => {
    cleanupExpiredBackups().catch((err) => {
      logDropped('queue-watcher:cleanup-failed', err);
    });
  }, 60 * 60 * 1000); // 每小时
}

/**
 * 销毁监控（用于卸载组件时）
 */
export function destroyQueueWatcher(): void {
  if (autoRetryTimerId) {
    clearInterval(autoRetryTimerId);
    autoRetryTimerId = null;
  }
  queueWatcherInitialized = false;
}

/**
 * 更新队列统计并分发事件
 */
async function updateQueueStats(): Promise<void> {
  try {
    const stats = await getQueueStats();
    const newStats: QueueStats = {
      ...stats,
      isOnline: navigator.onLine,
    };

    // 只在改变时分发事件（避免频繁更新）
    if (JSON.stringify(currentStats) !== JSON.stringify(newStats)) {
      currentStats = newStats;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(QUEUE_STATS_EVENT, {
            detail: newStats,
          })
        );
      }
    }
  } catch (error) {
    logDropped('queue-watcher:update-stats-failed', error);
  }
}

/**
 * 获取当前队列统计（同步接口，用于组件渲染）
 */
export function getCurrentQueueStats(): QueueStats | null {
  return currentStats;
}

/**
 * 订阅队列统计变化
 *
 * @param callback 队列统计变化时调用
 * @returns 取消订阅函数
 */
export function watchQueueChanges(
  callback: (stats: QueueStats) => void
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<QueueStats>;
    callback(customEvent.detail);
  };

  window.addEventListener(QUEUE_STATS_EVENT, handler);
  return () => window.removeEventListener(QUEUE_STATS_EVENT, handler);
}

/**
 * 手动触发队列重试（由用户或自动流程触发）
 *
 * @param onProgress 重试进度回调
 * @returns 重试成功数量
 */
export async function triggerAutoRetry(
  onProgress?: (progress: { current: number; total: number }) => void
): Promise<number> {
  if (!navigator.onLine) {
    logDropped('queue-watcher:offline-skip-retry');
    return 0;
  }

  try {
    const queue = await getRetryQueue();
    if (queue.length === 0) return 0;

    let successCount = 0;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      onProgress?.({ current: i + 1, total: queue.length });

      // 简单重试逻辑：如果失败次数过多，跳过
      if (item.failCount > 5) {
        logDropped('queue-watcher:item-max-retries-exceeded', {
          id: item.id,
          failCount: item.failCount,
        });
        continue;
      }

      try {
        // 根据操作类型调用不同的处理器
        const success = await retryQueueItem(item.id, async (retryItem) => {
          return retryCloudOperation(retryItem);
        });

        if (success) {
          successCount++;
          logDropped('queue-watcher:retry-success', {
            id: item.id,
            action: item.action,
          });
        }
      } catch (error) {
        logDropped('queue-watcher:retry-failed', {
          id: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 避免过快重试导致服务器负载
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await updateQueueStats();
    return successCount;
  } catch (error) {
    logDropped('queue-watcher:auto-retry-failed', error);
    return 0;
  }
}

/**
 * 重试单个云操作（根据操作类型分发）
 */
async function retryCloudOperation(item: RetryQueueItem): Promise<any> {
  const { action, input, error } = item;

  // 这里应该根据 action 类型调用对应的云 API
  // 示例实现（实际应该改造到各个调用点）
  switch (action) {
    case 'image':
      // return retryImageAnalysis(input);
      break;
    case 'voice':
      // return retryVoiceAnalysis(input);
      break;
    case 'sync':
      // return retrySyncOperation(input);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  throw new Error(`Retry for ${action} not implemented`);
}

/**
 * 获取队列中的特定操作项
 */
export async function getQueueItemsForAction(
  action: string
): Promise<RetryQueueItem[]> {
  const queue = await getRetryQueue();
  return queue.filter((item) => item.action === action);
}

/**
 * 手动移除单个队列项（用户取消操作时）
 */
export async function cancelQueueItem(itemId: string): Promise<void> {
  try {
    await removeFromRetryQueue(itemId);
    logDropped('queue-watcher:item-canceled', { id: itemId });
  } catch (error) {
    logDropped('queue-watcher:cancel-failed', error);
  }
}

/**
 * 获取队列中最老的未完成操作（用于 UX 提示）
 */
export async function getOldestPendingItem(): Promise<RetryQueueItem | null> {
  const queue = await getRetryQueue();
  if (queue.length === 0) return null;

  queue.sort((a, b) => a.createdAt - b.createdAt);
  return queue[0] || null;
}

/**
 * 检查是否有待重试的关键操作（影响数据一致性）
 */
export async function hasCriticalPendingOps(): Promise<boolean> {
  const queue = await getRetryQueue();
  // 如果有 sync 类型的操作未完成，认为有关键操作待处理
  return queue.some((item) => item.action === 'sync' && item.priority > 0);
}
