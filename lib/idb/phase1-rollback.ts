/**
 * phase1-rollback.ts — Phase 1 迁移一键回滚
 *
 * 支持完整回滚（清空所有迁移的 IDB 项）或单个键回滚。
 * 所有回滚操作都有详细日志。
 */

import { initializeDB, getStore } from './idb-core';
import {
  rollbackSyncStateCache,
} from './migrators/cache-sync-state-migrator';
import { rollbackMapCache } from './migrators/cache-map-migrator';
import { rollbackThumbnailsCache } from './migrators/cache-thumbnails-migrator';

export interface RollbackResult {
  success: boolean;
  itemsDeleted: number;
  categoriesRolledBack: string[];
  timestamp: number;
  log: string[];
}

/**
 * 执行完整的 Phase 1 回滚。
 * 删除 IDB ui-cache 中所有的缓存项（sync-state, api-cache, map-cache, revgeo-cache, avatar-thumb, tips-shown, onboarding）。
 *
 * @returns 回滚结果
 */
export async function rollbackPhase1(): Promise<RollbackResult> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      itemsDeleted: 0,
      categoriesRolledBack: [],
      timestamp: Date.now(),
      log: ['Error: Not in browser environment'],
    };
  }

  try {
    const log: string[] = [];
    const startTime = Date.now();

    log.push('[Phase1Rollback] Starting complete Phase 1 rollback...');
    log.push(`[Phase1Rollback] Timestamp: ${new Date(startTime).toISOString()}`);

    const db = await initializeDB();

    // 回滚各个类别
    const categoriesRolledBack: string[] = [];
    let totalDeleted = 0;

    // 1. 回滚 sync-state
    try {
      const deleted = await rollbackSyncStateCache(db);
      totalDeleted += deleted;
      categoriesRolledBack.push('sync-state');
      log.push(`[Phase1Rollback] Rolled back sync-state: ${deleted} items deleted`);
    } catch (e) {
      log.push(`[Phase1Rollback] Failed to rollback sync-state: ${e}`);
    }

    // 2. 回滚 api-cache
    // TODO: Implement rollbackApiCache from cache-sync-state-migrator
    // try {
    //   const deleted = await rollbackApiCache(db);
    //   totalDeleted += deleted;
    //   categoriesRolledBack.push('api-cache');
    //   log.push(`[Phase1Rollback] Rolled back api-cache: ${deleted} items deleted`);
    // } catch (e) {
    //   log.push(`[Phase1Rollback] Failed to rollback api-cache: ${e}`);
    // }

    // 3. 回滚 map-cache 和 revgeo-cache
    try {
      const deleted = await rollbackMapCache(db);
      totalDeleted += deleted;
      categoriesRolledBack.push('map-cache', 'revgeo-cache');
      log.push(`[Phase1Rollback] Rolled back map-cache & revgeo-cache: ${deleted} items deleted`);
    } catch (e) {
      log.push(`[Phase1Rollback] Failed to rollback map-cache: ${e}`);
    }

    // 4. 回滚 thumbnails 和标志
    try {
      const deleted = await rollbackThumbnailsCache(db);
      totalDeleted += deleted;
      categoriesRolledBack.push('avatar-thumb', 'tips-shown', 'onboarding');
      log.push(
        `[Phase1Rollback] Rolled back thumbnails & flags: ${deleted} items deleted`
      );
    } catch (e) {
      log.push(`[Phase1Rollback] Failed to rollback thumbnails: ${e}`);
    }

    const duration = Date.now() - startTime;
    log.push(
      `[Phase1Rollback] Complete: ${totalDeleted} items rolled back in ${duration}ms`
    );

    const result: RollbackResult = {
      success: true,
      itemsDeleted: totalDeleted,
      categoriesRolledBack,
      timestamp: startTime,
      log,
    };

    // 保存回滚日志到 localStorage
    saveRollbackLog(result);

    console.log('[Phase1Rollback] Rollback completed:', result);

    return result;
  } catch (error) {
    const log = [
      `[Phase1Rollback] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    ];

    const result: RollbackResult = {
      success: false,
      itemsDeleted: 0,
      categoriesRolledBack: [],
      timestamp: Date.now(),
      log,
    };

    saveRollbackLog(result);

    console.error('[Phase1Rollback] Rollback failed:', result);

    return result;
  }
}

/**
 * 回滚单个键。
 * 从 IDB ui-cache 中删除该键对应的项。
 *
 * @param key 原始 localStorage 键
 * @returns 删除的项数
 */
export async function rollbackSingleKey(key: string): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readwrite');

    const getRequest = store.get(key);

    return new Promise((resolve) => {
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          const deleteRequest = store.delete(key);
          deleteRequest.onsuccess = () => {
            console.log(`[Phase1Rollback] Rolled back single key: ${key}`);
            resolve(1);
          };
          deleteRequest.onerror = () => {
            console.error(`[Phase1Rollback] Failed to delete ${key}`);
            resolve(0);
          };
        } else {
          console.warn(`[Phase1Rollback] Key not found in IDB: ${key}`);
          resolve(0);
        }
      };

      getRequest.onerror = () => {
        console.error(`[Phase1Rollback] Failed to get key ${key}`);
        resolve(0);
      };
    });
  } catch (error) {
    console.error(`[Phase1Rollback] Failed to rollback single key ${key}:`, error);
    return 0;
  }
}

/**
 * 回滚单个类别。
 *
 * @param category 缓存类别（sync-state, api-cache 等）
 * @returns 删除的项数
 */
export async function rollbackCategory(category: string): Promise<number> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readwrite');

    const getAllRequest = store.getAll();

    return new Promise((resolve) => {
      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        let deleted = 0;

        for (const item of items) {
          if (item.category === category) {
            const deleteRequest = store.delete(item.key);
            deleteRequest.onsuccess = () => deleted++;
          }
        }

        console.log(`[Phase1Rollback] Rolled back category ${category}: ${deleted} items`);
        resolve(deleted);
      };

      getAllRequest.onerror = () => {
        console.error(`[Phase1Rollback] Failed to get items for category ${category}`);
        resolve(0);
      };
    });
  } catch (error) {
    console.error(`[Phase1Rollback] Failed to rollback category ${category}:`, error);
    return 0;
  }
}

/**
 * 获取上次回滚的日志。
 */
export function getLastRollbackLog(): RollbackResult | null {
  try {
    const logStr = localStorage.getItem('__phase1-rollback-log');
    if (!logStr) return null;
    return JSON.parse(logStr) as RollbackResult;
  } catch (error) {
    console.error('[Phase1Rollback] Failed to get last rollback log:', error);
    return null;
  }
}

/**
 * 保存回滚日志到 localStorage。
 */
function saveRollbackLog(result: RollbackResult): void {
  try {
    localStorage.setItem('__phase1-rollback-log', JSON.stringify(result));
  } catch (error) {
    console.error('[Phase1Rollback] Failed to save rollback log:', error);
  }
}

/**
 * 获取所有回滚日志（最多最近 10 次）。
 */
export function getAllRollbackLogs(): RollbackResult[] {
  try {
    const logs: RollbackResult[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('__phase1-rollback-log-')) {
        const logStr = localStorage.getItem(key);
        if (logStr) {
          logs.push(JSON.parse(logStr) as RollbackResult);
        }
      }
    }

    // 按时间戳倒序排列
    logs.sort((a, b) => b.timestamp - a.timestamp);

    return logs.slice(0, 10);
  } catch (error) {
    console.error('[Phase1Rollback] Failed to get all rollback logs:', error);
    return [];
  }
}

/**
 * 清理旧的回滚日志（仅保留最近 10 次）。
 */
export function cleanupOldRollbackLogs(): number {
  try {
    const keysToDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('__phase1-rollback-log-')) {
        keysToDelete.push(key);
      }
    }

    // 保留最新的 10 个
    if (keysToDelete.length > 10) {
      keysToDelete.sort().reverse();
      for (let i = 10; i < keysToDelete.length; i++) {
        localStorage.removeItem(keysToDelete[i]);
      }
      return keysToDelete.length - 10;
    }

    return 0;
  } catch (error) {
    console.error('[Phase1Rollback] Failed to cleanup old logs:', error);
    return 0;
  }
}
