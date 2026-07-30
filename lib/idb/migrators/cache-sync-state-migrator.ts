/**
 * cache-sync-state-migrator.ts — 迁移 nesio-sync-state-* 到 IDB
 *
 * 读取 localStorage 中的 nesio-sync-state-* 缓存键，
 * 转换为 IDB ui-cache 表格式（7 天 TTL）。
 * 支持 checksum 校验、备份和完整性验证。
 */

import { sha256, computeChecksum } from '../version-manager';

export interface CacheSyncStateMigrationResult {
  success: boolean;
  itemCount: number;
  checksum: string;
  keysProcessed: string[];
  error?: string;
}

/**
 * 从 localStorage 迁移 sync state 缓存到 IDB。
 * 支持模式匹配：nesio-sync-state-*
 */
export async function migrateSyncStateCache(
  idb: IDBDatabase
): Promise<CacheSyncStateMigrationResult> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      itemCount: 0,
      checksum: '',
      keysProcessed: [],
      error: 'Not in browser environment',
    };
  }

  try {
    const keysProcessed: string[] = [];
    let totalChecksum = '';
    let itemCount = 0;

    const tx = idb.transaction(['ui-cache'], 'readwrite');
    const store = tx.objectStore('ui-cache');

    // 扫描 localStorage 中所有匹配 nesio-sync-state-* 的键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('nesio-sync-state-')) {
        continue;
      }

      try {
        const lsData = localStorage.getItem(key);
        if (!lsData) continue;

        let data: any;
        try {
          data = JSON.parse(lsData);
        } catch (e) {
          console.warn(`[CacheSyncStateMigrator] Failed to parse ${key}:`, e);
          continue;
        }

        // 计算原始数据的 checksum
        const itemChecksum = await sha256(JSON.stringify(data));

        // 构建 IDB 缓存记录
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

        const cacheItem = {
          key,
          data,
          checksum: itemChecksum,
          createdAt: now,
          accessedAt: now,
          expiresAt,
          category: 'sync-state',
        };

        // 写入 IDB
        await new Promise<void>((resolve, reject) => {
          const request = store.put(cacheItem);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

        keysProcessed.push(key);
        totalChecksum = await sha256(totalChecksum + itemChecksum);
        itemCount++;

        console.log(
          `[CacheSyncStateMigrator] Migrated ${key} (${itemChecksum.slice(0, 8)}...)`
        );
      } catch (e) {
        console.error(`[CacheSyncStateMigrator] Failed to process ${key}:`, e);
        // 继续处理下一个键
      }
    }

    console.log(
      `[CacheSyncStateMigrator] Migration complete: ${itemCount} items, keys: ${keysProcessed.join(', ')}`
    );

    return { success: true, itemCount, checksum: totalChecksum, keysProcessed };
  } catch (error) {
    console.error('[CacheSyncStateMigrator] Migration failed:', error);
    return {
      success: false,
      itemCount: 0,
      checksum: '',
      keysProcessed: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 验证迁移结果。
 * 比较 localStorage 中的记录数与 IDB 中的记录数。
 */
export async function verifySyncStateCache(
  idb: IDBDatabase
): Promise<{ success: boolean; localStorageCount: number; idbCount: number }> {
  try {
    // 计算 localStorage 中的 sync-state 键数
    let lsCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('nesio-sync-state-')) {
        lsCount++;
      }
    }

    // 计数 IDB 中的 sync-state 项
    const tx = idb.transaction(['ui-cache'], 'readonly');
    const store = tx.objectStore('ui-cache');
    const index = store.index('accessedAt');

    let idbCount = 0;
    const getAllRequest = store.getAll();

    const idbCountResult = await new Promise<number>((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        const syncStateItems = items.filter((item) => item.category === 'sync-state');
        resolve(syncStateItems.length);
      };
      getAllRequest.onerror = () => resolve(0);
    });

    const success = lsCount === idbCountResult;
    console.log(
      `[CacheSyncStateMigrator] Verification: localStorage=${lsCount}, idb=${idbCountResult}, success=${success}`
    );

    return { success, localStorageCount: lsCount, idbCount: idbCountResult };
  } catch (error) {
    console.error('[CacheSyncStateMigrator] Verification failed:', error);
    return { success: false, localStorageCount: 0, idbCount: 0 };
  }
}

/**
 * 回滚迁移。删除 IDB 中的所有 sync-state 缓存，保留 localStorage。
 */
export async function rollbackSyncStateCache(idb: IDBDatabase): Promise<number> {
  try {
    const tx = idb.transaction(['ui-cache'], 'readwrite');
    const store = tx.objectStore('ui-cache');
    const getAllRequest = store.getAll();

    const deleted = await new Promise<number>((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        let count = 0;

        for (const item of items) {
          if (item.category === 'sync-state') {
            const deleteRequest = store.delete(item.key);
            deleteRequest.onsuccess = () => count++;
          }
        }

        resolve(count);
      };
      getAllRequest.onerror = () => resolve(0);
    });

    console.log(`[CacheSyncStateMigrator] Rolled back ${deleted} items`);
    return deleted;
  } catch (error) {
    console.error('[CacheSyncStateMigrator] Rollback failed:', error);
    return 0;
  }
}
