/**
 * Phase 2 数据保护层 —— 离线队列 + 本地备份 + 重试管理
 *
 * 设计目标：零数据丢失原则
 * - 所有本地操作都先写 localStorage，确认成功后删除
 * - 网络请求失败自动保存到本地队列（待重试）
 * - 离线状态明确标记，用户可见
 *
 * 三层保护：
 * 1. localStorage — 实时备份（快速恢复）
 * 2. IndexedDB — 大数据持久化（photos, recordings, vectors）
 * 3. 离线队列 — 待重试的操作（自动恢复）
 */

import { logDropped } from './storage-health';

const BACKUP_PREFIX = 'phase2-backup-';
const QUEUE_PREFIX = 'phase2-retry-queue-';
const QUEUE_INDEX_KEY = 'phase2-queue-index';
const IDB_NAME = 'nesio-phase2-data';
const IDB_VERSION = 1;

export interface RetryQueueItem {
  id: string;
  action: string;
  input: any;
  error: string;
  createdAt: number;
  failCount: number;
  lastFailedAt: number;
  priority: number; // 0=normal, 1=high
}

export interface BackupItem {
  id: string;
  key: string;
  data: any;
  createdAt: number;
}

/**
 * 打开 IndexedDB 连接
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // 创建存储空间
      if (!db.objectStoreNames.contains('phase2-queue')) {
        db.createObjectStore('phase2-queue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('vectors')) {
        db.createObjectStore('vectors', { keyPath: 'id' });
      }
    };
  });
}

/**
 * 保存到 localStorage 作备份（快速恢复，但容量有限）
 *
 * @param key 备份键
 * @param data 数据
 * @returns 备份项 ID（用于后续清除）
 */
export async function saveToLocalStorage(
  key: string,
  data: any
): Promise<string> {
  if (typeof window === 'undefined') return '';
  try {
    const id = `${BACKUP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item: BackupItem = {
      id,
      key,
      data,
      createdAt: Date.now(),
    };
    localStorage.setItem(id, JSON.stringify(item));
    return id;
  } catch (error) {
    logDropped('data-protection:save-to-local-storage', error);
    throw error;
  }
}

/**
 * 保存到 IndexedDB（大数据持久化）
 *
 * @param store IDB 存储空间名称
 * @param action 操作类型
 * @param data 数据
 * @returns IDB 键
 */
export async function saveToIDB(
  store: string,
  action: string,
  data: any
): Promise<string> {
  if (typeof indexedDB === 'undefined') {
    logDropped('data-protection:idb-not-available');
    return '';
  }

  try {
    const db = await openDB();
    const key = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = {
      id: key,
      action,
      data,
      createdAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const objStore = tx.objectStore(store);
      const req = objStore.put(item);

      tx.oncomplete = () => resolve(key);
      tx.onerror = () => {
        reject(req.error);
      };
    });
  } catch (error) {
    logDropped('data-protection:save-to-idb', error);
    throw error;
  }
}

/**
 * 标记为待重试（网络失败时调用）
 *
 * @param idbKey IDB 键（来自 saveToIDB）
 * @param error 失败的错误
 */
export async function markAsRetryNeeded(
  idbKey: string,
  error: any
): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    const queueItem: RetryQueueItem = {
      id: idbKey,
      action: idbKey.split('-')[0],
      input: null, // 实际数据已在 IDB 中
      error: errorMsg,
      createdAt: Date.now(),
      failCount: 1,
      lastFailedAt: Date.now(),
      priority: 0,
    };

    // 写入离线队列（localStorage）
    try {
      const queueKey = `${QUEUE_PREFIX}${idbKey}`;
      localStorage.setItem(queueKey, JSON.stringify(queueItem));

      // 更新队列索引
      const indexRaw = localStorage.getItem(QUEUE_INDEX_KEY) || '[]';
      const index = (JSON.parse(indexRaw) as string[]).concat([idbKey]);
      localStorage.setItem(QUEUE_INDEX_KEY, JSON.stringify(index));
    } catch (storageError) {
      logDropped('data-protection:queue-write-failed', storageError);
      // 降级：仅记录日志，不中断业务
    }

    // 分发事件（监控面板监听）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('nesio-retry-queue-changed', {
          detail: { itemId: idbKey, failCount: 1 },
        })
      );
    }
  } catch (error) {
    logDropped('data-protection:mark-retry', error);
  }
}

/**
 * 清除本地备份（成功后调用）
 *
 * @param backupKey localStorage 备份键
 */
export async function clearLocalBackup(backupKey: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (backupKey) localStorage.removeItem(backupKey);
  } catch (error) {
    logDropped('data-protection:clear-backup', error);
  }
}

/**
 * 获取待重试队列
 *
 * @returns 队列中的所有项
 */
export async function getRetryQueue(): Promise<RetryQueueItem[]> {
  if (typeof window === 'undefined') return [];

  try {
    const indexRaw = localStorage.getItem(QUEUE_INDEX_KEY) || '[]';
    const index = JSON.parse(indexRaw) as string[];

    const queue: RetryQueueItem[] = [];
    for (const itemId of index) {
      const queueKey = `${QUEUE_PREFIX}${itemId}`;
      const raw = localStorage.getItem(queueKey);
      if (raw) {
        try {
          queue.push(JSON.parse(raw) as RetryQueueItem);
        } catch {
          /* skip malformed items */
        }
      }
    }

    return queue;
  } catch (error) {
    logDropped('data-protection:get-queue', error);
    return [];
  }
}

/**
 * 获取队列统计
 */
export async function getQueueStats(): Promise<{
  count: number;
  totalBytes: number;
  oldestCreatedAt: number | null;
  highPriorityCount: number;
}> {
  const queue = await getRetryQueue();
  if (queue.length === 0) {
    return {
      count: 0,
      totalBytes: 0,
      oldestCreatedAt: null,
      highPriorityCount: 0,
    };
  }

  let totalBytes = 0;
  let oldestCreatedAt = queue[0].createdAt;
  let highPriorityCount = 0;

  for (const item of queue) {
    totalBytes += JSON.stringify(item).length;
    oldestCreatedAt = Math.min(oldestCreatedAt, item.createdAt);
    if (item.priority > 0) highPriorityCount++;
  }

  return {
    count: queue.length,
    totalBytes,
    oldestCreatedAt,
    highPriorityCount,
  };
}

/**
 * 从队列中移除项（成功重试后调用）
 *
 * @param itemId 项 ID
 */
export async function removeFromRetryQueue(itemId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const queueKey = `${QUEUE_PREFIX}${itemId}`;
    localStorage.removeItem(queueKey);

    const indexRaw = localStorage.getItem(QUEUE_INDEX_KEY) || '[]';
    const index = (JSON.parse(indexRaw) as string[]).filter((id) => id !== itemId);
    localStorage.setItem(QUEUE_INDEX_KEY, JSON.stringify(index));

    // 分发事件
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('nesio-retry-queue-changed', {
          detail: { removed: itemId },
        })
      );
    }
  } catch (error) {
    logDropped('data-protection:remove-from-queue', error);
  }
}

/**
 * 重试单个队列项（触发重试时调用）
 *
 * @param itemId 项 ID
 * @param handler 重试处理器
 */
export async function retryQueueItem(
  itemId: string,
  handler: (item: RetryQueueItem) => Promise<any>
): Promise<boolean> {
  try {
    const queueKey = `${QUEUE_PREFIX}${itemId}`;
    const raw = localStorage.getItem(queueKey);
    if (!raw) return false;

    const item = JSON.parse(raw) as RetryQueueItem;
    await handler(item);

    // 成功：移除队列
    await removeFromRetryQueue(itemId);
    return true;
  } catch (error) {
    // 失败：更新失败计数
    try {
      const queueKey = `${QUEUE_PREFIX}${itemId}`;
      const raw = localStorage.getItem(queueKey);
      if (raw) {
        const item = JSON.parse(raw) as RetryQueueItem;
        item.failCount++;
        item.lastFailedAt = Date.now();
        localStorage.setItem(queueKey, JSON.stringify(item));
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * 清理过期的备份（定期维护）
 *
 * @param maxAgeMs 最大年龄（毫秒），默认 7 天
 */
export async function cleanupExpiredBackups(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  if (typeof window === 'undefined') return 0;

  let cleaned = 0;
  try {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(BACKUP_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const item = JSON.parse(raw) as BackupItem;
          if (now - item.createdAt > maxAgeMs) {
            localStorage.removeItem(key);
            cleaned++;
          }
        } catch {
          // 移除格式错误的项
          localStorage.removeItem(key);
          cleaned++;
        }
      }
    }
  } catch (error) {
    logDropped('data-protection:cleanup', error);
  }

  return cleaned;
}
