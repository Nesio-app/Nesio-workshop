/**
 * person-records-migrator.ts — 从 localStorage 迁移人物记录到 IDB
 *
 * 读取 nesio-person-records-v1，转换为 IDB user_module_data 表格式。
 * 人物记录包含成绩、消费、位置、医疗、药物、健康信息。
 */

import { sha256 } from '../version-manager';
import type { VersionInfo } from '../version-manager';

export interface PersonRecordsMigrationResult {
  success: boolean;
  itemCount: number;
  checksum: string;
  error?: string;
}

/**
 * 从 localStorage 迁移人物记录到 IDB。
 */
export async function migratePersonRecords(idb: IDBDatabase): Promise<PersonRecordsMigrationResult> {
  if (typeof window === 'undefined') {
    return { success: false, itemCount: 0, checksum: '', error: 'Not in browser environment' };
  }

  try {
    const lsData = localStorage.getItem('nesio-person-records-v1');
    if (!lsData) {
      console.log('[PersonRecordsMigrator] No data found in localStorage');
      return { success: true, itemCount: 0, checksum: '' };
    }

    let records: any[] = [];
    try {
      const parsed = JSON.parse(lsData);
      records = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[PersonRecordsMigrator] Failed to parse JSON:', e);
      return { success: false, itemCount: 0, checksum: '', error: `JSON parse error: ${e}` };
    }

    if (records.length === 0) {
      return { success: true, itemCount: 0, checksum: '' };
    }

    // 准备 IDB 写入
    const tx = idb.transaction(['user_module_data'], 'readwrite');
    const store = tx.objectStore('user_module_data');

    // 计算原始数据的校验和
    const originalChecksum = await sha256(JSON.stringify(records));

    // 迁移每条人物记录
    let count = 0;
    const now = new Date();
    let lamportClock = 0;

    for (const record of records) {
      if (!record || typeof record !== 'object') continue;

      const moduleDataId = `person-rec-${record.id || Date.now()}-${Math.random().toString(36).slice(2)}`;
      const createdAt = record.createdAt || now.toISOString();

      // 构建版本信息
      const version: VersionInfo = {
        lamportClock: ++lamportClock,
        timestamp: createdAt,
        timestampMs: new Date(createdAt).getTime(),
        originId: 'migration-person-records-v1',
      };

      // 构建 IDB 记录
      const moduleData = {
        id: moduleDataId,
        table: 'person-record',
        module: 'people',
        data: record,
        __version: version,
        createdAt: createdAt,
        userId: undefined,
      };

      try {
        await new Promise<void>((resolve, reject) => {
          const request = store.add(moduleData);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        count++;
      } catch (e) {
        console.warn(`[PersonRecordsMigrator] Failed to migrate record ${record.id}:`, e);
        // 继续迁移其他记录
      }
    }

    return { success: true, itemCount: count, checksum: originalChecksum };
  } catch (error) {
    console.error('[PersonRecordsMigrator] Migration failed:', error);
    return {
      success: false,
      itemCount: 0,
      checksum: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
