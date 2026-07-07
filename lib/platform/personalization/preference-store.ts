/**
 * 原语①·Preference —— 反馈→权重(proposal §2)。规范实现:mirror(domain)/ analyst(alert_type)/
 * signal-feedback(card_type)/ bank(merchant)统一从这里读写权重。
 *
 * 数学:EWMA-toward-target(mirror 的原更新律,2a 收编时逐字保留)。冷启动 0.5(不知道=中性)。
 * **反应→目标按维度可插**:同一个 snooze,对 domain 是"时机不对不罚题材"(跳过),对 alert_type
 * 可以是轻负向 —— 语义属于维度,不属于底座(不统一数学的边界落在这)。
 * 只对**可复用键**的维度自动折权重(domain/card_type/alert_type/merchant);per-card 唯一键不记,免无界增长。
 */

import { loadJson, saveJson } from './persist';
import { onFeedback, type Reaction } from './feedback-bus';

const KEY = 'nesio-preference-v1';
const PREFERENCE_DIMENSIONS = new Set(['domain', 'card_type', 'alert_type', 'merchant']);

type PrefState = Record<string, Record<string, number>>; // dimension → key → weight[0,1]

/** 一条反应策略:目标值 + 学习率;null = 该反应不动这个维度的权重。 */
type ReactionRule = { target: number; alpha: number } | null;
type ReactionPolicy = Record<Reaction, ReactionRule>;

const BASE_ALPHA = 0.15;

/** 默认策略(通用维度):否定拉低、采纳拉高、延后轻负向。 */
const DEFAULT_POLICY: ReactionPolicy = {
  useful: { target: 1, alpha: BASE_ALPHA },
  done: { target: 1, alpha: BASE_ALPHA },
  wrong: { target: 0, alpha: BASE_ALPHA },
  dismiss: { target: 0.2, alpha: BASE_ALPHA },
  too_much: { target: 0, alpha: BASE_ALPHA * 1.4 },
  snooze: { target: 0.35, alpha: BASE_ALPHA },
};

/** domain 维度 = mirror 的原语义:wrong 留底(0.2 不清零);snooze/dismiss 是时机问题,不罚题材。 */
const DOMAIN_POLICY: ReactionPolicy = {
  ...DEFAULT_POLICY,
  wrong: { target: 0.2, alpha: BASE_ALPHA },
  snooze: null,
  dismiss: null,
};

const POLICIES: Record<string, ReactionPolicy> = { domain: DOMAIN_POLICY };

export function recordPreference(dimension: string, key: string, reaction: Reaction): void {
  const rule = (POLICIES[dimension] ?? DEFAULT_POLICY)[reaction];
  if (!rule) return; // 该反应对这个维度无权重含义(如 domain 的 snooze)
  const st = loadJson<PrefState>(KEY, {});
  const dim = st[dimension] || (st[dimension] = {});
  const cur = typeof dim[key] === 'number' ? dim[key] : 0.5; // 冷启动中性
  dim[key] = Math.max(0, Math.min(1, cur + rule.alpha * (rule.target - cur)));
  saveJson(KEY, st);
}

export function getWeight(dimension: string, key: string): number {
  const v = loadJson<PrefState>(KEY, {})[dimension]?.[key];
  return typeof v === 'number' ? v : 0.5;
}

export function getWeights(dimension: string): Record<string, number> {
  return { ...(loadJson<PrefState>(KEY, {})[dimension] || {}) };
}

/**
 * 迁移/云回灌入口:把一批旧权重灌进某维度(旧 store 收编 / loadMirrorFromCloud 采纳云侧时用)。
 * overwrite=false 时只补缺(本地已学的不被旧数据盖掉)。
 */
export function seedPreferenceWeights(
  dimension: string,
  weights: Record<string, number>,
  { overwrite = false }: { overwrite?: boolean } = {},
): void {
  const entries = Object.entries(weights).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  if (!entries.length) return;
  const st = loadJson<PrefState>(KEY, {});
  const dim = st[dimension] || (st[dimension] = {});
  for (const [k, v] of entries) {
    if (overwrite || typeof dim[k] !== 'number') dim[k] = Math.max(0, Math.min(1, v));
  }
  saveJson(KEY, st);
}

/** 重置某维度(mirror 的 reset / 隐私清除用)。 */
export function resetPreferenceDimension(dimension: string): void {
  const st = loadJson<PrefState>(KEY, {});
  if (!(dimension in st)) return;
  delete st[dimension];
  saveJson(KEY, st);
}

// 订阅:可复用维度的反馈自动折进权重(一个反馈训所有面的入口之一)。
onFeedback((e) => {
  if (PREFERENCE_DIMENSIONS.has(e.dimension)) recordPreference(e.dimension, e.key, e.reaction);
});
