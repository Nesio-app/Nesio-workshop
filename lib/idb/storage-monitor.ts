/**
 * lib/idb/storage-monitor.ts — 存储使用监控
 *
 * 监控 localStorage 和 IDB 的占用情况，提供：
 * - getStorageMetrics(): 获取存储指标
 * - 写入失败率统计
 * - 配额警告（80% / 90%）
 * - 使用详情（最大的 key）
 */

import { estimateDBSize } from './idb-core';
import { getStorageHealth, formatBytes } from '../portal/storage-health';

export interface StorageMetrics {
  /** localStorage 使用百分比（0-100） */
  localStorage: number;
  /** localStorage 使用字节数 */
  localStorageBytes: number;
  /** IDB 使用 MB */
  idb: number;
  /** IDB 使用字节数 */
  idbBytes: number;
  /** 总存储使用百分比（假设 IDB 和 localStorage 共享 5-50MB） */
  total: number;
  /** 是否超过危险阈值（>90%） */
  isDanger: boolean;
  /** 最大的 localStorage keys */
  largestLocalStorageKeys: Array<{ key: string; bytes: number }>;
  /** 写入失败率（0-100） */
  failureRate: number;
}

// 全局写入失败统计
let writeAttempts = 0;
let writeFailures = 0;
const FAILURE_RATE_RESET_INTERVAL = 60 * 60 * 1000; // 每小时重置

/**
 * 获取当前存储指标。
 * 包括 localStorage 占用、IDB 大小、写入失败率等。
 */
export async function getStorageMetrics(): Promise<StorageMetrics> {
  try {
    // 获取 localStorage 使用情况
    const storageHealth = getStorageHealth();
    const localStoragePercent = storageHealth.percent;
    const localStorageBytes = storageHealth.usedBytes;

    // 获取 IDB 大小
    let idbBytes = 0;
    try {
      idbBytes = await estimateDBSize();
    } catch (error) {
      console.warn('[StorageMonitor] Failed to estimate IDB size:', error);
    }

    // 估算总存储（假设 localStorage 和 IDB 共享同一配额，通常 5-50MB）
    // 保守估计：总配额 = 50MB
    const ESTIMATED_TOTAL_QUOTA = 50 * 1024 * 1024; // 50 MB
    const totalUsed = localStorageBytes + idbBytes;
    const totalPercent = Math.round((totalUsed / ESTIMATED_TOTAL_QUOTA) * 100);

    return {
      localStorage: localStoragePercent,
      localStorageBytes,
      idb: Math.round((idbBytes / (1024 * 1024)) * 100) / 100, // 精确到 0.01 MB
      idbBytes,
      total: totalPercent,
      isDanger: totalPercent > 90 || localStoragePercent > 90,
      largestLocalStorageKeys: storageHealth.largestKeys,
      failureRate: calculateFailureRate(),
    };
  } catch (error) {
    console.error('[StorageMonitor] Error getting storage metrics:', error);
    return {
      localStorage: 0,
      localStorageBytes: 0,
      idb: 0,
      idbBytes: 0,
      total: 0,
      isDanger: false,
      largestLocalStorageKeys: [],
      failureRate: 0,
    };
  }
}

/**
 * 记录写入尝试（成功或失败）。
 * 用于计算写入失败率。
 */
export function recordWriteAttempt(success: boolean): void {
  writeAttempts++;
  if (!success) {
    writeFailures++;
  }

  // 定期重置统计
  if (writeAttempts % 100 === 0) {
    console.log(
      `[StorageMonitor] Write stats - Total: ${writeAttempts}, Failures: ${writeFailures}, ` +
      `Rate: ${calculateFailureRate()}%`
    );
  }
}

/**
 * 计算当前的写入失败率（百分比）。
 */
function calculateFailureRate(): number {
  if (writeAttempts === 0) return 0;
  return Math.round((writeFailures / writeAttempts) * 100);
}

/**
 * 重置失败率统计。
 * 通常每小时调用一次。
 */
export function resetFailureRateStats(): void {
  const oldAttempts = writeAttempts;
  const oldFailures = writeFailures;
  writeAttempts = 0;
  writeFailures = 0;
  console.log(
    `[StorageMonitor] Reset failure rate stats (previous: ${oldAttempts} attempts, ${oldFailures} failures)`
  );
}

/**
 * 启动定期失败率重置（每小时）。
 */
export function startPeriodicStatsReset(): void {
  if (typeof window === 'undefined') return;

  setInterval(() => {
    resetFailureRateStats();
  }, FAILURE_RATE_RESET_INTERVAL);

  console.log('[StorageMonitor] Periodic stats reset started (hourly)');
}

/**
 * 格式化存储指标为可读的字符串。
 */
export function formatStorageMetrics(metrics: StorageMetrics): string {
  return (
    `localStorage: ${metrics.localStorage}% (${formatBytes(metrics.localStorageBytes)})\n` +
    `IDB: ${metrics.idb} MB (${formatBytes(metrics.idbBytes)})\n` +
    `Total: ${metrics.total}%\n` +
    `Failure Rate: ${metrics.failureRate}%`
  );
}

/**
 * 获取存储使用的详细报告。
 */
export async function getDetailedStorageReport(): Promise<string> {
  const metrics = await getStorageMetrics();
  const report = [
    '=== Storage Metrics Report ===',
    formatStorageMetrics(metrics),
    '',
    'Largest localStorage keys:',
    ...metrics.largestLocalStorageKeys.map(
      (item) => `  ${item.key}: ${formatBytes(item.bytes)}`
    ),
    '',
    `Danger Status: ${metrics.isDanger ? 'YES (>90%)' : 'No'}`,
    `Write Failure Rate: ${metrics.failureRate}%`,
  ].join('\n');

  return report;
}

/**
 * 检查是否应该触发用户警告。
 * 返回 true 如果 localStorage > 80% 或 total > 90%。
 */
export async function shouldWarnUser(): Promise<boolean> {
  const metrics = await getStorageMetrics();
  return metrics.localStorage > 80 || metrics.isDanger;
}

/**
 * 获取最严重的存储问题的简述。
 */
export async function getStorageProblemSummary(): Promise<string | null> {
  const metrics = await getStorageMetrics();

  if (metrics.isDanger) {
    return `Storage is critical (${metrics.total}% used). Please clean up immediately.`;
  }

  if (metrics.localStorage > 80) {
    return `Local storage is nearly full (${metrics.localStorage}%). Consider cleaning up old data.`;
  }

  if (metrics.idb > 100) {
    return `IndexedDB is using ${metrics.idb} MB. This is high.`;
  }

  if (metrics.failureRate > 10) {
    return `Write failures are at ${metrics.failureRate}%. Storage may be unstable.`;
  }

  return null;
}

// 应用启动时自动启动定期统计重置
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    startPeriodicStatsReset();
  });
}
