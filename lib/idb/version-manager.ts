/**
 * version-manager.ts — 数据版本化和冲突检测
 *
 * 每条数据自动加版本戳（Lamport clock + timestamp）。
 * 支持 LWW（Last-Write-Wins）冲突解决逻辑。
 * 计算 checksum（SHA256）以检测数据修改。
 */

/**
 * 数据版本信息
 */
export interface VersionInfo {
  /** Lamport 逻辑时钟（单调递增） */
  lamportClock: number;
  /** ISO 时间戳 */
  timestamp: string;
  /** 秒级时间戳（毫秒转秒） */
  timestampMs: number;
  /** 数据内容的 SHA256 校验和 */
  checksum?: string;
  /** 发起者 ID（用户/客户端） */
  originId?: string;
}

/**
 * 带版本信息的数据容器
 */
export interface VersionedData {
  __version: VersionInfo;
  [key: string]: any;
}

// 全局 Lamport 时钟（每次版本更新递增）
let globalLamportClock = 0;

/**
 * 生成新的版本信息。
 * Lamport 时钟确保在分布式系统中维持因果顺序。
 */
export function generateVersion(originId?: string): VersionInfo {
  globalLamportClock++;
  const now = new Date();
  return {
    lamportClock: globalLamportClock,
    timestamp: now.toISOString(),
    timestampMs: now.getTime(),
    originId: originId || 'unknown',
  };
}

/**
 * 为数据对象加上版本信息。
 * 如果数据已有 __version，会更新 Lamport 时钟。
 */
export function setVersion<T extends Record<string, any>>(
  data: T,
  originId?: string
): T & VersionedData {
  const versionedData = { ...data } as T & VersionedData;

  // 如果已有版本信息，Lamport 时钟继承后递增
  if ((versionedData as any).__version?.lamportClock) {
    globalLamportClock = Math.max(globalLamportClock, (versionedData as any).__version.lamportClock);
  }

  versionedData.__version = generateVersion(originId);
  return versionedData;
}

/**
 * 获取数据对象的版本信息。
 */
export function getVersion(data: any): VersionInfo | null {
  if (data && typeof data === 'object' && '__version' in data) {
    return data.__version;
  }
  return null;
}

/**
 * 移除版本信息（返回原始数据）。
 */
export function stripVersion<T extends Record<string, any>>(
  data: VersionedData
): Omit<T, '__version'> {
  const { __version, ...rest } = data;
  return rest as any;
}

/**
 * 简单的 SHA256 哈希实现（浏览器原生）。
 * 返回 hex 字符串。
 */
export async function sha256(text: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto) {
    console.warn('[VersionManager] crypto API not available, returning dummy hash');
    return 'dummy-' + Math.random().toString(36).slice(2);
  }

  try {
    const encoded = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error('[VersionManager] SHA256 failed:', error);
    throw error;
  }
}

/**
 * 计算数据对象的校验和（排除 __version 字段）。
 */
export async function computeChecksum(data: any): Promise<string> {
  try {
    const dataToHash = data && typeof data === 'object' && '__version' in data
      ? stripVersion(data)
      : data;
    const jsonStr = JSON.stringify(dataToHash);
    return await sha256(jsonStr);
  } catch (error) {
    console.error('[VersionManager] Checksum computation failed:', error);
    throw error;
  }
}

/**
 * 比较两个版本的新旧程度。
 * 返回：
 *   > 0: v1 更新
 *   < 0: v2 更新
 *   = 0: 相等
 */
export function compareVersions(v1: VersionInfo | null, v2: VersionInfo | null): number {
  if (!v1 && !v2) return 0;
  if (!v1) return -1; // v2 更新
  if (!v2) return 1; // v1 更新

  // 比较 Lamport 时钟（主要准则）
  if (v1.lamportClock !== v2.lamportClock) {
    return v1.lamportClock - v2.lamportClock;
  }

  // Lamport 时钟相同，比较时间戳（副准则，用于断点平局）
  const t1 = v1.timestampMs || 0;
  const t2 = v2.timestampMs || 0;
  return t1 - t2;
}

/**
 * LWW（Last-Write-Wins）冲突解决逻辑。
 * 返回 local 或 remote，表示应该保留哪个版本的数据。
 *
 * 同时检查 checksum，如果两个数据的校验和相同，
 * 则认为没有实际冲突（可能是重复同步）。
 */
export async function resolveLWW(
  localData: any,
  remoteData: any,
  localChecksum?: string,
  remoteChecksum?: string
): Promise<'local' | 'remote'> {
  const localVersion = getVersion(localData);
  const remoteVersion = getVersion(remoteData);

  // 计算校验和（如果未提供）
  const lChecksum = localChecksum || (await computeChecksum(localData));
  const rChecksum = remoteChecksum || (await computeChecksum(remoteData));

  // 如果校验和相同，不算冲突
  if (lChecksum === rChecksum) {
    console.log('[VersionManager] No actual conflict detected (same checksum)');
    return 'remote'; // 返回任一即可，因为相同
  }

  // 比较版本
  const cmp = compareVersions(localVersion, remoteVersion);
  const result = cmp >= 0 ? 'local' : 'remote';

  console.log(
    `[VersionManager] LWW resolved to ${result}:`,
    { localClock: localVersion?.lamportClock, remoteClock: remoteVersion?.lamportClock }
  );

  return result;
}

/**
 * 验证数据完整性。
 * 可选传入预期的 checksum，如果不匹配则返回 false。
 */
export async function verifyIntegrity(
  data: any,
  expectedChecksum?: string
): Promise<boolean> {
  try {
    const actualChecksum = await computeChecksum(data);
    const version = getVersion(data);

    if (expectedChecksum && actualChecksum !== expectedChecksum) {
      console.warn(
        '[VersionManager] Checksum mismatch:',
        { expected: expectedChecksum, actual: actualChecksum }
      );
      return false;
    }

    // 也可以检验 checksum 字段是否存在于 __version
    if (version?.checksum && version.checksum !== actualChecksum) {
      console.warn(
        '[VersionManager] Stored checksum mismatch:',
        { stored: version.checksum, actual: actualChecksum }
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('[VersionManager] Integrity verification failed:', error);
    return false;
  }
}

/**
 * 标记版本的 checksum（用于后续完整性验证）。
 */
export async function markChecksum<T extends VersionedData>(data: T): Promise<T> {
  try {
    const checksum = await computeChecksum(data);
    data.__version.checksum = checksum;
    return data;
  } catch (error) {
    console.error('[VersionManager] Failed to mark checksum:', error);
    throw error;
  }
}

/**
 * 设置全局 Lamport 时钟（用于恢复或同步场景）。
 * 仅在必要时调用。
 */
export function setGlobalLamportClock(value: number): void {
  globalLamportClock = Math.max(globalLamportClock, value);
  console.log('[VersionManager] Global Lamport clock set to:', globalLamportClock);
}

/**
 * 获取当前的全局 Lamport 时钟值。
 */
export function getGlobalLamportClock(): number {
  return globalLamportClock;
}
