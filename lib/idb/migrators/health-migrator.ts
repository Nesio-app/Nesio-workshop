/**
 * health-migrator.ts — 从 localStorage 迁移健康数据到 IDB
 *
 * 读取 nesio-health-v1，转换为 IDB signals 表格式。
 * 健康数据是 HealthMetrics 对象，含 metrics 数组和其他分析数据。
 */

import { sha256 } from '../version-manager';
import type { VersionInfo } from '../version-manager';

export interface HealthMigrationResult {
  success: boolean;
  itemCount: number;
  checksum: string;
  error?: string;
}

/**
 * 从 localStorage 迁移健康数据到 IDB。
 */
export async function migrateHealth(idb: IDBDatabase): Promise<HealthMigrationResult> {
  if (typeof window === 'undefined') {
    return { success: false, itemCount: 0, checksum: '', error: 'Not in browser environment' };
  }

  try {
    const lsData = localStorage.getItem('nesio-health-v1');
    if (!lsData) {
      console.log('[HealthMigrator] No data found in localStorage');
      return { success: true, itemCount: 0, checksum: '' };
    }

    let healthMetrics: any = null;
    try {
      healthMetrics = JSON.parse(lsData);
    } catch (e) {
      console.error('[HealthMigrator] Failed to parse JSON:', e);
      return { success: false, itemCount: 0, checksum: '', error: `JSON parse error: ${e}` };
    }

    if (!healthMetrics || typeof healthMetrics !== 'object') {
      return { success: true, itemCount: 0, checksum: '' };
    }

    // 准备 IDB 写入
    const tx = idb.transaction(['signals'], 'readwrite');
    const store = tx.objectStore('signals');

    // 计算原始数据的校验和
    const originalChecksum = await sha256(JSON.stringify(healthMetrics));

    // 迁移健康数据为单条 signal 记录
    const signalId = `health-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = healthMetrics.importedAt || new Date().toISOString();

    const version: VersionInfo = {
      lamportClock: 1,
      timestamp: createdAt,
      timestampMs: new Date(createdAt).getTime(),
      originId: 'migration-health-v1',
    };

    const signal = {
      id: signalId,
      table: 'health-metrics',
      data: healthMetrics,
      __version: version,
      createdAt: createdAt,
      userId: undefined,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const request = store.add(signal);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      return { success: true, itemCount: 1, checksum: originalChecksum };
    } catch (e) {
      console.error('[HealthMigrator] Failed to add signal:', e);
      return {
        success: false,
        itemCount: 0,
        checksum: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } catch (error) {
    console.error('[HealthMigrator] Migration failed:', error);
    return {
      success: false,
      itemCount: 0,
      checksum: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
