import type { GuidanceEventType, ConsequenceSeverity } from './types';

// If user does nothing about this event type — how bad?
const CONSEQUENCE: Record<GuidanceEventType, ConsequenceSeverity> = {
  flight:       3,  // miss the plane
  deadline:     3,  // miss deadline
  medical:      3,  // miss appointment
  meeting:      2,  // show up unprepared or miss it
  birthday:     2,  // forget to prepare / acknowledge
  anniversary:  2,  // forget
  holiday:      1,  // 节日提示 — 低打扰,只是提醒可以安排活动
  travel:       2,  // unprepared for departure
  email_signal: 2,  // varies — default medium
  health_habit:   1,  // break a streak
  health_insight: 2,  // 指南级健康判定(红旗/风险带)— 值得温和提示,但由后续多层门控降噪
  weather_cold:   1,  // uncomfortable
  weather_rain:   1,  // get wet
  object_context: 1,  // miss a relevant owned item — low stakes but useful
  dec_insight:    2,  // evidence-gated cross-domain recommendation
};

export function getConsequenceSeverity(type: GuidanceEventType): ConsequenceSeverity {
  return CONSEQUENCE[type] ?? 1;
}
