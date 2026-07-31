/**
 * Phase 2 客户端前置分流 + 数据保护核心
 *
 * 统一模式：所有本地/云操作都通过 executeWithDataProtection 包装，确保：
 * 1. **先端上、端上答不了才打云**（2026-07-31 改；见 executeWithDataProtection 的说明）
 * 2. 本地操作先写 localStorage/IDB 作备份，确认成功后删除
 * 3. 网络失败自动标记为待重试，保留本地数据
 * 4. 错误消息清楚，用户明确知道为什么失败
 */

import { canUsePaidCloudAi } from './entitlement';
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
 * 端上这一趟**算不算答上了**。
 *
 * 默认判据是启发式的,所以调用方可以用 `localIsEnough` 自己判 —— 你比这里清楚
 * 「什么才算答上了」。启发式只覆盖这个仓里实际出现的几种返回形状:
 *
 *   · `null` / `undefined`               → 没答上
 *   · `{ ok: false }`                    → 处理器自己说没答上
 *   · `{ confidence: 0 }`                → 端上明说置信度为零(认不了字就是这个)
 *   · `{ nodes: [] }` 且没有 `text`      → 跑通了但什么也没产出
 *
 * 其余一律当答上了 —— **宁可少打一趟云**。判错的代价不对称:
 * 误判成「答上了」用户少一次云识别,误判成「没答上」就是白发一张图出门。
 */
function isUsableLocalResult(r: unknown): boolean {
  if (r === null || r === undefined) return false;
  if (typeof r !== 'object') return Boolean(r);
  const o = r as { ok?: unknown; confidence?: unknown; nodes?: unknown; text?: unknown; result?: unknown };
  if (o.ok === false) return false;
  if (typeof o.confidence === 'number' && o.confidence <= 0) return false;
  // 有的处理器把内容包在 result 里(local-tier0-handlers 那套),拆一层再看
  const inner = (o.result && typeof o.result === 'object') ? o.result as typeof o : o;
  const nodes = Array.isArray(inner.nodes) ? inner.nodes : (Array.isArray(o.nodes) ? o.nodes : null);
  const text = typeof inner.text === 'string' ? inner.text : (typeof o.text === 'string' ? o.text : null);
  if (nodes && nodes.length === 0 && (text === null || !text.trim())) return false;
  return true;
}

/**
 * 客户端前置分流 + 数据保护的统一模式
 *
 * @param action 操作类型（用于日志/监控）
 * @param input 输入数据（会被备份到 localStorage/IDB）
 * @param onDeviceHandler 端上处理器(先跑这个)
 * @param cloudHandler 云处理器(端上答不了才跑)
 * @param opts.localIsEnough 自定义「端上算答上了没」;不传走 isUsableLocalResult 的启发式
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
  cloudHandler: () => Promise<T>,
  opts: { localIsEnough?: (r: T) => boolean } = {}
): Promise<ExecutionResult<T>> {
  const startTime = Date.now();

  try {
    // 1. 本地持久化备份（写 localStorage + IDB）
    const localBackupKey = await saveToLocalStorage(`phase2-${action}`, input);
    const idbKey = await saveToIDB('phase2-queue', action, input);

    try {
      // ── 2. 选择路径:先端上,端上答不了才打云 ─────────────────────────────
      //
      // 这里原来分的是**钱**:`if (!canUsePaidCloudAi())` → 免费只准走端上、
      // 付费一律直奔云。两头都错:
      //   · 免费那头,端上认不出来就到此为止,用户拿到一句「本地处理失败」;
      //   · 付费那头,**连小票都发去云** —— 而小票上写的就是那些字,
      //     端上认一遍就有,发出去是慢、是花钱、是把票据送出门。
      //
      // 而且 workshop **不分收费免费**(2026-07-31 定):拿钱当分流依据在这个仓里
      // 等于把识别整个关掉。产品仓(nesio)的付费门在**服务端**
      // (guardAiRoute + requirePaidCloudAi),那才是拦得住的地方;
      // 客户端这一层的职责是「这件事该不该出门」,不是「这个人交没交钱」。
      //
      // 新规则只有一条:**端上给得出答案就不打云**。给不出(认不了字、
      // 或者问题本来就要「看懂图」)才打 —— 那时打云是必要的,不是偷懒。
      try {
        const result = await onDeviceHandler();
        if (opts.localIsEnough ? opts.localIsEnough(result) : isUsableLocalResult(result)) {
          await clearLocalBackup(localBackupKey);
          logDropped(`client-flow:tier0-success`, { action, duration: Date.now() - startTime });
          return { data: result, source: 'local' };
        }
        // 端上跑通了但没内容 —— 不是错误,是这条路答不了这个问题。往下走云。
        logDropped(`client-flow:tier0-empty`, { action });
      } catch (tierError) {
        // 端上失败也不是终点:还有云。但要记下来,否则「为什么每次都走云」查不出。
        logDropped(`client-flow:tier0-failed`, {
          action,
          error: tierError instanceof Error ? tierError.message : String(tierError),
        });
      }

      {
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
 * 后台被动增强用的简化版(不需要用户反馈,所以失败就静默)。
 *
 * ⚠️ 这条**保留付费门**,和上面那个函数不一样。区别在「谁按的」:
 * `executeWithDataProtection` 是用户点了按钮才跑 —— 他要的就是这个结果,
 * 端上给不出就该打云。而这里是**没人按**的后台富化,自己替用户花钱不合适。
 * (workshop 不分收费免费,所以这道门在这个仓里恒开;门留着是因为产品仓要它。)
 *
 * 目前全仓零调用点 —— 留着是给后台富化用的位置,不是遗漏。
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
