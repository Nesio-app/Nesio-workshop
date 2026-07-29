/**
 * sync-queue-engine.ts — 云同步队列引擎
 *
 * 管理待同步缓存项。如果 IDB 满载，自动降级到 localStorage outbox。
 * 支持查询同步队列状态、获取统计信息等。
 */

import { initializeDB, getStore } from './idb-core';

export interface SyncQueueEntry {
  id: string;
  key: string; // 原始 localStorage 键
  category: string;
  data: any;
  status: 'pending' | 'syncing' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  error?: string;
}

const OUTBOX_PREFIX = '__outbox:';
const MAX_IDB_ITEMS = 10000; // IDB 中最多允许的项数
const MAX_ATTEMPTS = 3;

/**
 * 将待同步项添加到同步队列。
 * 如果 IDB 项数接近上限，自动降级到 localStorage outbox。
 *
 * @param key 原始缓存键
 * @param category 缓存类别
 * @param data 要同步的数据
 * @returns 队列项 ID
 */
export async function enqueueSyncItem(
  key: string,
  category: string,
  data: any
): Promise<string> {
  try {
    const db = await initializeDB();
    const now = Date.now();
    const queueId = `${key}:${now}:${Math.random().toString(36).slice(2)}`;

    const queueEntry: SyncQueueEntry = {
      id: queueId,
      key,
      category,
      data,
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      createdAt: now,
    };

    // 检查 IDB 项数是否接近上限
    const itemCount = await getIDBQueueItemCount(db);

    if (itemCount >= MAX_IDB_ITEMS * 0.9) {
      // IDB 满载，降级到 localStorage outbox
      console.warn(
        `[SyncQueueEngine] IDB queue full (${itemCount}/${MAX_IDB_ITEMS}), falling back to localStorage`
      );
      const outboxKey = `${OUTBOX_PREFIX}${queueId}`;
      localStorage.setItem(outboxKey, JSON.stringify(queueEntry));
      console.log(`[SyncQueueEngine] Enqueued to outbox: ${outboxKey}`);
      return queueId;
    }

    // IDB 还有空间，使用 sync-queue 表
    const store = getStore(db, 'sync-queue', 'readwrite');

    await new Promise<void>((resolve, reject) => {
      const request = store.add(queueEntry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[SyncQueueEngine] Enqueued to IDB: ${queueId}`);
    return queueId;
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to enqueue item:', error);
    throw error;
  }
}

/**
 * 从同步队列取出一项（标记为 syncing）。
 *
 * @param queueId 队列项 ID
 * @returns 队列项内容
 */
export async function dequeueSyncItem(queueId: string): Promise<SyncQueueEntry | null> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const getRequest = store.get(queueId);

    return new Promise((resolve) => {
      getRequest.onsuccess = () => {
        const item = getRequest.result as SyncQueueEntry | undefined;

        if (item) {
          // 标记为 syncing
          item.status = 'syncing';
          item.lastAttemptAt = Date.now();
          item.attempts++;

          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => resolve(item);
          updateRequest.onerror = () => resolve(item); // 即使更新失败也返回
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => resolve(null);
    });
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to dequeue item:', error);
    return null;
  }
}

/**
 * 标记队列项为已同步。
 *
 * @param queueId 队列项 ID
 */
export async function markSyncItemSucceeded(queueId: string): Promise<boolean> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const getRequest = store.get(queueId);

    return new Promise((resolve) => {
      getRequest.onsuccess = () => {
        const item = getRequest.result as SyncQueueEntry | undefined;

        if (item) {
          item.status = 'succeeded';
          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => resolve(true);
          updateRequest.onerror = () => resolve(false);
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to mark item succeeded:', error);
    return false;
  }
}

/**
 * 标记队列项为失败。
 *
 * @param queueId 队列项 ID
 * @param error 错误信息
 */
export async function markSyncItemFailed(queueId: string, error: string): Promise<boolean> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const getRequest = store.get(queueId);

    return new Promise((resolve) => {
      getRequest.onsuccess = () => {
        const item = getRequest.result as SyncQueueEntry | undefined;

        if (item) {
          if (item.attempts >= item.maxAttempts) {
            item.status = 'failed';
          }
          item.error = error;

          // 计算下次重试时间（指数退避）
          const delay = 1000 * Math.pow(2, Math.max(0, item.attempts - 1));
          item.nextRetryAt = Date.now() + delay;

          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => resolve(true);
          updateRequest.onerror = () => resolve(false);
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to mark item failed:', error);
    return false;
  }
}

/**
 * 获取同步队列的统计信息。
 */
export async function getSyncQueueStats(): Promise<{
  idbPendingCount: number;
  idbSyncingCount: number;
  idbFailedCount: number;
  idbSucceededCount: number;
  idbTotalCount: number;
  outboxCount: number;
  allPendingCount: number; // 等待重试的失败项
  estimatedSize: number;
}> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readonly');

    const getAllRequest = store.getAll();

    const idbStats = await new Promise<{
      pending: number;
      syncing: number;
      failed: number;
      succeeded: number;
    }>((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as SyncQueueEntry[];
        const stats = {
          pending: items.filter((item) => item.status === 'pending').length,
          syncing: items.filter((item) => item.status === 'syncing').length,
          failed: items.filter((item) => item.status === 'failed').length,
          succeeded: items.filter((item) => item.status === 'succeeded').length,
        };
        resolve(stats);
      };
      getAllRequest.onerror = () => resolve({ pending: 0, syncing: 0, failed: 0, succeeded: 0 });
    });

    // 计算 outbox 项数
    let outboxCount = 0;
    let estimatedSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(OUTBOX_PREFIX)) {
        outboxCount++;
        const data = localStorage.getItem(key);
        if (data) {
          estimatedSize += new TextEncoder().encode(data).length;
        }
      }
    }

    const idbTotalCount =
      idbStats.pending + idbStats.syncing + idbStats.failed + idbStats.succeeded;
    const allPendingCount = idbStats.pending + idbStats.failed;

    return {
      idbPendingCount: idbStats.pending,
      idbSyncingCount: idbStats.syncing,
      idbFailedCount: idbStats.failed,
      idbSucceededCount: idbStats.succeeded,
      idbTotalCount,
      outboxCount,
      allPendingCount,
      estimatedSize,
    };
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to get stats:', error);
    return {
      idbPendingCount: 0,
      idbSyncingCount: 0,
      idbFailedCount: 0,
      idbSucceededCount: 0,
      idbTotalCount: 0,
      outboxCount: 0,
      allPendingCount: 0,
      estimatedSize: 0,
    };
  }
}

/**
 * 获取 IDB 中的队列项总数。
 */
async function getIDBQueueItemCount(db: IDBDatabase): Promise<number> {
  return new Promise((resolve) => {
    try {
      const store = getStore(db, 'sync-queue', 'readonly');
      const countRequest = store.count();

      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => resolve(0);
    } catch (error) {
      console.error('[SyncQueueEngine] Failed to count IDB items:', error);
      resolve(0);
    }
  });
}

/**
 * 获取所有待重试的项（状态为 pending 或 failed）。
 * 返回那些 nextRetryAt <= now 的项。
 */
export async function getPendingRetryItems(): Promise<SyncQueueEntry[]> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readonly');

    const getAllRequest = store.getAll();

    return new Promise((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as SyncQueueEntry[];
        const now = Date.now();
        const retryItems = items.filter((item) => {
          if (item.status === 'pending') return true;
          if (item.status === 'failed' && item.nextRetryAt && item.nextRetryAt <= now) {
            return true;
          }
          return false;
        });
        resolve(retryItems);
      };

      getAllRequest.onerror = () => resolve([]);
    });
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to get pending items:', error);
    return [];
  }
}

/**
 * 清理已同步的项（从 7 天前）。
 */
export async function cleanupSucceededItems(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'sync-queue', 'readwrite');

    const getAllRequest = store.getAll();

    return new Promise((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as SyncQueueEntry[];
        const now = Date.now();
        let deleted = 0;

        for (const item of items) {
          if (item.status === 'succeeded' && now - item.createdAt > olderThanMs) {
            const deleteRequest = store.delete(item.id);
            deleteRequest.onsuccess = () => deleted++;
          }
        }

        console.log(`[SyncQueueEngine] Cleaned up ${deleted} old succeeded items`);
        resolve(deleted);
      };

      getAllRequest.onerror = () => resolve(0);
    });
  } catch (error) {
    console.error('[SyncQueueEngine] Failed to cleanup:', error);
    return 0;
  }
}
