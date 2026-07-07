/**
 * 原语③·Recency —— 时效/衰减(proposal §2)。收敛 cooling-store 冷却计时 + dormant 的 touch/snooze 时钟。
 * 不订阅反馈总线(时效吃的是"上次何时见过"这个时间戳)。
 */

import { loadJson, saveJson } from './persist';

const KEY = 'nesio-recency-v1';

type RecencyState = Record<string, string>; // key → 上次 ISO

export interface CooldownPolicy {
  baseMs: number;       // 基础冷却
  factor?: number;      // 连续 dismiss 的倍增因子(可选,配合外部计数)
  dismissCount?: number;
}

/** 记一次"见过/触达"。 */
export function markSeen(key: string, at: string = new Date().toISOString()): void {
  const st = loadJson<RecencyState>(KEY, {});
  st[key] = at;
  saveJson(KEY, st);
}

/** 距上次见过多久(ms);从没见过 → null。 */
export function sinceSeen(key: string, now: Date = new Date()): number | null {
  const raw = loadJson<RecencyState>(KEY, {})[key];
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

/** 冷却剩余(ms):0 = 冷却已过、可再出。dismissCount 越多冷却越长(factor^count)。 */
export function cooldownRemaining(key: string, policy: CooldownPolicy, now: Date = new Date()): number {
  const since = sinceSeen(key, now);
  if (since == null) return 0; // 没见过 → 不冷却
  const mult = policy.factor && policy.dismissCount ? Math.pow(policy.factor, policy.dismissCount) : 1;
  return Math.max(0, policy.baseMs * mult - since);
}
