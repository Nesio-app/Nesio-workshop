import type { GuidanceEventType, ConsequenceSeverity } from './types';

// If user does nothing about this event type — how bad?
const CONSEQUENCE: Record<GuidanceEventType, ConsequenceSeverity> = {
  flight:       3,  // miss the plane
  deadline:     3,  // miss deadline
  expiry:       2,  // 食物/物品浪费 —— 有实际损失但不到误机级
  renewal:      3,  // 证件过期/过保 —— 误了要重办或自费维修,代价高
  medical:      3,  // miss appointment
  meeting:      2,  // show up unprepared or miss it
  birthday:     2,  // forget to prepare / acknowledge
  anniversary:  2,  // forget
  holiday:      1,  // 节日提示 — 低打扰,只是提醒可以安排活动
  travel:       2,  // unprepared for departure
  email_signal: 2,  // varies — default medium
  health_habit:   1,  // break a streak
  domain_insight: 2,  // 各域指南级判定(健康红旗/财务异常…)— 值得温和提示,后续多层门控降噪
  weather_cold:   1,  // uncomfortable
  weather_rain:   1,  // get wet
  object_context: 1,  // miss a relevant owned item — low stakes but useful
  dec_insight:    2,  // evidence-gated cross-domain recommendation
};

export function getConsequenceSeverity(type: GuidanceEventType): ConsequenceSeverity {
  return CONSEQUENCE[type] ?? 1;
}
