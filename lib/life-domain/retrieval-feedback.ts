/**
 * 开放世界 ④(用户自学 · 检索反馈闭环)。
 *
 * 「问一问」的引用来源里,用户点「不是这个」= 一条一等公民事实(Signal,type
 * feedback.retrieval),而非某设备本地的一次性 UI 状态。这样它跟其余记忆一样跨端同步、
 * 可导出/可删除(数据主权),换设备也不丢;下一次检索到同一目标即自动降权/剔除,检索越用越准。
 *
 * targetId 用被检索信号的稳定键(evidence.externalId 优先,回退 signal.id)—— 与
 * signal-search.retrievalKey 对齐,保证反馈落在同一目标上。
 */
import { createSignal } from './create-signal';
import { getSignals } from './signal';

export const RETRIEVAL_FEEDBACK_TYPE = 'feedback.retrieval';

export type RetrievalVerdict = 'not_this' | 'useful';

/** 「不是这个」:强降权到检索阈值之下,等同剔除(负得足够大,盖过任何相关性分)。 */
const NOT_THIS_PENALTY = -100;
/** 「有用」:轻微加权,把用户确认过的来源往前提一点(不喧宾夺主)。 */
const USEFUL_BOOST = 2;

let adjustmentCache: Map<string, RetrievalVerdict> | null = null;

if (typeof window !== 'undefined') {
  const invalidate = () => {
    adjustmentCache = null;
  };
  // 图谱写入 / 云端回灌后反馈集可能变化,失效缓存下次重建(反馈本身也是图谱节点)。
  window.addEventListener('nesio-life-graph-updated', invalidate);
  window.addEventListener('nesio-life-graph-cloud-hydrated', invalidate);
}

function buildAdjustments(): Map<string, RetrievalVerdict> {
  const map = new Map<string, RetrievalVerdict>();
  // 按 capturedAt 倒序(getSignals 已排),同一 target 取最新一条裁决(用户可改主意)。
  for (const signal of getSignals({ types: [RETRIEVAL_FEEDBACK_TYPE] })) {
    const payload = signal.payload || {};
    const targetId = typeof payload.targetId === 'string' ? payload.targetId : '';
    const verdict =
      payload.verdict === 'not_this' || payload.verdict === 'useful' ? (payload.verdict as RetrievalVerdict) : null;
    if (targetId && verdict && !map.has(targetId)) map.set(targetId, verdict);
  }
  return map;
}

function adjustments(): Map<string, RetrievalVerdict> {
  if (!adjustmentCache) adjustmentCache = buildAdjustments();
  return adjustmentCache;
}

/**
 * 记录一条检索反馈(落成 Signal → 跨端同步、可导出/删除)。best-effort:targetId 缺失即跳过。
 */
export function markRetrievalFeedback(targetId: string, verdict: RetrievalVerdict): void {
  if (!targetId) return;
  createSignal({
    source: 'manual',
    type: RETRIEVAL_FEEDBACK_TYPE,
    title: `检索反馈:${verdict === 'not_this' ? '不是这个' : '有用'}`,
    payload: { targetId, verdict },
    confidence: 1,
    retentionPolicy: 'LongLiving',
    tags: ['feedback', 'retrieval'],
    raw: `${targetId} ${verdict}`,
    epistemic: 'feedback',
    generator: 'user',
    derivedFrom: [targetId],
  });
  adjustmentCache = null; // 立即生效(不等事件回环),本次会话即降权
}

/** 检索打分调整量:not_this → 强负;useful → 轻正;无反馈 → 0。 */
export function retrievalScoreAdjust(targetId: string): number {
  const verdict = adjustments().get(targetId);
  if (!verdict) return 0;
  return verdict === 'not_this' ? NOT_THIS_PENALTY : USEFUL_BOOST;
}

/** 是否被用户标为「不是这个」(检索候选应直接剔除)。 */
export function isDownranked(targetId: string): boolean {
  return adjustments().get(targetId) === 'not_this';
}
