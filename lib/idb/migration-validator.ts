/**
 * migration-validator.ts — 迁移后验证器
 *
 * 迁移后对数据进行全面验证：
 * - 记录数对比
 * - 内容采样对比（10% + 随机全量）
 * - checksum 对比
 * - 失败时保留双份数据并告警
 */

import { performSamplingVerification, performFullVerification } from './integrity-checker';
import { getTotalLocalStorageSize } from './integrity-checker';

export interface MigrationValidationResult {
  success: boolean;
  category: string;
  localStorageKeys: string[];
  localStorageCount: number;
  idbCount: number;
  samplingMismatches: number;
  fullMismatchCount: number;
  localStorageSize: number;
  alert?: string;
  details: {
    samplingResult: { success: boolean; sampleSize: number; totalSize: number };
    fullResult: { success: boolean; totalSize: number };
  };
}

/**
 * 验证迁移结果的完整性。
 * 如果发现问题，会：
 * 1. 记录详细日志
 * 2. 触发告警
 * 3. 保留 localStorage 备份（不删除）
 * 4. 返回失败状态
 *
 * @param idb IndexedDB 数据库
 * @param category 缓存类别（sync-state, api-cache, map-cache 等）
 * @param localStorageKeys 迁移的 localStorage 键列表
 * @returns 验证结果
 */
export async function validateMigration(
  idb: IDBDatabase,
  category: string,
  localStorageKeys: string[]
): Promise<MigrationValidationResult> {
  try {
    // 1. 计算 localStorage 中的记录数
    const localStorageCount = localStorageKeys.filter((key) => {
      const data = localStorage.getItem(key);
      return data !== null;
    }).length;

    // 2. 计算 IDB 中的记录数
    const idbCount = await countIDBItems(idb, category);

    // 3. 采样验证（10% + 至少 10 条）
    const samplingResult = await performSamplingVerification(idb, 'ui-cache', category);

    // 4. 全量验证
    const fullResult = await performFullVerification(idb, 'ui-cache', category);

    // 5. 计算 localStorage 大小
    const localStorageSize = getTotalLocalStorageSize(localStorageKeys);

    // 6. 判断验证是否成功
    const countMatch = localStorageCount === idbCount;
    const samplingSuccess = samplingResult.success;
    const fullSuccess = fullResult.success;

    const success = countMatch && samplingSuccess && fullSuccess;

    let alert: string | undefined;
    if (!success) {
      const issues: string[] = [];
      if (!countMatch) {
        issues.push(
          `Record count mismatch: localStorage=${localStorageCount}, idb=${idbCount}`
        );
      }
      if (!samplingSuccess) {
        issues.push(
          `Sampling verification failed: ${samplingResult.mismatchCount}/${samplingResult.sampleSize} mismatches`
        );
      }
      if (!fullSuccess) {
        issues.push(
          `Full verification failed: ${fullResult.mismatchCount}/${fullResult.totalSize} mismatches`
        );
      }

      alert = `MIGRATION VALIDATION FAILED: ${issues.join('; ')}`;
      console.error(`[MigrationValidator] ${alert}`);

      // 保留 localStorage 备份（不删除）
      console.warn(
        `[MigrationValidator] Keeping localStorage as backup for ${category} (${localStorageSize} bytes)`
      );
    } else {
      console.log(
        `[MigrationValidator] Migration validated successfully for ${category}: ${idbCount} items`
      );
    }

    return {
      success,
      category,
      localStorageKeys,
      localStorageCount,
      idbCount,
      samplingMismatches: samplingResult.mismatchCount,
      fullMismatchCount: fullResult.mismatchCount,
      localStorageSize,
      alert,
      details: {
        samplingResult: {
          success: samplingResult.success,
          sampleSize: samplingResult.sampleSize,
          totalSize: samplingResult.totalSize,
        },
        fullResult: {
          success: fullResult.success,
          totalSize: fullResult.totalSize,
        },
      },
    };
  } catch (error) {
    console.error(`[MigrationValidator] Validation failed for ${category}:`, error);

    return {
      success: false,
      category,
      localStorageKeys,
      localStorageCount: 0,
      idbCount: 0,
      samplingMismatches: 0,
      fullMismatchCount: 0,
      localStorageSize: 0,
      alert: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        samplingResult: { success: false, sampleSize: 0, totalSize: 0 },
        fullResult: { success: false, totalSize: 0 },
      },
    };
  }
}

/**
 * 计算 IDB 中某个类别的项数。
 */
async function countIDBItems(idb: IDBDatabase, category: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(['ui-cache'], 'readonly');
      const store = tx.objectStore('ui-cache');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result as any[];
        const filtered = items.filter((item) => item.category === category);
        resolve(filtered.length);
      };

      getAllRequest.onerror = () => resolve(0);
    } catch (error) {
      console.error('[MigrationValidator] Failed to count IDB items:', error);
      resolve(0);
    }
  });
}

/**
 * 执行多个类别的批量验证。
 * 返回所有验证结果的汇总。
 */
export async function validateMultipleMigrations(
  idb: IDBDatabase,
  migrations: Array<{
    category: string;
    localStorageKeys: string[];
  }>
): Promise<{
  allSuccess: boolean;
  totalItems: number;
  validationCount: number;
  failures: Array<{ category: string; alert: string }>;
  results: MigrationValidationResult[];
}> {
  const results: MigrationValidationResult[] = [];
  const failures: Array<{ category: string; alert: string }> = [];
  let totalItems = 0;

  for (const migration of migrations) {
    const result = await validateMigration(idb, migration.category, migration.localStorageKeys);
    results.push(result);

    if (!result.success && result.alert) {
      failures.push({ category: result.category, alert: result.alert });
    }

    totalItems += result.idbCount;
  }

  const allSuccess = failures.length === 0;

  if (!allSuccess) {
    console.error(`[MigrationValidator] ${failures.length} validation(s) failed:`, failures);
  }

  return {
    allSuccess,
    totalItems,
    validationCount: results.length,
    failures,
    results,
  };
}

/**
 * 生成验证报告。
 */
export function generateValidationReport(result: MigrationValidationResult): string {
  const lines = [
    '=== Migration Validation Report ===',
    `Category: ${result.category}`,
    `Status: ${result.success ? 'PASS' : 'FAIL'}`,
    `localStorage count: ${result.localStorageCount}`,
    `IDB count: ${result.idbCount}`,
    `localStorage size: ${formatBytes(result.localStorageSize)}`,
    `Sampling: ${result.details.samplingResult.success ? 'PASS' : 'FAIL'} (${result.samplingMismatches} mismatches)`,
    `Full verification: ${result.details.fullResult.success ? 'PASS' : 'FAIL'} (${result.fullMismatchCount} mismatches)`,
  ];

  if (result.alert) {
    lines.push(`Alert: ${result.alert}`);
  }

  return lines.join('\n');
}

/**
 * 格式化字节大小为可读字符串。
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
