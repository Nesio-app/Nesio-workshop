/**
 * offline-queue.ts — 待同步队列管理
 *
 * 在 IDB sync-queue 表中存储待同步项。
 * 支持 enqueue / dequeue / retryFailed，最多 3 次重试，指数退避。
 * 提供离线可用时间长度估算。
 */

import { initializeDB, getStore, StoreName } from './idb-core';

export type SyncStatus = 'pending' | 'retrying' | 'failed' | 'succeeded';

export interface SyncQueueItem {
  id: string;
  table: StoreName;
  action: 'create' | 'update' | 'delete';
  data: any;
  status: SyncStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  error?: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * 生成队列项的唯一 ID。
 */
function generateQueueId(table: StoreName, dataId: string): string {
  return `${table}:${dataId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/**
 * 计算指数退避延迟（毫秒）。
 * delay = 1s * 2^(attempt - 1)，最大 30 秒
 */
function getRetryDelay(attempt: number): number {
  const baseDelay = 1000; // 1 秒
  const maxDelay = 30 * 1000; // 30 秒
  const delay = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, maxDelay);
}

/**
 * 将操作加入待同步队列。
 *
 * @param table 目标存储表
 * @param action 操作类型
 * @param data 数据对象（必须有 id 字段）
 * @param maxAttempts 最大重试次数（默认 3）
 * @returns 队列项 ID
 */
export async function enqueue(
  table: StoreName,
  action: 'create' | 'update' | 'delete',
  data: any,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<string> {
  if (!data || !data.id) {
    throw new Error('[OfflineQueue] Data must have an id field');
  }

  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const now = Date.now();
    const queueId = generateQueueId(table, data.id);
    const queueItem: SyncQueueItem = {
      id: queueId,
      table,
      action,
      data,
      status: 'pending',
      attempts: 0,
      maxAttempts,
      createdAt: now,
      expiresAt: now + RETENTION_MS,
    };

    const putRequest = store.put(queueItem);

    return new Promise((resolve, reject) => {
      putRequest.onsuccess = () => {
        console.log(`[OfflineQueue] Item enqueued: ${queueId}`);
        resolve(queueId);
      };
      putRequest.onerror = () => {
        console.error('[OfflineQueue] Failed to enqueue item:', putRequest.error);
        reject(putRequest.error);
      };
    });
  } catch (error) {
    console.error('[OfflineQueue] Enqueue failed:', error);
    throw error;
  }
}

/**
 * 批量加入队列。
 */
export async function enqueueBatch(
  items: Array<{
    table: StoreName;
    action: 'create' | 'update' | 'delete';
    data: any;
  }>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<string[]> {
  return Promise.all(
    items.map(({ table, action, data }) => enqueue(table, action, data, maxAttempts))
  );
}

/**
 * 从队列中取出一个待同步项。
 * 优先取最早加入的 'pending' 项。
 */
export async function dequeue(): Promise<SyncQueueItem | null> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    // 查询 pending 状态的项，按 createdAt 排序
    const index = store.index('status');
    const range = IDBKeyRange.only('pending');
    const request = index.getAll(range);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const items = request.result as SyncQueueItem[];
        if (items.length === 0) {
          resolve(null);
          return;
        }

        // 按 createdAt 排序，取最早的
        items.sort((a, b) => a.createdAt - b.createdAt);
        const item = items[0];

        // 更新项的状态为 'retrying'
        item.status = 'retrying';
        item.attempts = (item.attempts || 0) + 1;
        item.lastAttemptAt = Date.now();

        const updateRequest = store.put(item);
        updateRequest.onsuccess = () => {
          console.log(`[OfflineQueue] Item dequeued: ${item.id}, attempt ${item.attempts}`);
          resolve(item);
        };
        updateRequest.onerror = () => {
          reject(updateRequest.error);
        };
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[OfflineQueue] Dequeue failed:', error);
    throw error;
  }
}

/**
 * 标记一个队列项为成功。
 * 从队列中删除该项。
 */
export async function markSuccess(queueId: string): Promise<void> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const deleteRequest = store.delete(queueId);

    return new Promise((resolve, reject) => {
      deleteRequest.onsuccess = () => {
        console.log(`[OfflineQueue] Item marked succeeded: ${queueId}`);
        resolve();
      };
      deleteRequest.onerror = () => {
        reject(deleteRequest.error);
      };
    });
  } catch (error) {
    console.error('[OfflineQueue] Failed to mark success:', error);
    throw error;
  }
}

/**
 * 标记一个队列项为失败（暂时或永久）。
 * 如果还有重试机会，计算下次重试时间。
 * 如果用尽所有重试，标记为 'failed'。
 */
export async function markFailure(queueId: string, error?: string): Promise<boolean> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const getRequest = store.get(queueId);

    return new Promise((resolve, reject) => {
      getRequest.onsuccess = () => {
        const item = getRequest.result as SyncQueueItem | undefined;
        if (!item) {
          console.warn(`[OfflineQueue] Item not found: ${queueId}`);
          resolve(false);
          return;
        }

        item.error = error;
        item.status = 'retrying';

        if (item.attempts >= item.maxAttempts) {
          // 用尽重试次数
          item.status = 'failed';
          console.error(`[OfflineQueue] Item marked failed after ${item.attempts} attempts:`, {
            id: queueId,
            error,
          });
        } else {
          // 计算下次重试时间
          const delay = getRetryDelay(item.attempts);
          item.nextRetryAt = Date.now() + delay;
          console.warn(`[OfflineQueue] Item will retry in ${delay}ms:`, { id: queueId });
        }

        const updateRequest = store.put(item);
        updateRequest.onsuccess = () => {
          resolve(item.status === 'failed');
        };
        updateRequest.onerror = () => {
          reject(updateRequest.error);
        };
      };
      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  } catch (error) {
    console.error('[OfflineQueue] Failed to mark failure:', error);
    throw error;
  }
}

/**
 * 重试所有失败的项。
 * 返回重试的项数。
 */
export async function retryFailed(): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    // 查询所有 'retrying' 或 'failed' 项
    const index = store.index('status');
    const reqs: Promise<number>[] = [];

    // 获取 retrying 项
    const reqs1 = new Promise<Array<SyncQueueItem>>((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only('retrying'));
      request.onsuccess = () => resolve(request.result as SyncQueueItem[]);
      request.onerror = () => reject(request.error);
    });

    const items = await reqs1;
    let retried = 0;

    // 遍历 nextRetryAt 已到期的项，重置为 pending
    const now = Date.now();
    for (const item of items) {
      if (!item.nextRetryAt || item.nextRetryAt <= now) {
        if (item.attempts < item.maxAttempts) {
          item.status = 'pending';
          item.nextRetryAt = undefined;

          await new Promise<void>((resolve, reject) => {
            const updateRequest = store.put(item);
            updateRequest.onsuccess = () => {
              retried++;
              resolve();
            };
            updateRequest.onerror = () => reject(updateRequest.error);
          });
        }
      }
    }

    console.log(`[OfflineQueue] Retried ${retried} items`);
    return retried;
  } catch (error) {
    console.error('[OfflineQueue] Retry failed:', error);
    return 0;
  }
}

/**
 * 获取队列中所有待同步项（按状态分类）。
 */
export async function getQueueStats(): Promise<{
  total: number;
  pending: number;
  retrying: number;
  failed: number;
  succeeded: number;
}> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readonly');

    const allRequest = store.getAll();

    return new Promise((resolve, reject) => {
      allRequest.onsuccess = () => {
        const items = allRequest.result as SyncQueueItem[];
        const stats = {
          total: items.length,
          pending: items.filter(i => i.status === 'pending').length,
          retrying: items.filter(i => i.status === 'retrying').length,
          failed: items.filter(i => i.status === 'failed').length,
          succeeded: items.filter(i => i.status === 'succeeded').length,
        };
        resolve(stats);
      };
      allRequest.onerror = () => reject(allRequest.error);
    });
  } catch (error) {
    console.error('[OfflineQueue] Failed to get stats:', error);
    return { total: 0, pending: 0, retrying: 0, failed: 0, succeeded: 0 };
  }
}

/**
 * 估算离线可用时间。
 * 基于队列大小和存储大小。
 * 返回秒数。
 */
export async function estimateOfflineCapacity(): Promise<number> {
  try {
    const stats = await getQueueStats();
    const itemCount = stats.total;

    // 粗略估计：每个队列项约 1KB
    // IDB 容量通常为 50MB
    // 保守估计可用项数：40000
    const maxItemsEstimate = 40000;
    const remainingCapacity = Math.max(0, maxItemsEstimate - itemCount);

    // 假设平均每天生成 100 个队列项
    const itemsPerDay = 100;
    const daysOffline = remainingCapacity / itemsPerDay;

    // 转换为秒
    return daysOffline * 24 * 60 * 60;
  } catch (error) {
    console.error('[OfflineQueue] Failed to estimate offline capacity:', error);
    return 0;
  }
}

/**
 * 清除过期的队列项（> 7 天）。
 * 返回删除的项数。
 */
export async function cleanupExpired(): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const allRequest = store.getAll();

    return new Promise((resolve, reject) => {
      allRequest.onsuccess = () => {
        const items = allRequest.result as SyncQueueItem[];
        const now = Date.now();
        let deleted = 0;

        for (const item of items) {
          if (item.expiresAt && item.expiresAt < now) {
            const deleteRequest = store.delete(item.id);
            deleteRequest.onsuccess = () => {
              deleted++;
            };
            deleteRequest.onerror = () => {
              console.error('[OfflineQueue] Failed to delete expired item:', item.id);
            };
          }
        }

        console.log(`[OfflineQueue] Cleaned up ${deleted} expired items`);
        resolve(deleted);
      };
      allRequest.onerror = () => reject(allRequest.error);
    });
  } catch (error) {
    console.error('[OfflineQueue] Cleanup failed:', error);
    return 0;
  }
}
