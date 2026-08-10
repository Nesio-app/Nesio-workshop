/**
 * Today 统一仲裁器 —— 架构审查 #2:「Today 显示什么」的唯一 presence 裁决点。
 *
 * 四套选择系统(guidance 管线 / attention 置顶 / dormant 复访 / DEC→guidance)
 * 各自保留内部预算与冷却(原子记录原则:cooling/dormant 存储不拆),但
 * **同一个节点出现在哪个槽位,只有这里说了算**。优先级:
 *
 *   置顶(pinned) > 复访卡(dormant) > 引导卡(guidance) > 折叠任务列表
 *
 * 规则:
 *  1. 复访候选若已被置顶 → 复访卡不出(置顶赢)。
 *  2. 引导卡引用的节点若已被置顶 → 该卡不渲染(由 TodayFeed 按回传的置顶 id 过滤)。
 *  3. 任务列表排除:置顶、复访候选、被引导卡认领且 **>24h** 的节点 —— 每个节点一天只在一个地方见到。
 *  4. **24h 分界**(图5):事件 ≤24h → 时间线地盘(压引导卡);>24h → 提醒卡地盘(时间线剔除)。
 *     无时间的认领保持旧语义(引导卡赢、时间线剔除)。
 *
 * 阶段 2(未做,记账):把 pinned 计算从 FocusSection 提升到组合根,让 guidance
 * 管线在 commitShown 前就知道置顶,消除"卡被隐藏但已记 shown"的记账小误差。
 */

export const TODAY_NEAR_MS = 86_400_000;

export interface TodayPresenceInput {
  pinnedId: string | null;
  dormantCandidateId: string | null;
  taskIds: readonly string[];
  /** 引导卡认领的节点 id(ProactiveCard.nodeId) */
  guidanceClaims: readonly string[];
  /** 认领节点的事件时刻(ms)。缺省 → 按旧规则(引导卡赢) */
  claimAtMs?: Readonly<Record<string, number>>;
  nowMs?: number;
}

export interface TodayPresenceVerdict {
  showDormant: boolean;
  /** 过滤后的任务列表 id */
  taskIds: string[];
  /** 需要隐藏的引导卡节点 id(被置顶抢占,或 ≤24h 归时间线) */
  suppressGuidanceNodeIds: Set<string>;
}

export function arbitrateTodayPresence(input: TodayPresenceInput): TodayPresenceVerdict {
  const { pinnedId, dormantCandidateId, taskIds, guidanceClaims, claimAtMs, nowMs = Date.now() } = input;
  const claims = new Set(guidanceClaims);

  const showDormant = dormantCandidateId != null && dormantCandidateId !== pinnedId;

  const suppressGuidanceNodeIds = new Set<string>();
  if (pinnedId && claims.has(pinnedId)) suppressGuidanceNodeIds.add(pinnedId);

  // ≤24h → 时间线赢:压掉引导卡,节点留在任务列表
  for (const c of claims) {
    const at = claimAtMs?.[c];
    if (typeof at === 'number' && Number.isFinite(at) && at - nowMs <= TODAY_NEAR_MS) {
      suppressGuidanceNodeIds.add(c);
    }
  }

  const taken = new Set<string>();
  if (pinnedId) taken.add(pinnedId);
  if (showDormant && dormantCandidateId) taken.add(dormantCandidateId);
  for (const c of claims) {
    if (suppressGuidanceNodeIds.has(c)) continue;
    taken.add(c);
  }

  return {
    showDormant,
    taskIds: taskIds.filter((id) => !taken.has(id)),
    suppressGuidanceNodeIds,
  };
}
