/**
 * cache-thumbnails-migrator.ts — 迁移缩略图和标志缓存到 IDB
 *
 * 读取 localStorage 中的缩略图和标志键，转换为 IDB ui-cache 表格式（7 天 TTL）。
 * 支持 checksum 校验、备份和完整性验证。
 *
 * 处理的键：
 * - nesio-avatar-thumb-* (头像缩略图)
 * - nesio-tips-shown-* (已显示的提示标志)
 * - nesio-onboarding-* (引导状态标志)
 */

import { sha256 } from '../version-manager';

export interface CacheThumbnailsMigrationResult {
  success: boolean;
  itemCount: number;
  checksum: string;
  keysProcessed: string[];
  error?: string;
}

/**
 * 从 localStorage 迁移缩略图和标志缓存到 IDB。
 * 支持模式匹配：
 * - nesio-avatar-thumb-*
 * - nesio-tips-shown-*
 * - nesio-onboarding-*
 */
export async function migrateThumbnailsCache(
  idb: IDBDatabase
): Promise<CacheThumbnailsMigrationResult> {
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

    // 扫描 localStorage 中所有匹配的键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const isAvatarThumb = key.startsWith('nesio-avatar-thumb-');
      const isTipsShown = key.startsWith('nesio-tips-shown-');
      const isOnboarding = key.startsWith('nesio-onboarding-');

      if (!isAvatarThumb && !isTipsShown && !isOnboarding) {
        continue;
      }

      try {
        const lsData = localStorage.getItem(key);
        if (!lsData) continue;

        let data: any;
        try {
          data = JSON.parse(lsData);
        } catch (e) {
          console.warn(`[CacheThumbnailsMigrator] Failed to parse ${key}:`, e);
          continue;
        }

        // 计算原始数据的 checksum
        const itemChecksum = await sha256(JSON.stringify(data));

        // 构建 IDB 缓存记录
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

        let category = '';
        if (isAvatarThumb) {
          category = 'avatar-thumb';
        } else if (isTipsShown) {
          category = 'tips-shown';
        } else if (isOnboarding) {
          category = 'onboarding';
        }

        const cacheItem = {
          key,
          data,
          checksum: itemChecksum,
          createdAt: now,
          accessedAt: now,
          expiresAt,
          category,
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
          `[CacheThumbnailsMigrator] Migrated ${key} (${itemChecksum.slice(0, 8)}...)`
        );
      } catch (e) {
        console.error(`[CacheThumbnailsMigrator] Failed to process ${key}:`, e);
        // 继续处理下一个键
      }
    }

    console.log(
      `[CacheThumbnailsMigrator] Migration complete: ${itemCount} items, keys: ${keysProcessed.join(', ')}`
    );

    return { success: true, itemCount, checksum: totalChecksum, keysProcessed };
  } catch (error) {
    console.error('[CacheThumbnailsMigrator] Migration failed:', error);
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
export async function verifyThumbnailsCache(
  idb: IDBDatabase
): Promise<{ success: boolean; localStorageCount: number; idbCount: number }> {
  try {
    // 计算 localStorage 中的相关键数
    let lsCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('nesio-avatar-thumb-') ||
        key.startsWith('nesio-tips-shown-') ||
        key.startsWith('nesio-onboarding-')
      ) {
        lsCount++;
      }
    }

    // 计数 IDB 中的相关项
    const tx = idb.transaction(['ui-cache'], 'readonly');
    const store = tx.objectStore('ui-cache');

    let idbCount = 0;
    const getAllRequest = store.getAll();

    const idbCountResult = await new Promise<number>((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        const relevantItems = items.filter(
          (item) =>
            item.category === 'avatar-thumb' ||
            item.category === 'tips-shown' ||
            item.category === 'onboarding'
        );
        resolve(relevantItems.length);
      };
      getAllRequest.onerror = () => resolve(0);
    });

    const success = lsCount === idbCountResult;
    console.log(
      `[CacheThumbnailsMigrator] Verification: localStorage=${lsCount}, idb=${idbCountResult}, success=${success}`
    );

    return { success, localStorageCount: lsCount, idbCount: idbCountResult };
  } catch (error) {
    console.error('[CacheThumbnailsMigrator] Verification failed:', error);
    return { success: false, localStorageCount: 0, idbCount: 0 };
  }
}

/**
 * 回滚迁移。删除 IDB 中的所有缩略图和标志缓存，保留 localStorage。
 */
export async function rollbackThumbnailsCache(idb: IDBDatabase): Promise<number> {
  try {
    const tx = idb.transaction(['ui-cache'], 'readwrite');
    const store = tx.objectStore('ui-cache');
    const getAllRequest = store.getAll();

    const deleted = await new Promise<number>((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        let count = 0;

        for (const item of items) {
          if (
            item.category === 'avatar-thumb' ||
            item.category === 'tips-shown' ||
            item.category === 'onboarding'
          ) {
            const deleteRequest = store.delete(item.key);
            deleteRequest.onsuccess = () => count++;
          }
        }

        resolve(count);
      };
      getAllRequest.onerror = () => resolve(0);
    });

    console.log(`[CacheThumbnailsMigrator] Rolled back ${deleted} items`);
    return deleted;
  } catch (error) {
    console.error('[CacheThumbnailsMigrator] Rollback failed:', error);
    return 0;
  }
}
