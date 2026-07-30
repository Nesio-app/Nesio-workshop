/**
 * cleanup.ts — 自动清理机制
 *
 * - TTL 清理：删除 7 天无访问的数据
 * - LRU 清理：ui-cache 超过 5MB 时删除最旧数据
 * - 过期项清理：sync-queue 中的过期项
 *
 * 可由 setInterval 定期调用。
 */

import { initializeDB, getStore, StoreName } from './idb-core';
import { cleanupExpired as cleanupExpiredQueue } from './offline-queue';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UI_CACHE_LIMIT = 5 * 1024 * 1024; // 5 MB
const UI_CACHE_CLEANUP_THRESHOLD = 4.5 * 1024 * 1024; // 4.5 MB (触发清理的阈值)

/**
 * 估算 JavaScript 对象的大小（字节）。
 * 这是一个粗略估计。
 */
function estimateObjectSize(obj: any): number {
  const json = JSON.stringify(obj);
  return new TextEncoder().encode(json).length;
}

/**
 * TTL 清理：删除超过 7 天未访问的数据。
 * 遍历 signals 和 user_module_data 表，删除 createdAt 超过 TTL 的项。
 *
 * @param table 要清理的表
 * @param ttlMs TTL 时间（毫秒，默认 7 天）
 * @returns 删除的项数
 */
export async function cleanupExpiredByTTL(
  table: StoreName,
  ttlMs = TTL_MS
): Promise<number> {
  // ui-cache 和 sync-queue 不使用 TTL（有专门的清理机制）
  if (table === 'ui-cache' || table === 'sync-queue') {
    console.warn(`[Cleanup] TTL cleanup not applicable for ${table}`);
    return 0;
  }

  try {
    const db = await initializeDB();
    const store = getStore(db, table, 'readwrite');

    // 尝试使用 createdAt 索引
    const hasCreatedAtIndex = ['signals', 'user_module_data', 'sync-queue'].includes(table);
    if (!hasCreatedAtIndex) {
      console.warn(`[Cleanup] ${table} has no createdAt index, skipping TTL cleanup`);
      return 0;
    }

    const now = Date.now();
    const cutoffTime = now - ttlMs;

    const allRequest = store.getAll();

    return new Promise((resolve, reject) => {
      allRequest.onsuccess = () => {
        const items = allRequest.result as any[];
        let deleted = 0;

        for (const item of items) {
          // 检查 createdAt 或 accessedAt 字段
          const timestamp = item.createdAt || item.accessedAt || 0;
          if (timestamp < cutoffTime) {
            const deleteRequest = store.delete(item.id || item.key);
            deleteRequest.onsuccess = () => {
              deleted++;
            };
            deleteRequest.onerror = () => {
              console.error(`[Cleanup] Failed to delete TTL-expired item:`, item.id || item.key);
            };
          }
        }

        console.log(`[Cleanup] Deleted ${deleted} TTL-expired items from ${table}`);
        resolve(deleted);
      };
      allRequest.onerror = () => {
        console.error(`[Cleanup] Failed to get all items from ${table}:`, allRequest.error);
        reject(allRequest.error);
      };
    });
  } catch (error) {
    console.error(`[Cleanup] TTL cleanup failed for ${table}:`, error);
    return 0;
  }
}

/**
 * LRU 清理（针对 ui-cache 表）。
 * 如果缓存大小超过限制，删除最旧（accessedAt 最小）的项。
 *
 * @returns 删除的项数
 */
export async function cleanupLRU(): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readwrite');

    const allRequest = store.getAll();

    return new Promise((resolve, reject) => {
      allRequest.onsuccess = () => {
        const items = allRequest.result as any[];

        // 计算总大小
        let totalSize = 0;
        const itemSizes: { key: string; size: number; accessedAt: number }[] = [];

        for (const item of items) {
          const size = estimateObjectSize(item);
          totalSize += size;
          itemSizes.push({
            key: item.key,
            size,
            accessedAt: item.accessedAt || 0,
          });
        }

        // 如果未超过阈值，不需要清理
        if (totalSize <= UI_CACHE_CLEANUP_THRESHOLD) {
          console.log(`[Cleanup] UI cache size ${totalSize}B is within limit, no LRU cleanup needed`);
          resolve(0);
          return;
        }

        console.log(
          `[Cleanup] UI cache size ${totalSize}B exceeds threshold ${UI_CACHE_CLEANUP_THRESHOLD}B, starting LRU cleanup`
        );

        // 按 accessedAt 排序（最旧的优先）
        itemSizes.sort((a, b) => a.accessedAt - b.accessedAt);

        let deleted = 0;
        let currentSize = totalSize;

        // 删除项目，直到回到安全范围
        for (const item of itemSizes) {
          if (currentSize <= UI_CACHE_LIMIT) break;

          const deleteRequest = store.delete(item.key);
          deleteRequest.onsuccess = () => {
            deleted++;
            currentSize -= item.size;
          };
          deleteRequest.onerror = () => {
            console.error(`[Cleanup] Failed to delete LRU item: ${item.key}`);
          };
        }

        console.log(
          `[Cleanup] LRU cleanup completed: deleted ${deleted} items, new size ~${currentSize}B`
        );
        resolve(deleted);
      };
      allRequest.onerror = () => {
        console.error('[Cleanup] Failed to get all UI cache items:', allRequest.error);
        reject(allRequest.error);
      };
    });
  } catch (error) {
    console.error('[Cleanup] LRU cleanup failed:', error);
    return 0;
  }
}

/**
 * 清理过期的 ui-cache 项。
 * 删除 expiresAt < now 的项。
 *
 * @returns 删除的项数
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readwrite');

    const now = Date.now();
    const allRequest = store.getAll();

    return new Promise((resolve, reject) => {
      allRequest.onsuccess = () => {
        const items = allRequest.result as any[];
        let deleted = 0;

        for (const item of items) {
          if (item.expiresAt && item.expiresAt < now) {
            const deleteRequest = store.delete(item.key);
            deleteRequest.onsuccess = () => {
              deleted++;
            };
            deleteRequest.onerror = () => {
              console.error(`[Cleanup] Failed to delete expired cache item: ${item.key}`);
            };
          }
        }

        console.log(`[Cleanup] Deleted ${deleted} expired cache items`);
        resolve(deleted);
      };
      allRequest.onerror = () => {
        console.error('[Cleanup] Failed to get all cache items:', allRequest.error);
        reject(allRequest.error);
      };
    });
  } catch (error) {
    console.error('[Cleanup] Expired cache cleanup failed:', error);
    return 0;
  }
}

/**
 * 执行完整的数据库清理流程。
 * 包括：
 * 1. 清理过期的 ui-cache 项
 * 2. LRU 清理（ui-cache）
 * 3. TTL 清理（signals, user_module_data）
 * 4. 清理过期的 sync-queue 项
 *
 * @returns 清理统计信息
 */
export async function performFullCleanup(): Promise<{
  expiredCacheDeleted: number;
  lruDeleted: number;
  signalsTTLDeleted: number;
  moduleDataTTLDeleted: number;
  queueExpiredDeleted: number;
  totalDeleted: number;
}> {
  console.log('[Cleanup] Starting full cleanup process...');

  try {
    const [
      expiredCacheDeleted,
      lruDeleted,
      signalsTTLDeleted,
      moduleDataTTLDeleted,
      queueExpiredDeleted,
    ] = await Promise.all([
      cleanupExpiredCache(),
      cleanupLRU(),
      cleanupExpiredByTTL('signals'),
      cleanupExpiredByTTL('user_module_data'),
      cleanupExpiredQueue(),
    ]);

    const stats = {
      expiredCacheDeleted,
      lruDeleted,
      signalsTTLDeleted,
      moduleDataTTLDeleted,
      queueExpiredDeleted,
      totalDeleted:
        expiredCacheDeleted +
        lruDeleted +
        signalsTTLDeleted +
        moduleDataTTLDeleted +
        queueExpiredDeleted,
    };

    console.log('[Cleanup] Full cleanup completed:', stats);
    return stats;
  } catch (error) {
    console.error('[Cleanup] Full cleanup failed:', error);
    return {
      expiredCacheDeleted: 0,
      lruDeleted: 0,
      signalsTTLDeleted: 0,
      moduleDataTTLDeleted: 0,
      queueExpiredDeleted: 0,
      totalDeleted: 0,
    };
  }
}

/**
 * 启动定期清理任务。
 * 默认每 6 小时运行一次。
 *
 * @param intervalMs 清理间隔（毫秒，默认 6 小时）
 * @returns 清理任务的 interval ID
 */
export function startPeriodicCleanup(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  if (typeof window === 'undefined') {
    console.warn('[Cleanup] Periodic cleanup not available in non-browser environment');
    return null as any;
  }

  const intervalId = setInterval(async () => {
    try {
      await performFullCleanup();
    } catch (error) {
      console.error('[Cleanup] Periodic cleanup task failed:', error);
    }
  }, intervalMs);

  console.log(
    `[Cleanup] Periodic cleanup started (interval: ${intervalMs}ms = ${(intervalMs / (60 * 60 * 1000)).toFixed(1)} hours)`
  );

  return intervalId;
}

/**
 * 停止定期清理任务。
 */
export function stopPeriodicCleanup(intervalId: NodeJS.Timeout): void {
  if (intervalId) {
    clearInterval(intervalId);
    console.log('[Cleanup] Periodic cleanup stopped');
  }
}

/**
 * 获取清理统计信息（用于监控面板）。
 */
export async function getCleanupStats(): Promise<{
  uiCacheItemCount: number;
  signalsItemCount: number;
  moduleDataItemCount: number;
  queueItemCount: number;
  estimatedTotalSize: number;
  cacheByCategory?: Record<string, number>;
}> {
  try {
    const db = await initializeDB();

    const counts = await Promise.all([
      new Promise<number>((resolve) => {
        const store = getStore(db, 'ui-cache', 'readonly');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(0);
      }),
      new Promise<number>((resolve) => {
        const store = getStore(db, 'signals', 'readonly');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(0);
      }),
      new Promise<number>((resolve) => {
        const store = getStore(db, 'user_module_data', 'readonly');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(0);
      }),
      new Promise<number>((resolve) => {
        const store = getStore(db, 'sync-queue', 'readonly');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(0);
      }),
      // 获取缓存项按类别的分布
      new Promise<Record<string, number>>((resolve) => {
        const store = getStore(db, 'ui-cache', 'readonly');
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
          const items = getAllRequest.result as any[];
          const byCategory: Record<string, number> = {};
          for (const item of items) {
            if (item.category) {
              byCategory[item.category] = (byCategory[item.category] || 0) + 1;
            }
          }
          resolve(byCategory);
        };
        getAllRequest.onerror = () => resolve({});
      }),
    ]);

    return {
      uiCacheItemCount: counts[0],
      signalsItemCount: counts[1],
      moduleDataItemCount: counts[2],
      queueItemCount: counts[3],
      estimatedTotalSize: (counts[0] + counts[1] + counts[2] + counts[3]) * 1024, // 粗略估计 1KB/item
      cacheByCategory: counts[4] as Record<string, number>,
    };
  } catch (error) {
    console.error('[Cleanup] Failed to get stats:', error);
    return {
      uiCacheItemCount: 0,
      signalsItemCount: 0,
      moduleDataItemCount: 0,
      queueItemCount: 0,
      estimatedTotalSize: 0,
      cacheByCategory: {},
    };
  }
}

/**
 * 获取 Phase 1 缓存清理统计。
 * 返回已迁移到 IDB 的缓存项统计。
 */
export async function getPhase1CleanupStats(): Promise<{
  syncStateCount: number;
  apiCacheCount: number;
  mapCacheCount: number;
  revgeoCacheCount: number;
  avatarThumbCount: number;
  tipsShownCount: number;
  onboardingCount: number;
  totalCount: number;
  totalSize: number;
}> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readonly');
    const getAllRequest = store.getAll();

    return new Promise((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        const stats = {
          syncStateCount: 0,
          apiCacheCount: 0,
          mapCacheCount: 0,
          revgeoCacheCount: 0,
          avatarThumbCount: 0,
          tipsShownCount: 0,
          onboardingCount: 0,
          totalCount: 0,
          totalSize: 0,
        };

        for (const item of items) {
          if (item.category === 'sync-state') stats.syncStateCount++;
          if (item.category === 'api-cache') stats.apiCacheCount++;
          if (item.category === 'map-cache') stats.mapCacheCount++;
          if (item.category === 'revgeo-cache') stats.revgeoCacheCount++;
          if (item.category === 'avatar-thumb') stats.avatarThumbCount++;
          if (item.category === 'tips-shown') stats.tipsShownCount++;
          if (item.category === 'onboarding') stats.onboardingCount++;

          stats.totalSize += JSON.stringify(item).length;
        }

        stats.totalCount = items.length;

        resolve(stats);
      };

      getAllRequest.onerror = () => {
        resolve({
          syncStateCount: 0,
          apiCacheCount: 0,
          mapCacheCount: 0,
          revgeoCacheCount: 0,
          avatarThumbCount: 0,
          tipsShownCount: 0,
          onboardingCount: 0,
          totalCount: 0,
          totalSize: 0,
        });
      };
    });
  } catch (error) {
    console.error('[Cleanup] Failed to get Phase 1 stats:', error);
    return {
      syncStateCount: 0,
      apiCacheCount: 0,
      mapCacheCount: 0,
      revgeoCacheCount: 0,
      avatarThumbCount: 0,
      tipsShownCount: 0,
      onboardingCount: 0,
      totalCount: 0,
      totalSize: 0,
    };
  }
}
