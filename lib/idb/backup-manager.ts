/**
 * backup-manager.ts — localStorage 备份管理
 *
 * 在迁移前自动备份原始数据到 localStorage。
 * 备份保留 30 天（带时间戳），用于数据恢复和对比。
 */

/**
 * 备份项的结构。
 */
export interface BackupItem {
  key: string;
  data: string; // JSON 字符串
  timestamp: number;
  expiresAt: number;
  originalChecksum?: string;
}

const BACKUP_KEY_PREFIX = '__backup:';
const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * 为某个键创建备份。
 * 会自动添加时间戳和过期时间。
 *
 * @param key 原始键
 * @param data 要备份的数据（JSON 字符串）
 * @param originalChecksum 原始 checksum（可选）
 * @returns 备份键
 */
export function createBackup(key: string, data: string, originalChecksum?: string): string {
  try {
    const timestamp = Date.now();
    const expiresAt = timestamp + BACKUP_RETENTION_MS;

    const backupItem: BackupItem = {
      key,
      data,
      timestamp,
      expiresAt,
      originalChecksum,
    };

    const backupKey = `${BACKUP_KEY_PREFIX}${key}:${timestamp}`;
    const backupData = JSON.stringify(backupItem);

    localStorage.setItem(backupKey, backupData);

    console.log(`[BackupManager] Created backup for ${key} (${backupKey})`);

    return backupKey;
  } catch (error) {
    console.error(`[BackupManager] Failed to create backup for ${key}:`, error);
    throw error;
  }
}

/**
 * 检查某个键是否有备份。
 * 返回最新的备份键（如果存在）。
 */
export function hasBackup(key: string): string | null {
  try {
    const prefix = `${BACKUP_KEY_PREFIX}${key}:`;
    let latestBackupKey: string | null = null;
    let latestTimestamp = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(prefix)) continue;

      // 从备份键中提取时间戳
      const timestampStr = lsKey.substring(prefix.length);
      const timestamp = parseInt(timestampStr, 10);

      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestBackupKey = lsKey;
      }
    }

    return latestBackupKey;
  } catch (error) {
    console.error(`[BackupManager] Failed to check backup for ${key}:`, error);
    return null;
  }
}

/**
 * 从备份恢复数据。
 * 返回原始数据和元数据。
 *
 * @param key 原始键
 * @returns 备份项内容，或 null（如果没有备份）
 */
export function restoreFromBackup(key: string): BackupItem | null {
  try {
    const backupKey = hasBackup(key);
    if (!backupKey) {
      console.warn(`[BackupManager] No backup found for ${key}`);
      return null;
    }

    const backupData = localStorage.getItem(backupKey);
    if (!backupData) return null;

    const backupItem: BackupItem = JSON.parse(backupData);

    console.log(`[BackupManager] Restored backup for ${key} from ${backupKey}`);

    return backupItem;
  } catch (error) {
    console.error(`[BackupManager] Failed to restore backup for ${key}:`, error);
    return null;
  }
}

/**
 * 列出某个键的所有备份。
 * 按时间戳倒序排列。
 */
export function listBackups(key: string): BackupItem[] {
  try {
    const prefix = `${BACKUP_KEY_PREFIX}${key}:`;
    const backups: { backupKey: string; backupItem: BackupItem }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(prefix)) continue;

      const backupData = localStorage.getItem(lsKey);
      if (!backupData) continue;

      try {
        const backupItem: BackupItem = JSON.parse(backupData);
        backups.push({ backupKey: lsKey, backupItem });
      } catch (e) {
        console.warn(`[BackupManager] Failed to parse backup ${lsKey}:`, e);
      }
    }

    // 按时间戳倒序排列
    backups.sort((a, b) => b.backupItem.timestamp - a.backupItem.timestamp);

    return backups.map((b) => b.backupItem);
  } catch (error) {
    console.error(`[BackupManager] Failed to list backups for ${key}:`, error);
    return [];
  }
}

/**
 * 清理过期的备份（> 30 天）。
 */
export function cleanupOldBackups(): number {
  try {
    const now = Date.now();
    let deleted = 0;

    // 收集所有过期的备份键
    const backupKeysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(BACKUP_KEY_PREFIX)) continue;

      const backupData = localStorage.getItem(lsKey);
      if (!backupData) continue;

      try {
        const backupItem: BackupItem = JSON.parse(backupData);
        if (backupItem.expiresAt < now) {
          backupKeysToDelete.push(lsKey);
        }
      } catch (e) {
        // 忽略解析错误的备份
      }
    }

    // 删除过期备份
    for (const lsKey of backupKeysToDelete) {
      try {
        localStorage.removeItem(lsKey);
        deleted++;
      } catch (e) {
        console.warn(`[BackupManager] Failed to delete old backup ${lsKey}:`, e);
      }
    }

    if (deleted > 0) {
      console.log(`[BackupManager] Cleaned up ${deleted} old backups`);
    }

    return deleted;
  } catch (error) {
    console.error('[BackupManager] Failed to cleanup old backups:', error);
    return 0;
  }
}

/**
 * 删除某个键的所有备份。
 */
export function deleteBackups(key: string): number {
  try {
    const prefix = `${BACKUP_KEY_PREFIX}${key}:`;
    const keysToDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (lsKey && lsKey.startsWith(prefix)) {
        keysToDelete.push(lsKey);
      }
    }

    for (const lsKey of keysToDelete) {
      localStorage.removeItem(lsKey);
    }

    if (keysToDelete.length > 0) {
      console.log(`[BackupManager] Deleted ${keysToDelete.length} backups for ${key}`);
    }

    return keysToDelete.length;
  } catch (error) {
    console.error(`[BackupManager] Failed to delete backups for ${key}:`, error);
    return 0;
  }
}

/**
 * 获取所有备份在 localStorage 中的总大小（字节）。
 */
export function getTotalBackupSize(): number {
  try {
    let totalSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(BACKUP_KEY_PREFIX)) continue;

      const backupData = localStorage.getItem(lsKey);
      if (backupData) {
        totalSize += new TextEncoder().encode(backupData).length;
      }
    }

    return totalSize;
  } catch (error) {
    console.error('[BackupManager] Failed to get total backup size:', error);
    return 0;
  }
}

/**
 * 获取所有备份的详细信息。
 */
export interface BackupSummary {
  totalSize: number;
  backupCount: number;
  oldestBackup: number | null;
  newestBackup: number | null;
}

export function getBackupSummary(): BackupSummary {
  try {
    let totalSize = 0;
    let backupCount = 0;
    let oldestBackup: number | null = null;
    let newestBackup: number | null = null;

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(BACKUP_KEY_PREFIX)) continue;

      const backupData = localStorage.getItem(lsKey);
      if (!backupData) continue;

      try {
        const backupItem: BackupItem = JSON.parse(backupData);
        totalSize += new TextEncoder().encode(backupData).length;
        backupCount++;

        if (oldestBackup === null || backupItem.timestamp < oldestBackup) {
          oldestBackup = backupItem.timestamp;
        }
        if (newestBackup === null || backupItem.timestamp > newestBackup) {
          newestBackup = backupItem.timestamp;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    return { totalSize, backupCount, oldestBackup, newestBackup };
  } catch (error) {
    console.error('[BackupManager] Failed to get backup summary:', error);
    return { totalSize: 0, backupCount: 0, oldestBackup: null, newestBackup: null };
  }
}
