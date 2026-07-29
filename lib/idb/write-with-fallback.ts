/**
 * write-with-fallback.ts — 安全写入（IDB 失败自动转 localStorage）
 *
 * 提供 safeWrite(table, data) 函数，首先尝试 IndexedDB 写入，
 * 失败时自动降级到 localStorage，标记脏态（__dirty:true）。
 * 成功时清除脏态标记。
 *
 * 必须满足 CLAUDE.md 的设计规则：
 * "Never swallow storage write failures"—— 所有写入失败都有明确的错误 UI。
 */

import { initializeDB, StoreName, getStore } from './idb-core';
import { setVersion, VersionedData } from './version-manager';

export interface SafeWriteResult {
  success: boolean;
  tier: 'idb' | 'localStorage';
  error?: Error;
  dirtyMarked?: boolean;
}

// localStorage 脏态标记前缀
const DIRTY_KEY_PREFIX = '__dirty:';
const DIRTY_TIMESTAMP_KEY = '__dirty-timestamp:';

/**
 * 计算 localStorage 的 key，用于存储脏数据。
 * 格式：`__dirty:${table}:${id}`
 */
function getDirtyKey(table: StoreName, dataId: string): string {
  return `${DIRTY_KEY_PREFIX}${table}:${dataId}`;
}

/**
 * 计算脏时间戳的 key。
 */
function getDirtyTimestampKey(table: StoreName, dataId: string): string {
  return `${DIRTY_TIMESTAMP_KEY}${table}:${dataId}`;
}

/**
 * 将数据添加脏态标记并写入 localStorage。
 * 这是降级失败时的备选方案。
 */
function writeDirtyToLocalStorage(
  table: StoreName,
  data: any
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('localStorage not available');
    }

    const dataId = data.id || `unknown-${Date.now()}`;
    const dirtyKey = getDirtyKey(table, dataId);
    const timestampKey = getDirtyTimestampKey(table, dataId);

    // 标记脏态
    const markedData = { ...data, __dirty: true };
    window.localStorage.setItem(dirtyKey, JSON.stringify(markedData));
    window.localStorage.setItem(timestampKey, Date.now().toString());

    console.log(`[SafeWrite] Data marked dirty in localStorage: ${dirtyKey}`);
  } catch (error) {
    console.error('[SafeWrite] Failed to write dirty data to localStorage:', error);
    throw error;
  }
}

/**
 * 清除 localStorage 中的脏态标记。
 * 在数据成功同步到 IDB 后调用。
 */
function clearDirtyMark(table: StoreName, dataId: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const dirtyKey = getDirtyKey(table, dataId);
    const timestampKey = getDirtyTimestampKey(table, dataId);

    window.localStorage.removeItem(dirtyKey);
    window.localStorage.removeItem(timestampKey);

    console.log(`[SafeWrite] Dirty mark cleared: ${dirtyKey}`);
  } catch (error) {
    console.error('[SafeWrite] Failed to clear dirty mark:', error);
  }
}

/**
 * 安全写入函数。
 * 首先尝试写 IDB，失败则转 localStorage 并标记脏态。
 *
 * @param table 目标存储表
 * @param data 要写入的数据对象（必须有 id 字段）
 * @param originId 发起者 ID（用于版本信息）
 * @returns SafeWriteResult
 */
export async function safeWrite(
  table: StoreName,
  data: any,
  originId?: string
): Promise<SafeWriteResult> {
  if (!data || typeof data !== 'object') {
    const error = new Error('[SafeWrite] Invalid data: must be an object');
    console.error(error);
    return { success: false, tier: 'localStorage', error };
  }

  const dataId = data.id;
  if (!dataId) {
    const error = new Error('[SafeWrite] Data must have an id field');
    console.error(error);
    return { success: false, tier: 'localStorage', error };
  }

  try {
    // 1. 尝试 IDB 写入
    const db = await initializeDB();
    const store = getStore(db, table, 'readwrite');

    // 为数据添加版本信息
    const versionedData = setVersion(data, originId) as VersionedData;

    const putRequest = store.put(versionedData);

    return new Promise((resolve) => {
      putRequest.onsuccess = () => {
        // IDB 写入成功，清除脏态标记
        clearDirtyMark(table, dataId);
        console.log(`[SafeWrite] Successfully written to IDB: ${table}/${dataId}`);
        resolve({
          success: true,
          tier: 'idb',
        });
        // 派发成功事件
        dispatchWriteEvent(table, dataId, 'success');
      };

      putRequest.onerror = () => {
        // IDB 写入失败，降级到 localStorage
        const error = putRequest.error || new Error('IDB write failed');
        console.error(`[SafeWrite] IDB write failed for ${table}/${dataId}:`, error);

        try {
          writeDirtyToLocalStorage(table, data);
          resolve({
            success: false,
            tier: 'localStorage',
            error,
            dirtyMarked: true,
          });
          // 派发失败事件，UI 层应显示错误
          dispatchWriteEvent(table, dataId, 'fallback', error);
        } catch (fallbackError) {
          // localStorage 也失败，返回严重错误
          console.error('[SafeWrite] Both IDB and localStorage write failed:', fallbackError);
          resolve({
            success: false,
            tier: 'localStorage',
            error: fallbackError as Error,
          });
          dispatchWriteEvent(table, dataId, 'error', fallbackError as Error);
        }
      };
    });
  } catch (error) {
    // 同步错误处理
    console.error(`[SafeWrite] Synchronous error during write:`, error);

    // 尝试降级到 localStorage
    try {
      writeDirtyToLocalStorage(table, data);
      return {
        success: false,
        tier: 'localStorage',
        error: error as Error,
        dirtyMarked: true,
      };
    } catch (fallbackError) {
      return {
        success: false,
        tier: 'localStorage',
        error: fallbackError as Error,
      };
    }
  }
}

/**
 * 批量安全写入。
 * 返回每条数据的写入结果。
 */
export async function safeWriteBatch(
  table: StoreName,
  dataArray: any[],
  originId?: string
): Promise<SafeWriteResult[]> {
  const results = await Promise.all(
    dataArray.map(data => safeWrite(table, data, originId))
  );
  return results;
}

/**
 * 获取 localStorage 中标记为脏的所有数据。
 * 用于后续的同步/恢复流程。
 */
export function getDirtyData(table?: StoreName): Array<{
  table: StoreName;
  id: string;
  data: any;
  timestamp: number;
}> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    const results: Array<{
      table: StoreName;
      id: string;
      data: any;
      timestamp: number;
    }> = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(DIRTY_KEY_PREFIX)) continue;

      // 解析 key：__dirty:${table}:${id}
      const parts = key.slice(DIRTY_KEY_PREFIX.length).split(':');
      if (parts.length < 2) continue;

      const tbl = parts[0] as StoreName;
      const id = parts.slice(1).join(':'); // id 可能包含冒号

      // 若指定了 table，则过滤
      if (table && tbl !== table) continue;

      try {
        const dataStr = window.localStorage.getItem(key);
        const timestampStr = window.localStorage.getItem(getDirtyTimestampKey(tbl, id));
        const data = dataStr ? JSON.parse(dataStr) : null;
        const timestamp = timestampStr ? parseInt(timestampStr, 10) : 0;

        if (data) {
          results.push({ table: tbl, id, data, timestamp });
        }
      } catch (parseError) {
        console.warn(`[SafeWrite] Failed to parse dirty data from ${key}:`, parseError);
      }
    }

    return results;
  } catch (error) {
    console.error('[SafeWrite] Failed to get dirty data:', error);
    return [];
  }
}

/**
 * 清除所有脏数据标记。
 * 在成功同步所有脏数据后调用。
 */
export function clearAllDirtyMarks(table?: StoreName): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 0;
    }

    let cleared = 0;
    const keysToDelete: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(DIRTY_KEY_PREFIX)) {
        const tbl = key.slice(DIRTY_KEY_PREFIX.length).split(':')[0];
        if (!table || tbl === table) {
          keysToDelete.push(key);
        }
      } else if (key.startsWith(DIRTY_TIMESTAMP_KEY)) {
        const tbl = key.slice(DIRTY_TIMESTAMP_KEY.length).split(':')[0];
        if (!table || tbl === table) {
          keysToDelete.push(key);
        }
      }
    }

    for (const key of keysToDelete) {
      window.localStorage.removeItem(key);
      cleared++;
    }

    console.log(`[SafeWrite] Cleared ${cleared} dirty marks`);
    return cleared;
  } catch (error) {
    console.error('[SafeWrite] Failed to clear dirty marks:', error);
    return 0;
  }
}

/**
 * 派发写入事件（供 UI 层监听）。
 * 事件类型：
 * - 'success': IDB 写入成功
 * - 'fallback': 降级到 localStorage
 * - 'error': 写入完全失败
 */
function dispatchWriteEvent(
  table: StoreName,
  dataId: string,
  status: 'success' | 'fallback' | 'error',
  error?: Error
): void {
  if (typeof window === 'undefined') return;

  const event = new CustomEvent('idb:write', {
    detail: {
      table,
      dataId,
      status,
      error: error?.message,
      timestamp: Date.now(),
    },
  });

  window.dispatchEvent(event);

  // 也可以派发到特定的错误处理系统
  if (status === 'error' || status === 'fallback') {
    console.warn(
      `[SafeWrite] Data write degraded/failed: ${table}/${dataId}`,
      error?.message || 'unknown error'
    );
  }
}

/**
 * 监听写入事件（UI 层集成示例）。
 */
export function listenToWriteEvents(
  callback: (event: CustomEvent<any>) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = callback as EventListener;
  window.addEventListener('idb:write', handler);

  return () => {
    window.removeEventListener('idb:write', handler);
  };
}
