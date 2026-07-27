/**
 * 反馈总线 —— A 计划 Layer 2 的统一入口(取代散落各 surface 的手工 fan-out)。
 * 一次用户反馈 → emitFeedback 一处 → 扇出到订阅者(事实日志 + Preference 等)。
 * guidance-ranker / bandit 学习接线已退役(2026-07-27)。
 *
 * schema 依 `docs/personalization-capacity-proposal.md §2`:`{ surface, dimension, key, reaction }`。
 * 纯内存分发,不落库(落库由 feedback-log 作为订阅者完成 —— collect first, derive second)。
 * 事件名兼容旧 `nesio-feedback-recorded`:旧派发点保留,useTodayData 把它翻成 FeedbackEvent 投进来。
 */

/** 统一反馈动词(proposal §2)。not_now 等旧动词在边界处映射到这套。 */
export type Reaction = 'useful' | 'dismiss' | 'wrong' | 'done' | 'snooze' | 'too_much';

export interface FeedbackEvent {
  surface: string;    // 来源面:'today' | 'insights' | 'finance' | ...
  dimension: string;  // 学习维度:'card' | 'domain' | 'card_type' | 'alert_type' | ...
  key: string;        // 维度内的键:cardId / domain 名 / 商户名 ...
  reaction: Reaction;
  at: string;         // ISO
}

type FeedbackHandler = (e: FeedbackEvent) => void;
const handlers = new Set<FeedbackHandler>();

/** 订阅:此后每次 emitFeedback 都会收到。返回注销函数。 */
export function onFeedback(handler: FeedbackHandler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/**
 * 一次反馈扇出到所有订阅者。best-effort 隔离:单个订阅者抛错不拖垮其余
 * (拍快照遍历,允许 handler 在回调里注销自己)。
 */
export function emitFeedback(event: FeedbackEvent): void {
  for (const h of [...handlers]) {
    try { h(event); } catch { /* 单订阅者失败不影响其余 */ }
  }
}

/** 供测试:清空订阅,避免用例间串扰。 */
export function _resetFeedbackBus(): void {
  handlers.clear();
}
