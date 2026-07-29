/**
 * phase1-migration.ts — Phase 1 缓存迁移协调器
 *
 * 执行 7 个 P1 缓存键的完整迁移流程：
 * 1. 创建备份
 * 2. 执行迁移
 * 3. 验证完整性
 * 4. 报告结果
 *
 * 零数据丢失保证：所有不一致的数据都会保留 localStorage 备份。
 */

import { initializeDB } from './idb-core';
import { migrateSyncStateCache } from './migrators/cache-sync-state-migrator';
import { migrateApiCache } from './migrators/cache-api-cache-migrator';
import { migrateMapCache } from './migrators/cache-map-migrator';
import { migrateThumbnailsCache } from './migrators/cache-thumbnails-migrator';
import { createBackup, cleanupOldBackups } from './backup-manager';
import { generateChecksum } from './integrity-checker';
import { validateMultipleMigrations } from './migration-validator';

export interface Phase1MigrationResult {
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  totalItemsMigrated: number;
  totalChecksum: string;
  migrations: Array<{
    category: string;
    itemCount: number;
    checksum: string;
    keys: string[];
    status: 'success' | 'warning' | 'error';
    details?: string;
  }>;
  validationResult?: {
    allSuccess: boolean;
    failures: Array<{ category: string; alert: string }>;
  };
  log: string[];
}

/**
 * 执行完整的 Phase 1 迁移流程。
 *
 * @returns 迁移结果
 */
export async function executePhase1Migration(): Promise<Phase1MigrationResult> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      startTime: 0,
      endTime: 0,
      duration: 0,
      totalItemsMigrated: 0,
      totalChecksum: '',
      migrations: [],
      log: ['Error: Not in browser environment'],
    };
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    log.push('[Phase1Migration] Starting Phase 1 migration...');
    log.push(`[Phase1Migration] Start time: ${new Date(startTime).toISOString()}`);

    const db = await initializeDB();

    // 阶段 1: 备份原始数据
    log.push('[Phase1Migration] Phase 1/3: Creating backups...');

    const syncStateKeys: string[] = [];
    const apiCacheKeys: string[] = [];
    const mapCacheKeys: string[] = [];
    const thumbnailKeys: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('nesio-sync-state-')) {
        syncStateKeys.push(key);
      } else if (key.startsWith('nesio-api-cache-')) {
        apiCacheKeys.push(key);
      } else if (key.startsWith('nesio-map-cache-') || key === 'nesio-revgeo-cache-v1') {
        mapCacheKeys.push(key);
      } else if (
        key.startsWith('nesio-avatar-thumb-') ||
        key.startsWith('nesio-tips-shown-') ||
        key.startsWith('nesio-onboarding-')
      ) {
        thumbnailKeys.push(key);
      }
    }

    // 创建所有备份
    for (const key of [...syncStateKeys, ...apiCacheKeys, ...mapCacheKeys, ...thumbnailKeys]) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const checksum = await generateChecksum(JSON.parse(data));
          createBackup(key, data, checksum);
        } catch (e) {
          log.push(
            `[Phase1Migration] Warning: Failed to backup ${key}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    log.push(
      `[Phase1Migration] Backups created: sync-state=${syncStateKeys.length}, api-cache=${apiCacheKeys.length}, map-cache=${mapCacheKeys.length}, thumbnails=${thumbnailKeys.length}`
    );

    // 阶段 2: 执行迁移
    log.push('[Phase1Migration] Phase 2/3: Executing migrations...');

    const migrations: Phase1MigrationResult['migrations'] = [];

    // 2a. 迁移 sync-state
    const syncStateResult = await migrateSyncStateCache(db);
    migrations.push({
      category: 'sync-state',
      itemCount: syncStateResult.itemCount,
      checksum: syncStateResult.checksum,
      keys: syncStateResult.keysProcessed,
      status: syncStateResult.success ? 'success' : 'error',
      details: syncStateResult.error,
    });
    log.push(
      `[Phase1Migration] Migrated sync-state: ${syncStateResult.itemCount} items (checksum: ${syncStateResult.checksum.slice(0, 8)}...)`
    );

    // 2b. 迁移 api-cache
    const apiCacheResult = await migrateApiCache(db);
    migrations.push({
      category: 'api-cache',
      itemCount: apiCacheResult.itemCount,
      checksum: apiCacheResult.checksum,
      keys: apiCacheResult.keysProcessed,
      status: apiCacheResult.success ? 'success' : 'error',
      details: apiCacheResult.error,
    });
    log.push(
      `[Phase1Migration] Migrated api-cache: ${apiCacheResult.itemCount} items (checksum: ${apiCacheResult.checksum.slice(0, 8)}...)`
    );

    // 2c. 迁移 map-cache + revgeo-cache
    const mapCacheResult = await migrateMapCache(db);
    migrations.push({
      category: 'map-cache & revgeo-cache',
      itemCount: mapCacheResult.itemCount,
      checksum: mapCacheResult.checksum,
      keys: mapCacheResult.keysProcessed,
      status: mapCacheResult.success ? 'success' : 'error',
      details: mapCacheResult.error,
    });
    log.push(
      `[Phase1Migration] Migrated map-cache & revgeo-cache: ${mapCacheResult.itemCount} items (checksum: ${mapCacheResult.checksum.slice(0, 8)}...)`
    );

    // 2d. 迁移 thumbnails + flags
    const thumbnailsResult = await migrateThumbnailsCache(db);
    migrations.push({
      category: 'thumbnails & flags',
      itemCount: thumbnailsResult.itemCount,
      checksum: thumbnailsResult.checksum,
      keys: thumbnailsResult.keysProcessed,
      status: thumbnailsResult.success ? 'success' : 'error',
      details: thumbnailsResult.error,
    });
    log.push(
      `[Phase1Migration] Migrated thumbnails & flags: ${thumbnailsResult.itemCount} items (checksum: ${thumbnailsResult.checksum.slice(0, 8)}...)`
    );

    const totalItemsMigrated =
      syncStateResult.itemCount +
      apiCacheResult.itemCount +
      mapCacheResult.itemCount +
      thumbnailsResult.itemCount;

    log.push(`[Phase1Migration] Total items migrated: ${totalItemsMigrated}`);

    // 阶段 3: 验证完整性
    log.push('[Phase1Migration] Phase 3/3: Validating integrity...');

    const validationResult = await validateMultipleMigrations(db, [
      { category: 'sync-state', localStorageKeys: syncStateKeys },
      { category: 'api-cache', localStorageKeys: apiCacheKeys },
      { category: 'map-cache', localStorageKeys: mapCacheKeys.filter((k) => k.startsWith('nesio-map-cache-')) },
      { category: 'revgeo-cache', localStorageKeys: mapCacheKeys.filter((k) => k === 'nesio-revgeo-cache-v1') },
      {
        category: 'avatar-thumb',
        localStorageKeys: thumbnailKeys.filter((k) => k.startsWith('nesio-avatar-thumb-')),
      },
      {
        category: 'tips-shown',
        localStorageKeys: thumbnailKeys.filter((k) => k.startsWith('nesio-tips-shown-')),
      },
      {
        category: 'onboarding',
        localStorageKeys: thumbnailKeys.filter((k) => k.startsWith('nesio-onboarding-')),
      },
    ]);

    if (!validationResult.allSuccess) {
      log.push(`[Phase1Migration] Validation warnings: ${validationResult.failures.length} category(ies) failed`);
      for (const failure of validationResult.failures) {
        log.push(`  - ${failure.category}: ${failure.alert}`);
      }

      // 更新迁移状态为 warning
      for (const migration of migrations) {
        for (const failure of validationResult.failures) {
          if (migration.category.includes(failure.category)) {
            migration.status = 'warning';
          }
        }
      }
    } else {
      log.push('[Phase1Migration] All validations passed!');
    }

    // 清理旧备份
    cleanupOldBackups();

    // 保存迁移日志
    const endTime = Date.now();
    const result: Phase1MigrationResult = {
      success: validationResult.allSuccess && migrations.every((m) => m.status !== 'error'),
      startTime,
      endTime,
      duration: endTime - startTime,
      totalItemsMigrated,
      totalChecksum: await generateChecksum(
        syncStateResult.checksum +
          apiCacheResult.checksum +
          mapCacheResult.checksum +
          thumbnailsResult.checksum
      ),
      migrations,
      validationResult: {
        allSuccess: validationResult.allSuccess,
        failures: validationResult.failures,
      },
      log,
    };

    saveMigrationLog(result);

    log.push(`[Phase1Migration] Migration completed in ${result.duration}ms`);
    log.push(`[Phase1Migration] Status: ${result.success ? 'SUCCESS' : 'WARNING'}`);

    console.log('[Phase1Migration] Result:', result);

    return result;
  } catch (error) {
    const endTime = Date.now();
    const result: Phase1MigrationResult = {
      success: false,
      startTime,
      endTime,
      duration: endTime - startTime,
      totalItemsMigrated: 0,
      totalChecksum: '',
      migrations: [],
      log,
    };

    log.push(
      `[Phase1Migration] Fatal error: ${error instanceof Error ? error.message : String(error)}`
    );

    saveMigrationLog(result);

    console.error('[Phase1Migration] Migration failed:', result);

    return result;
  }
}

/**
 * 获取上次迁移的日志。
 */
export function getLastMigrationLog(): Phase1MigrationResult | null {
  try {
    const logStr = localStorage.getItem('__phase1-migration-log');
    if (!logStr) return null;
    return JSON.parse(logStr) as Phase1MigrationResult;
  } catch (error) {
    console.error('[Phase1Migration] Failed to get last migration log:', error);
    return null;
  }
}

/**
 * 保存迁移日志到 localStorage。
 */
function saveMigrationLog(result: Phase1MigrationResult): void {
  try {
    localStorage.setItem('__phase1-migration-log', JSON.stringify(result));
  } catch (error) {
    console.error('[Phase1Migration] Failed to save migration log:', error);
  }
}

/**
 * 生成迁移报告（文本格式）。
 */
export function generateMigrationReport(result: Phase1MigrationResult): string {
  const lines = [
    '=== Phase 1 Migration Report ===',
    `Status: ${result.success ? 'SUCCESS' : 'WARNING'}`,
    `Duration: ${result.duration}ms`,
    `Total items migrated: ${result.totalItemsMigrated}`,
    `Timestamp: ${new Date(result.startTime).toISOString()}`,
    '',
    'Migrations:',
    ...result.migrations.map(
      (m) =>
        `  - ${m.category}: ${m.itemCount} items (${m.status}) ${m.details ? `[${m.details}]` : ''}`
    ),
    '',
    'Validation:',
    `  All Success: ${result.validationResult?.allSuccess ? 'YES' : 'NO'}`,
    ...(result.validationResult?.failures || []).map(
      (f) => `  - ${f.category}: ${f.alert}`
    ),
    '',
    'Log:',
    ...result.log.slice(-20), // 最后 20 条日志
  ];

  return lines.join('\n');
}
