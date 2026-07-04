/**
 * Attention Engine — pure deterministic scoring for "what deserves attention today"
 *
 * No AI. No async. O(n) over calendar events.
 * Score = Importance × 55% + Urgency × 45%
 *
 * Importance: derived from event type (inferred from title/description keywords)
 * Urgency:    derived from time proximity to event start
 *
 * Pinned rule: exactly ONE item. Highest score among pinnable events.
 * Pinnable = event is today AND (high-priority type OR score ≥ 88)
 */

import type { CalendarEvent } from '@/lib/portal/types';
import { LEXICON, type LexiconCategory } from './keyword-lexicon';

// ── Event type ────────────────────────────────────────────────────────────────

export type EventType =
  | 'flight'    // 航班/出发
  | 'medical'   // 医院/预约/手术
  | 'exam'      // 考试/考核
  | 'deadline'  // 截止/缴费/付款/租金
  | 'birthday'  // 生日
  | 'travel'    // 旅行/搬家/入住
  | 'meeting'   // 会议/review/面试
  | 'other';    // everything else

// Base importance by type (0–100)
const TYPE_IMPORTANCE: Record<EventType, number> = {
  flight:   95,
  medical:  92,
  exam:     92,
  deadline: 88,
  birthday: 85,
  travel:   85,
  meeting:  75,
  other:    45,
};

// Types that are always considered "pinnable" (regardless of score threshold)
const ALWAYS_PINNABLE: ReadonlySet<EventType> = new Set<EventType>(['flight', 'medical', 'exam', 'deadline', 'birthday', 'travel']);

// Type-detection order (first match wins) — patterns live in the shared lexicon
const TYPE_ORDER: Array<{ type: EventType; category: LexiconCategory }> = [
  { type: 'flight',   category: 'flight' },
  { type: 'medical',  category: 'medical' },
  { type: 'exam',     category: 'exam' },
  { type: 'deadline', category: 'deadline' },
  { type: 'birthday', category: 'birthday' },
  { type: 'travel',   category: 'travel' },
  { type: 'meeting',  category: 'meeting' },
];

export function inferEventType(event: CalendarEvent): EventType {
  const text = `${event.title} ${event.description ?? ''}`;
  for (const rule of TYPE_ORDER) {
    if (LEXICON[rule.category].test(text)) return rule.type;
  }
  return 'other';
}

// ── Urgency from time proximity ───────────────────────────────────────────────

export function computeUrgency(start: string, allDay: boolean, now: Date): number {
  if (allDay) return 55; // all-day events are always present, moderate urgency

  const startMs = new Date(start).getTime();
  const nowMs = now.getTime();
  const diffMin = (startMs - nowMs) / 60_000;

  if (diffMin < 0) {
    // Already started — urgency peaks at start, decays as event progresses
    return Math.max(65, 100 + diffMin * 0.3); // stays high for ~2h after start
  }
  if (diffMin <= 15)  return 100;
  if (diffMin <= 30)  return 97;
  if (diffMin <= 60)  return 93;
  if (diffMin <= 120) return 88;
  if (diffMin <= 240) return 78;
  if (diffMin <= 480) return 65;
  if (diffMin <= 720) return 55;
  return 42; // > 12h away, still today
}

// ── Final score ───────────────────────────────────────────────────────────────

export function computeScore(importance: number, urgency: number): number {
  // Multiplicative: urgency modulates importance rather than adding to it independently.
  // Floor at 0.35 so high-importance events that aren't urgent yet still register.
  // Research basis: additive models let one dimension compensate the other — a
  // far-future flight shouldn't score the same as a meeting happening in 2 hours.
  return Math.round(importance * Math.max(0.35, urgency / 100));
}

// ── AttentionObject ───────────────────────────────────────────────────────────

export interface AttentionObject {
  id: string;
  title: string;
  eventType: EventType;
  importance: number;
  urgency: number;
  score: number;
  pinnable: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  event: CalendarEvent;
}

// ── Day helpers ───────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function scoreCalendarEvents(
  events: CalendarEvent[],
  now: Date = new Date(),
): AttentionObject[] {
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return events
    .filter((e) => {
      // Only include today + tomorrow events
      const d = startOfDay(new Date(e.start));
      return isSameDay(d, today) || isSameDay(d, tomorrow);
    })
    .map((e): AttentionObject => {
      const eventType = inferEventType(e);
      const importance = TYPE_IMPORTANCE[eventType];
      const urgency = computeUrgency(e.start, e.allDay ?? false, now);
      const score = computeScore(importance, urgency);
      const d = startOfDay(new Date(e.start));
      const isToday = isSameDay(d, today);
      const isTomorrow = isSameDay(d, tomorrow);

      // Pinnable = today's event AND (important type OR very high score)
      const pinnable = isToday && (ALWAYS_PINNABLE.has(eventType) || score >= 88);

      return { id: e.id, title: e.title, eventType, importance, urgency, score, pinnable, isToday, isTomorrow, event: e };
    })
    .sort((a, b) => b.score - a.score || new Date(a.event.start).getTime() - new Date(b.event.start).getTime());
}

// ── Pinned selection ──────────────────────────────────────────────────────────

export function selectPinned(objects: AttentionObject[]): AttentionObject | null {
  return objects.find((o) => o.pinnable) ?? null;
}

// ── Type metadata ─────────────────────────────────────────────────────────────

export const EVENT_TYPE_ICON: Record<EventType, string> = {
  flight:   '✈️',
  medical:  '🏥',
  exam:     '📝',
  deadline: '⏰',
  birthday: '🎂',
  travel:   '🧳',
  meeting:  '📅',
  other:    '📌',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  flight:   '航班',
  medical:  '医疗预约',
  exam:     '考试',
  deadline: '截止',
  birthday: '生日',
  travel:   '出行',
  meeting:  '会议',
  other:    '日程',
};
