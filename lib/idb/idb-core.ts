/**
 * idb-core.ts — IndexedDB 核心初始化和配额管理
 *
 * 单一 "treasurebox" 数据库（v1）包含五个存储表：
 * - signals: 信号/事件日志（keyPath: "id"）
 * - user_module_data: 用户模块数据（keyPath: "id"）
 * - ui-cache: UI 渲染缓存（keyPath: "key"）
 * - encrypted-secrets: 加密敏感数据（keyPath: "id"）
 * - sync-queue: 待同步队列（keyPath: "id"）
 *
 * 提供初始化、表访问、配额检查等接口。
 */

const DB_NAME = 'treasurebox';
const DB_VERSION = 1;

export type StoreName =
  | 'signals'
  | 'user_module_data'
  | 'ui-cache'
  | 'encrypted-secrets'
  | 'sync-queue';

interface StoreDef {
  name: StoreName;
  keyPath: string;
  indexes: Array<{
    name: string;
    keyPath: string;
    unique?: boolean;
  }>;
}

const STORES: StoreDef[] = [
  {
    name: 'signals',
    keyPath: 'id',
    indexes: [
      { name: 'createdAt', keyPath: 'createdAt' },
      { name: 'userId', keyPath: 'userId' },
      { name: 'table', keyPath: 'table' },
    ],
  },
  {
    name: 'user_module_data',
    keyPath: 'id',
    indexes: [
      { name: 'table', keyPath: 'table' },
      { name: 'userId', keyPath: 'userId' },
    ],
  },
  {
    name: 'ui-cache',
    keyPath: 'key',
    indexes: [
      { name: 'accessedAt', keyPath: 'accessedAt' },
      { name: 'expiresAt', keyPath: 'expiresAt' },
    ],
  },
  {
    name: 'encrypted-secrets',
    keyPath: 'id',
    indexes: [
      { name: 'category', keyPath: 'category' },
      { name: 'userId', keyPath: 'userId' },
    ],
  },
  {
    name: 'sync-queue',
    keyPath: 'id',
    indexes: [
      { name: 'createdAt', keyPath: 'createdAt' },
      { name: 'status', keyPath: 'status' },
    ],
  },
];

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * 初始化 IndexedDB 数据库。
 * 在首次调用时创建所有存储表和索引。
 * 返回 Promise<IDBDatabase>。
 */
export async function initializeDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    throw new Error('[IDB] initializeDB called in non-browser environment');
  }

  if (!window.indexedDB) {
    throw new Error('[IDB] IndexedDB not supported in this browser');
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IDB] Failed to open database:', request.error);
      dbPromise = null;
      reject(new Error(`Failed to open IDB: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      const db = request.result;
      console.log(`[IDB] Database "${DB_NAME}" opened successfully (v${DB_VERSION})`);
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const upgradeTx = (event.target as IDBOpenDBRequest).transaction;
      console.log(`[IDB] Upgrading database to v${DB_VERSION}`);

      for (const storeDef of STORES) {
        // 已存在的表:versionchange 事务里能拿到句柄(request.transaction.objectStore),
        // 只是不能再 createObjectStore —— 之前那句"不能访问"是错的,导致新增索引
        // 从没真正补上过。用已存在的句柄把缺的索引补齐(indexNames 判重,不重复建)。
        const store = db.objectStoreNames.contains(storeDef.name)
          ? upgradeTx!.objectStore(storeDef.name)
          : db.createObjectStore(storeDef.name, { keyPath: storeDef.keyPath });
        for (const index of storeDef.indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
          }
        }
      }
    };
  });

  return dbPromise;
}

/**
 * 获取单个存储表的对象存储引用。
 * 需要在事务中使用。
 */
export function getStore(
  db: IDBDatabase,
  storeName: StoreName,
  mode: 'readonly' | 'readwrite' = 'readonly'
): IDBObjectStore {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

/**
 * 批量获取多个存储表的事务。
 */
export function getTransaction(
  db: IDBDatabase,
  storeNames: StoreName[],
  mode: 'readonly' | 'readwrite' = 'readonly'
): IDBTransaction {
  return db.transaction(storeNames, mode);
}

/**
 * 检查 IDB 配额使用情况。
 * 返回 { usage: number, quota: number, percentUsed: number }
 * 或 null（如果 navigator.storage 不可用）。
 */
export async function checkQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    console.warn('[IDB] navigator.storage not available');
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      percentUsed: estimate.quota ? (estimate.usage || 0) / estimate.quota : 0,
    };
  } catch (error) {
    console.error('[IDB] Failed to check quota:', error);
    return null;
  }
}

/**
 * 判断是否应该请求持久化存储。
 * 在配额即将用尽时返回 true。
 */
export async function shouldRequestPersistent(): Promise<boolean> {
  const quota = await checkQuota();
  if (!quota) return false;
  // 当使用率超过 80% 时建议请求持久化
  return quota.percentUsed > 0.8;
}

/**
 * 请求持久化存储。
 * 返回 true 表示成功或已持久化，false 表示被拒绝。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    console.warn('[IDB] navigator.storage not available');
    return false;
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      console.log('[IDB] Storage is already persistent');
      return true;
    }

    const result = await navigator.storage.persist();
    console.log('[IDB] Persistent storage request:', result ? 'granted' : 'denied');
    return result;
  } catch (error) {
    console.error('[IDB] Failed to request persistent storage:', error);
    return false;
  }
}

/**
 * 获取 IDB 数据库大小估计（所有表的总数据量）。
 * 返回近似的字节数。
 */
export async function estimateDBSize(): Promise<number> {
  try {
    const db = await initializeDB();
    let totalSize = 0;

    // 遍历每个存储表
    for (const storeDef of STORES) {
      const store = getStore(db, storeDef.name, 'readonly');
      const countRequest = store.count();

      const count = await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });

      // 粗略估计：每条记录约 1KB
      totalSize += count * 1024;
    }

    return totalSize;
  } catch (error) {
    console.error('[IDB] Failed to estimate DB size:', error);
    return 0;
  }
}

/**
 * 清空整个数据库（适用于测试/重置场景）。
 * 谨慎使用！
 */
export async function clearDatabase(): Promise<void> {
  try {
    const db = await initializeDB();
    const tx = db.transaction(STORES.map(s => s.name), 'readwrite');

    for (const storeDef of STORES) {
      const store = tx.objectStore(storeDef.name);
      const request = store.clear();

      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[IDB] Database cleared successfully');
  } catch (error) {
    console.error('[IDB] Failed to clear database:', error);
    throw error;
  }
}

/**
 * 销毁数据库连接（用于测试/重置）。
 */
export function closeDatabase(): void {
  // IDB 不提供显式关闭，但可清除缓存
  dbPromise = null;
  console.log('[IDB] Database connection cleared');
}

/**
 * 健康检查：验证数据库是否可访问。
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readonly');
    const countRequest = store.count();

    return new Promise((resolve) => {
      countRequest.onsuccess = () => resolve(true);
      countRequest.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[IDB] Health check failed:', error);
    return false;
  }
}
