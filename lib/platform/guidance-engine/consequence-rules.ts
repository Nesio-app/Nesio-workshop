import type { GuidanceEventType, ConsequenceSeverity } from './types';

// If user does nothing about this event type — how bad?
const CONSEQUENCE: Record<GuidanceEventType, ConsequenceSeverity> = {
  flight:       3,  // miss the plane
  deadline:     3,  // miss deadline
  medical:      3,  // miss appointment
  meeting:      2,  // show up unprepared or miss it
  birthday:     2,  // forget to prepare / acknowledge
  anniversary:  2,  // forget
  travel:       2,  // unprepared for departure
  email_signal: 2,  // varies — default medium
  health_habit:   1,  // break a streak
  weather_cold:   1,  // uncomfortable
  weather_rain:   1,  // get wet
  object_context: 1,  // miss a relevant owned item — low stakes but useful
  dec_insight:    2,  // evidence-gated cross-domain recommendation
};

export function getConsequenceSeverity(type: GuidanceEventType): ConsequenceSeverity {
  return CONSEQUENCE[type] ?? 1;
}
