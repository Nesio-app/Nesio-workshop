/**
 * Phase 2 客户端前置分流 + 数据保护核心
 *
 * 统一模式：所有本地/云操作都通过 executeWithDataProtection 包装，确保：
 * 1. 免费用户走 Tier 0（端上兜底），付费用户走云端
 * 2. 本地操作先写 localStorage/IDB 作备份，确认成功后删除
 * 3. 网络失败自动标记为待重试，保留本地数据
 * 4. 错误消息清楚，用户明确知道为什么失败
 */

import { canUsePaidCloudAi, guardPaidCloudAi } from './entitlement';
import { logDropped } from './storage-health';
import {
  saveToLocalStorage,
  saveToIDB,
  clearLocalBackup,
  markAsRetryNeeded,
  getRetryQueue,
  type RetryQueueItem,
} from './data-protection-layer';

export interface ExecutionResult<T> {
  data: T;
  source: 'local' | 'cloud';
  confidence?: number; // Tier 0 本地结果的置信度
}

export type ActionType = 'image' | 'voice' | 'sync' | 'search' | 'embed';

/**
 * 客户端前置分流 + 数据保护的统一模式
 *
 * @param action 操作类型（用于日志/监控）
 * @param input 输入数据（会被备份到 localStorage/IDB）
 * @param onDeviceHandler 免费 Tier 0 处理器（端上/本地）
 * @param cloudHandler 付费云处理器
 * @returns 结果及来源标记
 *
 * 使用示例：
 * ```
 * const result = await executeWithDataProtection(
 *   'image',
 *   file,
 *   async () => recognizeImageLocally(file),  // Tier 0
 *   async () => cloudAnalyzeImage(file)        // Cloud
 * );
 * if (result.source === 'local') showLocalLimit('端上识别');
 * else showResult(result.data);
 * ```
 */
export async function executeWithDataProtection<T>(
  action: ActionType,
  input: any,
  onDeviceHandler: () => Promise<T>,
  cloudHandler: () => Promise<T>
): Promise<ExecutionResult<T>> {
  const startTime = Date.now();

  try {
    // 1. 本地持久化备份（写 localStorage + IDB）
    const localBackupKey = await saveToLocalStorage(`phase2-${action}`, input);
    const idbKey = await saveToIDB('phase2-queue', action, input);

    try {
      // 2. 选择路径
      if (!canUsePaidCloudAi()) {
        // 免费：本地 Tier 0（绝不触发付费云）
        try {
          const result = await onDeviceHandler();
          // 成功后清除本地备份
          await clearLocalBackup(localBackupKey);
          logDropped(`client-flow:tier0-success`, {
            action,
            duration: Date.now() - startTime,
          });
          return { data: result, source: 'local' };
        } catch (tierError) {
          // Tier 0 失败：保留备份，标记为待重试
          await markAsRetryNeeded(idbKey, tierError);
          logDropped(`client-flow:tier0-failed`, {
            action,
            error: tierError instanceof Error ? tierError.message : String(tierError),
          });
          throw new Error(
            `本地处理失败，请检查网络后重试 (${action})`
          );
        }
      } else {
        // 付费：云端
        if (!guardPaidCloudAi(action)) {
          // 用户升级门被拦了
          await markAsRetryNeeded(idbKey, new Error('user-canceled-pro-gate'));
          throw new Error('请升级到 Pro 以使用此功能');
        }

        try {
          const result = await cloudHandler();
          // 成功后清除本地备份
          await clearLocalBackup(localBackupKey);
          logDropped(`client-flow:cloud-success`, {
            action,
            duration: Date.now() - startTime,
          });
          return { data: result, source: 'cloud' };
        } catch (cloudError) {
          // 云端失败：保留备份，标记为待重试
          await markAsRetryNeeded(idbKey, cloudError);
          logDropped(`client-flow:cloud-failed`, {
            action,
            error: cloudError instanceof Error ? cloudError.message : String(cloudError),
          });
          throw new Error(
            `云端处理失败，已保存到离线队列，请检查网络后重试 (${action})`
          );
        }
      }
    } catch (flowError) {
      // 流程本身出错（不是业务处理失败）
      await markAsRetryNeeded(idbKey, flowError);
      throw flowError;
    }
  } catch (error) {
    // 最外层捕获：记录并重新抛出
    logDropped(`client-flow:fatal`, {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 可选的简化版：仅用于后台被动增强（不需要用户反馈）
 * 免费 → 静默跳过；付费 → 后台执行
 */
export async function executeBackgroundCloudOnly<T>(
  action: ActionType,
  input: any,
  cloudHandler: () => Promise<T>
): Promise<T | null> {
  // 后台操作不需要用户确认，直接检查权限
  if (!canUsePaidCloudAi()) return null;

  try {
    const idbKey = await saveToIDB('phase2-bg-queue', action, input);
    try {
      const result = await cloudHandler();
      return result;
    } catch (error) {
      await markAsRetryNeeded(idbKey, error);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * 获取当前离线队列（监控面板用）
 */
export async function getOfflineQueueStatus() {
  return getRetryQueue();
}
