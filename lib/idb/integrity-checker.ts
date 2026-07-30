/**
 * integrity-checker.ts — 数据完整性检查
 *
 * 提供 checksum 生成和验证、迁移验证等功能。
 * 如果检测到不一致，自动保留 localStorage 备份，不删除原数据。
 */

import { sha256 } from './version-manager';

export interface IntegrityCheckResult {
  success: boolean;
  originalCount: number;
  migratedCount: number;
  originalChecksum: string;
  migratedChecksum: string;
  mismatchDetails?: string;
}

/**
 * 生成数据的 checksum。
 * 使用 SHA256 哈希。
 */
export async function generateChecksum(data: any): Promise<string> {
  try {
    const jsonStr = JSON.stringify(data);
    return await sha256(jsonStr);
  } catch (error) {
    console.error('[IntegrityChecker] Failed to generate checksum:', error);
    throw error;
  }
}

/**
 * 验证数据 checksum 是否匹配。
 */
export async function verifyChecksum(data: any, expectedChecksum: string): Promise<boolean> {
  try {
    const actualChecksum = await generateChecksum(data);
    return actualChecksum === expectedChecksum;
  } catch (error) {
    console.error('[IntegrityChecker] Failed to verify checksum:', error);
    return false;
  }
}

/**
 * 验证迁移的完整性。
 * 比较原始数据和迁移后数据的 checksum。
 *
 * @param originalData 原始 localStorage 数据
 * @param originalChecksum 原始 checksum
 * @param migratedData 迁移后的 IDB 数据
 * @param migratedChecksum 迁移后的 checksum
 * @returns IntegrityCheckResult
 */
export async function verifyMigration(
  originalData: any,
  originalChecksum: string,
  migratedData: any,
  migratedChecksum: string
): Promise<IntegrityCheckResult> {
  try {
    // 计算实际的 checksum
    const actualOriginalChecksum = await generateChecksum(originalData);
    const actualMigratedChecksum = await generateChecksum(migratedData);

    const originalMatch = actualOriginalChecksum === originalChecksum;
    const migratedMatch = actualMigratedChecksum === migratedChecksum;
    const checksumMatch = actualOriginalChecksum === actualMigratedChecksum;

    const success = originalMatch && migratedMatch && checksumMatch;

    if (!success) {
      console.warn('[IntegrityChecker] Checksum mismatch detected!', {
        originalChecksum: actualOriginalChecksum,
        migratedChecksum: actualMigratedChecksum,
        originalMatch,
        migratedMatch,
        checksumMatch,
      });
    }

    const originalCount = Array.isArray(originalData) ? originalData.length : 1;
    const migratedCount = Array.isArray(migratedData) ? migratedData.length : 1;

    return {
      success,
      originalCount,
      migratedCount,
      originalChecksum: actualOriginalChecksum,
      migratedChecksum: actualMigratedChecksum,
      mismatchDetails: !success ? 'Checksum mismatch - data may be corrupted' : undefined,
    };
  } catch (error) {
    console.error('[IntegrityChecker] Verification failed:', error);
    return {
      success: false,
      originalCount: 0,
      migratedCount: 0,
      originalChecksum: '',
      migratedChecksum: '',
      mismatchDetails: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 采样验证：从迁移的数据中随机抽取样本进行逐条对比。
 * 采样率为 10% + 至少 10 条记录。
 *
 * @param idb IndexedDB 数据库
 * @param tableName 表名称
 * @param category 缓存类别（用于过滤）
 * @returns 采样验证结果
 */
export async function performSamplingVerification(
  idb: IDBDatabase,
  tableName: string,
  category: string
): Promise<{
  success: boolean;
  sampleSize: number;
  totalSize: number;
  mismatchCount: number;
  details: Array<{ key: string; match: boolean }>;
}> {
  try {
    const tx = idb.transaction([tableName as any], 'readonly');
    const store = tx.objectStore(tableName as any);

    const items = await new Promise<any[]>((resolve) => {
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => {
        const allItems = getAllRequest.result as any[];
        const filtered = allItems.filter((item) => item.category === category);
        resolve(filtered);
      };
      getAllRequest.onerror = () => resolve([]);
    });

    const totalSize = items.length;
    const sampleSize = Math.max(10, Math.ceil(totalSize * 0.1));

    // 随机抽取样本
    const samples: typeof items = [];
    const indices = new Set<number>();
    while (indices.size < Math.min(sampleSize, totalSize)) {
      indices.add(Math.floor(Math.random() * totalSize));
    }
    indices.forEach((idx) => samples.push(items[idx]));

    // 逐条验证样本
    const details: Array<{ key: string; match: boolean }> = [];
    let mismatchCount = 0;

    for (const item of samples) {
      if (!item.key || !item.checksum || !item.data) {
        details.push({ key: item.key, match: false });
        mismatchCount++;
        continue;
      }

      const actualChecksum = await generateChecksum(item.data);
      const match = actualChecksum === item.checksum;

      if (!match) {
        mismatchCount++;
      }

      details.push({ key: item.key, match });
    }

    const success = mismatchCount === 0;

    console.log(
      `[IntegrityChecker] Sampling verification complete: ${mismatchCount}/${sampleSize} mismatches out of ${totalSize} total items`
    );

    return { success, sampleSize, totalSize, mismatchCount, details };
  } catch (error) {
    console.error('[IntegrityChecker] Sampling verification failed:', error);
    return { success: false, sampleSize: 0, totalSize: 0, mismatchCount: 0, details: [] };
  }
}

/**
 * 全量验证：对所有迁移的数据进行完整性检查。
 * 逐条验证每个项的 checksum。
 *
 * @param idb IndexedDB 数据库
 * @param tableName 表名称
 * @param category 缓存类别（用于过滤）
 * @returns 全量验证结果
 */
export async function performFullVerification(
  idb: IDBDatabase,
  tableName: string,
  category: string
): Promise<{
  success: boolean;
  totalSize: number;
  mismatchCount: number;
  mismatches: Array<{ key: string; expectedChecksum: string; actualChecksum: string }>;
}> {
  try {
    const tx = idb.transaction([tableName as any], 'readonly');
    const store = tx.objectStore(tableName as any);

    const items = await new Promise<any[]>((resolve) => {
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => {
        const allItems = getAllRequest.result as any[];
        const filtered = allItems.filter((item) => item.category === category);
        resolve(filtered);
      };
      getAllRequest.onerror = () => resolve([]);
    });

    const totalSize = items.length;
    const mismatches: Array<{ key: string; expectedChecksum: string; actualChecksum: string }> =
      [];
    let mismatchCount = 0;

    for (const item of items) {
      if (!item.key || !item.checksum || !item.data) {
        mismatches.push({
          key: item.key,
          expectedChecksum: item.checksum || 'missing',
          actualChecksum: 'invalid-record',
        });
        mismatchCount++;
        continue;
      }

      const actualChecksum = await generateChecksum(item.data);
      if (actualChecksum !== item.checksum) {
        mismatches.push({
          key: item.key,
          expectedChecksum: item.checksum,
          actualChecksum,
        });
        mismatchCount++;
      }
    }

    const success = mismatchCount === 0;

    console.log(
      `[IntegrityChecker] Full verification complete: ${mismatchCount}/${totalSize} mismatches`
    );

    if (!success && mismatches.length > 0) {
      console.error('[IntegrityChecker] Mismatches found:', mismatches.slice(0, 5), '...');
    }

    return { success, totalSize, mismatchCount, mismatches };
  } catch (error) {
    console.error('[IntegrityChecker] Full verification failed:', error);
    return { success: false, totalSize: 0, mismatchCount: 0, mismatches: [] };
  }
}

/**
 * 获取 localStorage 中某个键的数据大小（字节）。
 */
export function getLocalStorageKeySize(key: string): number {
  try {
    const data = localStorage.getItem(key);
    if (!data) return 0;
    return new TextEncoder().encode(data).length;
  } catch (error) {
    console.error(`[IntegrityChecker] Failed to get size for ${key}:`, error);
    return 0;
  }
}

/**
 * 获取所有迁移相关键在 localStorage 中的总大小。
 */
export function getTotalLocalStorageSize(keys: string[]): number {
  let total = 0;
  for (const key of keys) {
    total += getLocalStorageKeySize(key);
  }
  return total;
}
