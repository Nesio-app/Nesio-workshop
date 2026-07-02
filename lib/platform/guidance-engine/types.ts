/**
 * Guidance Engine — core types
 *
 * GuidanceEvent: a raw event from any source (calendar, email, memory, weather)
 * GuidanceCard:  a card that has passed all pipeline layers and is ready to show
 */

export type GuidanceEventType =
  | 'flight' | 'medical' | 'deadline' | 'birthday' | 'anniversary'
  | 'travel' | 'meeting'
  | 'email_signal' | 'health_habit'
  | 'weather_cold' | 'weather_rain';

export type GuidanceSource = 'calendar' | 'email' | 'memory' | 'weather' | 'habit';

export interface GuidanceEvent {
  id: string;
  type: GuidanceEventType;
  title: string;
  scheduledAt?: Date;  // when the thing happens (flight time, birthday, meeting start, etc.)
  source: GuidanceSource;
  payload: Record<string, unknown>;  // source-specific data for action building
}

// How bad is it if the user does nothing?
// 0 = no real consequence, 3 = serious (miss flight, miss deadline)
export type ConsequenceSeverity = 0 | 1 | 2 | 3;

// Is the action window currently open?
// 'closed' = not the right time yet (or already too late)
export type WindowUrgency = 'closed' | 'low' | 'medium' | 'high' | 'critical';

// How much of today's attention is already committed to calendar events
export type AttentionBudget = 'ample' | 'limited' | 'exhausted';

export interface GuidanceAction {
  label: string;       // 1-minute first step, shown in card body
  cta: string;         // button text
  actionType: 'dismiss' | 'snooze' | 'done';
}

export interface GuidanceCard {
  id: string;
  eventId: string;
  type: GuidanceEventType;
  icon: string;
  title: string;
  body: string;
  action: GuidanceAction;
  priority: number;    // 0–10, derived from consequence × urgency matrix
  nodeId?: string;
}
