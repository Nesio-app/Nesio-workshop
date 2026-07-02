/**
 * Source Adapters — convert raw data from each source into GuidanceEvent[]
 *
 * Each adapter is a pure function with no side effects.
 * The guidance pipeline only speaks GuidanceEvent — it has no knowledge
 * of CalendarEvent, EmailSignal, FocusNode, etc.
 */

import type { CalendarEvent } from '@/lib/portal/types';
import type { EmailSignal } from '@/lib/platform/email-signals';
import type { ProactiveContextItem, FocusNode } from '@/lib/platform/view-models/today-view-model';
import { inferEventType } from '@/lib/platform/attention-engine';
import type { GuidanceEvent, GuidanceEventType } from './types';

// ── Calendar ──────────────────────────────────────────────────────────────────

// Map attention-engine EventType → GuidanceEventType
// 'other' is intentionally excluded: not specific enough to be actionable
const ATTENTION_TYPE_MAP: Partial<Record<string, GuidanceEventType>> = {
  flight:   'flight',
  medical:  'medical',
  exam:     'deadline',
  deadline: 'deadline',
  birthday: 'birthday',
  travel:   'travel',
  meeting:  'meeting',
};

export function calendarEventsToGuidanceEvents(
  events: CalendarEvent[],
  now: Date = new Date(),
): GuidanceEvent[] {
  const results: GuidanceEvent[] = [];

  for (const e of events) {
    const scheduledAt = new Date(e.start);
    if (Number.isNaN(scheduledAt.getTime())) continue;

    const eventType = inferEventType(e);
    const guidanceType = ATTENTION_TYPE_MAP[eventType];
    if (!guidanceType) continue; // 'other' — skip

    // Only consider events within -1h to +48h from now
    const hoursUntil = (scheduledAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntil < -1 || hoursUntil > 48) continue;

    results.push({
      id: `cal-${e.id}`,
      type: guidanceType,
      title: e.title,
      scheduledAt,
      source: 'calendar',
      confidence: 90,  // calendar = user-confirmed, highest confidence
      payload: { calendarEventId: e.id, location: e.location ?? '' },
    });
  }

  return results;
}

// ── Email signals ─────────────────────────────────────────────────────────────

// Only email types that have a clear actionable step
const ACTIONABLE_EMAIL_TYPES = new Set([
  'flight', 'hotel', 'appointment', 'deadline', 'bill', 'package',
]);

export function emailSignalsToGuidanceEvents(signals: EmailSignal[]): GuidanceEvent[] {
  return signals
    .filter((s) => ACTIONABLE_EMAIL_TYPES.has(s.type))
    .map((s): GuidanceEvent => ({
      id: `email-${s.id}`,
      type: 'email_signal',
      title: s.subject,
      source: 'email',
      confidence: 85,  // email = confirmed external signal
      payload: {
        emailType: s.type,
        subject: s.subject,
        from: s.from,
        icon: s.icon,
        cardBody: s.cardBody,
      },
    }));
}

// ── Special days from memory (birthdays, anniversaries) ───────────────────────

export function specialDaysToGuidanceEvents(
  items: ProactiveContextItem[],
  now: Date = new Date(),
): GuidanceEvent[] {
  return items.map((item): GuidanceEvent => {
    const scheduledAt = new Date(now);
    scheduledAt.setDate(scheduledAt.getDate() + item.daysUntil);
    scheduledAt.setHours(9, 0, 0, 0); // treat as morning of the day

    const isAnniversary = /纪念日|周年|anniversary|忌日/.test(item.name);
    return {
      id: `memory-${item.nodeId}`,
      type: isAnniversary ? 'anniversary' : 'birthday',
      title: item.name,
      scheduledAt,
      source: 'memory',
      confidence: 90,  // user-created explicit date in memory
      payload: { nodeId: item.nodeId, daysUntil: item.daysUntil },
    };
  });
}

// ── Focus nodes with due dates ────────────────────────────────────────────────

const DATE_KEYS = ['dueDate', 'due', 'deadline', 'end', 'date', 'scheduledAt'];

export function focusNodesToGuidanceEvents(
  nodes: readonly FocusNode[],
  now: Date = new Date(),
): GuidanceEvent[] {
  const results: GuidanceEvent[] = [];

  for (const node of nodes) {
    for (const key of DATE_KEYS) {
      const v = node.attributes[key];
      if (typeof v !== 'string') continue;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;

      const daysUntil = (d.getTime() - now.getTime()) / 86_400_000;
      if (daysUntil < 0 || daysUntil > 2) continue; // dormant engine handles past-due

      results.push({
        id: `node-${node.id}`,
        type: 'deadline',
        title: node.name,
        scheduledAt: d,
        source: 'memory',
        confidence: 90,  // user-set deadline
        payload: { nodeId: node.id },
      });
      break; // one event per node
    }
  }

  return results;
}

// ── Weather ───────────────────────────────────────────────────────────────────

export interface WeatherSnapshot {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
}

const RAIN_RE = /雨|rain|shower|drizzle/i;

export function weatherToGuidanceEvents(weather: WeatherSnapshot | null): GuidanceEvent[] {
  if (!weather) return [];
  const events: GuidanceEvent[] = [];

  if (weather.temperatureC < 10) {
    events.push({
      id: 'weather-cold',
      type: 'weather_cold',
      title: `今天 ${Math.round(weather.temperatureC)}°C，很冷`,
      source: 'weather',
      confidence: 65,  // forecast = medium-high, not user-confirmed
      payload: { temperatureC: weather.temperatureC, condition: weather.condition },
    });
  }

  if (RAIN_RE.test(weather.condition + (weather.forecastNote ?? ''))) {
    events.push({
      id: 'weather-rain',
      type: 'weather_rain',
      title: '今天有雨',
      source: 'weather',
      confidence: 65,
      payload: { condition: weather.condition },
    });
  }

  return events;
}

// ── Health habit nodes ────────────────────────────────────────────────────────

export function healthNodesToGuidanceEvents(healthItems: string[]): GuidanceEvent[] {
  if (!healthItems.length) return [];
  // Surface the first health item as a guidance event
  return [{
    id: 'health-habit-0',
    type: 'health_habit',
    title: healthItems[0],
    source: 'habit',
    confidence: 60,  // habit pattern = inferred, not explicitly scheduled
    payload: { itemName: healthItems[0], allItems: healthItems },
  }];
}
