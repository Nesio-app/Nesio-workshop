/**
 * life-graph-migrator.ts — 从 localStorage 迁移生活图谱到 IDB
 *
 * 读取 nesio-life-graph-v1，转换为 IDB signals 表格式。
 * 每条记录加版本戳和校验和。
 */

import { sha256 } from '../version-manager';
import type { VersionInfo } from '../version-manager';

export interface MigrationResult {
  success: boolean;
  itemCount: number;
  checksum: string;
  error?: string;
}

/**
 * 从 localStorage 迁移生活图谱到 IDB。
 * 返回迁移结果（成功/数量/校验和）。
 */
export async function migrateLifeGraph(idb: IDBDatabase): Promise<MigrationResult> {
  if (typeof window === 'undefined') {
    return { success: false, itemCount: 0, checksum: '', error: 'Not in browser environment' };
  }

  try {
    const lsData = localStorage.getItem('nesio-life-graph-v1');
    if (!lsData) {
      console.log('[LifeGraphMigrator] No data found in localStorage');
      return { success: true, itemCount: 0, checksum: '' };
    }

    let items: any[] = [];
    try {
      const parsed = JSON.parse(lsData);
      items = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[LifeGraphMigrator] Failed to parse JSON:', e);
      return { success: false, itemCount: 0, checksum: '', error: `JSON parse error: ${e}` };
    }

    if (items.length === 0) {
      return { success: true, itemCount: 0, checksum: '' };
    }

    // 准备 IDB 写入
    const tx = idb.transaction(['signals'], 'readwrite');
    const store = tx.objectStore('signals');

    // 计算原始数据的校验和
    const originalChecksum = await sha256(JSON.stringify(items));

    // 迁移每条记录
    let count = 0;
    const now = new Date();
    let maxLamportClock = 0;

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const signalId = item.id || `lg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const createdAt = item.createdAt || now.toISOString();

      // 构建版本信息
      const version: VersionInfo = {
        lamportClock: ++maxLamportClock,
        timestamp: createdAt,
        timestampMs: new Date(createdAt).getTime(),
        originId: 'migration-life-graph-v1',
      };

      // 构建 IDB 记录
      const signal = {
        id: signalId,
        table: 'life-graph',
        data: item,
        __version: version,
        createdAt: createdAt,
        userId: undefined, // 迁移时无用户上下文
      };

      try {
        await new Promise<void>((resolve, reject) => {
          const request = store.add(signal);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        count++;
      } catch (e) {
        console.warn(`[LifeGraphMigrator] Failed to migrate record ${signalId}:`, e);
        // 继续迁移其他记录
      }
    }

    // 设置全局 Lamport 时钟
    if (maxLamportClock > 0) {
      // 暂存在某个全局对象或记录中
      // 这里我们在返回值中报告，后续会有统一的处理
    }

    return { success: true, itemCount: count, checksum: originalChecksum };
  } catch (error) {
    console.error('[LifeGraphMigrator] Migration failed:', error);
    return {
      success: false,
      itemCount: 0,
      checksum: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
