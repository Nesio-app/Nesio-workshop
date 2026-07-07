/**
 * Personalization Capacity —— 统一学习底座(A 计划 Layer 2)。
 * 单一入口:各 surface 只调 emitFeedback;学习层集中消费(事实日志 + 三原语),更新律各留可插。
 * 见 `docs/design/algorithm-layer-plan.md` / `docs/personalization-capacity-proposal.md`。
 *
 * 引入本 index 即触发订阅者注册(feedback-log / preference)。故消费方 import '@/lib/platform/personalization'。
 */

export { emitFeedback, onFeedback, type FeedbackEvent, type Reaction } from './feedback-bus';
export { readFeedbackLog, replayFeedback } from './feedback-log';
export { recordPreference, getWeight, getWeights, seedPreferenceWeights, resetPreferenceDimension } from './preference-store';
export { foldSample, baseline, zScore, ewmaState, seedEwma, type Estimator } from './baseline-store';
export { markSeen, sinceSeen, cooldownRemaining, type CooldownPolicy } from './recency-store';

// 副作用引入:确保 feedback-log / preference-store 的 onFeedback 订阅在首次 emit 前已注册。
import './feedback-log';
import './preference-store';
