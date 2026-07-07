/**
 * 原语①·Preference —— 反馈→权重(proposal §2)。收敛 mirror(领域)/ analyst(alert_type)/
 * signal-feedback(card_type)各写一遍的"log-toward-target"。mirror 后续升级为它的规范实现。
 *
 * 数学:EWMA 逼近目标(reaction→target)。冷启动 0.5(不知道 = 中性)。
 * 只对**可复用键**的维度自动折权重(domain/card_type/alert_type/merchant);per-card 之类唯一键不记,
 * 免无界增长。
 */

import { loadJson, saveJson } from './persist';
import { onFeedback, type Reaction } from './feedback-bus';

const KEY = 'nesio-preference-v1';
const ALPHA = 0.15;
const PREFERENCE_DIMENSIONS = new Set(['domain', 'card_type', 'alert_type', 'merchant']);

type PrefState = Record<string, Record<string, number>>; // dimension → key → weight[0,1]

const REACTION_TARGET: Record<Reaction, number> = {
  useful: 1, done: 1,       // 采纳/完成 → 拉高
  wrong: 0, dismiss: 0, too_much: 0, // 否定/关闭/太多 → 拉低
  snooze: 0.35,             // 延后 → 轻微负向
};

export function recordPreference(dimension: string, key: string, reaction: Reaction): void {
  const st = loadJson<PrefState>(KEY, {});
  const dim = st[dimension] || (st[dimension] = {});
  const cur = typeof dim[key] === 'number' ? dim[key] : 0.5; // 冷启动中性
  dim[key] = Math.max(0, Math.min(1, cur + ALPHA * (REACTION_TARGET[reaction] - cur)));
  saveJson(KEY, st);
}

export function getWeight(dimension: string, key: string): number {
  const v = loadJson<PrefState>(KEY, {})[dimension]?.[key];
  return typeof v === 'number' ? v : 0.5;
}

export function getWeights(dimension: string): Record<string, number> {
  return { ...(loadJson<PrefState>(KEY, {})[dimension] || {}) };
}

// 订阅:可复用维度的反馈自动折进权重(一个反馈训所有面的入口之一)。
onFeedback((e) => {
  if (PREFERENCE_DIMENSIONS.has(e.dimension)) recordPreference(e.dimension, e.key, e.reaction);
});
