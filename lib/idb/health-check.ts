/**
 * lib/idb/health-check.ts — IDB 健康检查和诊断
 *
 * 定期检查 IDB 的健康状态，包括：
 * - 可写性测试
 * - 数据完整性验证
 * - 冲突检测
 * - 配额监控
 *
 * 失败时上报到 /api/portal/diagnostics 接口。
 */

import { initializeDB, getStore, StoreName, checkQuota } from './idb-core';
import { getStorageMetrics } from './storage-monitor';
import { isFallbackActive } from './rollback';
import { verifyIntegrity, getGlobalLamportClock } from './version-manager';

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟
const DIAGNOSTICS_BATCH_SIZE = 10; // 每批最多上报 10 条

interface HealthCheckResult {
  timestamp: number;
  isHealthy: boolean;
  checks: {
    writable: boolean;
    quotaOk: boolean;
    dataIntegrity: boolean;
    conflictDetection: boolean;
  };
  metrics: {
    usedBytes: number;
    quotaBytes: number;
    quotaPercent: number;
  };
  errors: string[];
  fallbackActive: boolean;
  lamportClock: number;
}

interface DiagnosticEvent {
  timestamp: number;
  severity: 'info' | 'warning' | 'error';
  type: string;
  message: string;
  details?: Record<string, any>;
}

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let diagnosticQueue: DiagnosticEvent[] = [];
let lastDiagnosticsReportTime = 0;
const DIAGNOSTICS_REPORT_INTERVAL = 60 * 1000; // 1 分钟批量上报一次

/**
 * 执行完整的健康检查。
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const timestamp = Date.now();
  const errors: string[] = [];
  const checks = {
    writable: false,
    quotaOk: false,
    dataIntegrity: false,
    conflictDetection: false,
  };

  try {
    // 检查 1: 可写性
    try {
      checks.writable = await checkWritability();
    } catch (error) {
      errors.push(`Writable check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 检查 2: 配额
    try {
      const quota = await checkQuota();
      checks.quotaOk = quota.usage < quota.quota * 0.95; // 允许 95% 使用
    } catch (error) {
      errors.push(`Quota check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 检查 3: 数据完整性
    try {
      checks.dataIntegrity = await checkDataIntegrity();
    } catch (error) {
      errors.push(`Data integrity check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 检查 4: 冲突检测
    try {
      checks.conflictDetection = await checkConflicts();
    } catch (error) {
      errors.push(`Conflict detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 获取指标
    const quota = await checkQuota();
    const metrics = {
      usedBytes: quota.usage,
      quotaBytes: quota.quota,
      quotaPercent: Math.round((quota.usage / quota.quota) * 100),
    };

    const isHealthy = checks.writable && checks.quotaOk && checks.dataIntegrity;

    const result: HealthCheckResult = {
      timestamp,
      isHealthy,
      checks,
      metrics,
      errors,
      fallbackActive: isFallbackActive(),
      lamportClock: getGlobalLamportClock(),
    };

    // 记录检查结果
    if (!isHealthy) {
      recordDiagnostic('warning', 'health-check-failed', 'Health check detected issues', {
        checks,
        errors,
      });
    } else {
      recordDiagnostic('info', 'health-check-passed', 'Health check passed', {
        quotaPercent: metrics.quotaPercent,
      });
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordDiagnostic('error', 'health-check-exception', 'Health check threw exception', {
      error: errorMsg,
    });

    return {
      timestamp,
      isHealthy: false,
      checks: {
        writable: false,
        quotaOk: false,
        dataIntegrity: false,
        conflictDetection: false,
      },
      metrics: { usedBytes: 0, quotaBytes: 0, quotaPercent: 0 },
      errors: [errorMsg],
      fallbackActive: isFallbackActive(),
      lamportClock: getGlobalLamportClock(),
    };
  }
}

/**
 * 检查数据库可写性。
 */
async function checkWritability(): Promise<boolean> {
  try {
    const db = await initializeDB();
    const store = getStore(db, 'ui-cache', 'readwrite');

    const testId = `__health-check-${Date.now()}`;
    const testData = { key: testId, value: 'test', timestamp: Date.now() };

    return new Promise((resolve) => {
      const request = store.put(testData);

      const timeout = setTimeout(() => {
        console.warn('[HealthCheck] Writability check timed out');
        resolve(false);
      }, 5000);

      request.onsuccess = () => {
        clearTimeout(timeout);
        // 清理测试数据
        const deleteReq = store.delete(testId);
        deleteReq.onerror = () => console.warn('[HealthCheck] Failed to clean up test data');
        resolve(true);
      };

      request.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  } catch (error) {
    console.warn('[HealthCheck] Writability check exception:', error);
    return false;
  }
}

/**
 * 检查数据完整性。
 * 验证关键表中是否有损坏的记录。
 */
async function checkDataIntegrity(): Promise<boolean> {
  try {
    // 简化版本：检查主要表是否可读
    const db = await initializeDB();
    const tablesToCheck: StoreName[] = ['signals', 'user_module_data', 'ui-cache'];

    for (const table of tablesToCheck) {
      try {
        const store = getStore(db, table, 'readonly');
        await new Promise<void>((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(`[HealthCheck] Failed to read ${table}:`, error);
        return false;
      }
    }

    // 验证版本完整性
    try {
      await verifyIntegrity();
    } catch (error) {
      console.warn('[HealthCheck] Version integrity check failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[HealthCheck] Data integrity check exception:', error);
    return false;
  }
}

/**
 * 检查是否存在数据冲突。
 * 检测版本冲突或重复键。
 */
async function checkConflicts(): Promise<boolean> {
  try {
    // 检查是否存在多个版本的同一数据
    // 这是简化版本，实际应该遍历所有表并检查版本标记
    const db = await initializeDB();
    const store = getStore(db, 'signals', 'readonly');

    return new Promise((resolve) => {
      const request = store.getAll();

      const timeout = setTimeout(() => {
        console.warn('[HealthCheck] Conflict check timed out');
        resolve(false);
      }, 5000);

      request.onsuccess = () => {
        clearTimeout(timeout);
        // 简单检查：不应该有 null/undefined 的关键字段
        const records = request.result as any[];
        const hasConflicts = records.some((r) => !r.id || !r.createdAt);
        resolve(!hasConflicts);
      };

      request.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  } catch (error) {
    console.warn('[HealthCheck] Conflict check exception:', error);
    return false;
  }
}

/**
 * 记录诊断事件。
 */
export function recordDiagnostic(
  severity: 'info' | 'warning' | 'error',
  type: string,
  message: string,
  details?: Record<string, any>
): void {
  const event: DiagnosticEvent = {
    timestamp: Date.now(),
    severity,
    type,
    message,
    details,
  };

  diagnosticQueue.push(event);

  // 如果是错误级别，立即上报
  if (severity === 'error') {
    void flushDiagnostics();
  }

  // 定期上报（防止频繁的网络请求）
  if (Date.now() - lastDiagnosticsReportTime > DIAGNOSTICS_REPORT_INTERVAL) {
    void flushDiagnostics();
  }
}

/**
 * 批量上报诊断事件到后端。
 */
export async function flushDiagnostics(): Promise<void> {
  if (diagnosticQueue.length === 0) {
    return;
  }

  try {
    // 分批上报，防止单个请求过大
    while (diagnosticQueue.length > 0) {
      const batch = diagnosticQueue.splice(0, DIAGNOSTICS_BATCH_SIZE);

      await fetch('/api/portal/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: batch,
          clientTime: new Date().toISOString(),
        }),
      }).catch((error) => {
        console.warn('[HealthCheck] Failed to flush diagnostics:', error);
        // 重新加入队列供下次上报
        diagnosticQueue.unshift(...batch);
      });

      lastDiagnosticsReportTime = Date.now();
    }
  } catch (error) {
    console.error('[HealthCheck] Error flushing diagnostics:', error);
  }
}

/**
 * 启动定期健康检查。
 */
export function startPeriodicHealthCheck(): void {
  if (healthCheckTimer !== null) {
    return; // 已在运行
  }

  console.log('[HealthCheck] Starting periodic health check');
  healthCheckTimer = setInterval(async () => {
    try {
      const result = await performHealthCheck();
      if (!result.isHealthy) {
        console.warn('[HealthCheck] Health check failed:', result);
      }
    } catch (error) {
      console.error('[HealthCheck] Periodic health check error:', error);
    }
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * 停止定期健康检查。
 */
export function stopPeriodicHealthCheck(): void {
  if (healthCheckTimer !== null) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[HealthCheck] Periodic health check stopped');
  }
}

/**
 * 获取诊断队列中待上报的事件数。
 */
export function getPendingDiagnosticsCount(): number {
  return diagnosticQueue.length;
}

/**
 * 获取完整的诊断报告。
 */
export async function getDiagnosticsReport(): Promise<Record<string, any>> {
  const healthCheck = await performHealthCheck();
  const storageMetrics = await getStorageMetrics();

  return {
    timestamp: new Date().toISOString(),
    health: healthCheck,
    storage: storageMetrics,
    pendingDiagnostics: getPendingDiagnosticsCount(),
  };
}

// 应用启动时自动启动
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    startPeriodicHealthCheck();

    // 页面卸载时上报待处理的诊断事件
    window.addEventListener('beforeunload', () => {
      void flushDiagnostics();
    });
  });
}
