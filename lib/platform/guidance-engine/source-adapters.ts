/**
 * Source Adapters — convert raw data from each source into GuidanceEvent[]
 *
 * Each adapter is a pure function with no side effects.
 * The guidance pipeline only speaks GuidanceEvent — it has no knowledge
 * of CalendarEvent, EmailSignal, FocusNode, etc.
 */

import type { CalendarEvent } from '@/lib/portal/types';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';
import type { EmailSignal } from '@/lib/platform/email-signals';
import type { ProactiveContextItem, FocusNode } from '@/lib/platform/view-models/today-view-model';
import { inferEventType } from '@/lib/platform/attention-engine';
import { nearestNodeDate } from '@/lib/platform/node-dates';
import type { LifeNode } from '@/lib/portal/life-graph';
import type { GuidanceEvent, GuidanceEventType } from './types';

// ── Calendar ──────────────────────────────────────────────────────────────────

/**
 * 节日识别 — 「Independence Day」这类日历条目不是任务,不该被当成
 * 「今天截止」的 deadline(用户实测反馈)。识别成 holiday 后走节日口吻:
 * 提示放假 + 邀请安排活动,永远不给「开始」这种任务按钮。
 */
const HOLIDAY_RE = /independence day|christmas|thanksgiving|new year'?s?|easter|memorial day|labor day|veterans day|presidents'? day|mlk|halloween|holiday|day off|春节|除夕|国庆|中秋|端午|清明|元旦|劳动节|儿童节|妇女节|感恩节|圣诞|新年|放假|假期|年三十/i;

export function isHolidayTitle(title: string): boolean {
  return HOLIDAY_RE.test(title);
}

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
    let guidanceType = ATTENTION_TYPE_MAP[eventType];
    if (isHolidayTitle(e.title)) guidanceType = 'holiday';
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

export function focusNodesToGuidanceEvents(
  nodes: readonly FocusNode[],
  now: Date = new Date(),
): GuidanceEvent[] {
  const results: GuidanceEvent[] = [];

  for (const node of nodes) {
    // Unified key list (node-dates) — previously this adapter missed
    // 'start'/'datetime'/'remindAt', so start-only nodes never got cards.
    const d = nearestNodeDate(node.attributes, now.getTime());
    if (!d) continue;

    const daysUntil = (d.getTime() - now.getTime()) / 86_400_000;
    if (daysUntil < 0 || daysUntil > 2) continue; // dormant engine handles past-due

    results.push({
      id: `node-${node.id}`,
      type: isHolidayTitle(node.name) ? 'holiday' : 'deadline',
      title: node.name,
      scheduledAt: d,
      source: 'memory',
      confidence: 90,  // user-set deadline
      payload: { nodeId: node.id },
    });
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

// ── Object context (物品关联情境) ─────────────────────────────────────────────

// Context keywords to match against object names/tags
const CONTEXT_KEYWORD_MAP: Array<{
  contextTypes: GuidanceEventType[];
  keywords: string[];
  objectKeywords: string[];
}> = [
  { contextTypes: ['birthday', 'anniversary'], keywords: ['生日', '纪念日', '庆祝'], objectKeywords: ['礼物', '礼品', 'gift', '包装', '卡片', '蜡烛', '蛋糕', '玩具', '香水'] },
  { contextTypes: ['travel', 'flight'], keywords: ['旅行', '出行', '出发', '机场'], objectKeywords: ['行李', '旅行', '充电', '插头', '转换', 'adapter', '护照', '雨伞', '药品', '墨镜'] },
  { contextTypes: ['meeting'], keywords: ['会议', '汇报', '演讲', '会面'], objectKeywords: ['投影', 'HDMI', '笔记本', '演示', '名片', '文件', '材料'] },
  { contextTypes: ['medical'], keywords: ['看病', '医院', '体检'], objectKeywords: ['病历', '社保卡', '医保', '药', '报告', '检查单'] },
];

/**
 * Given upcoming guidance events and the user's life graph nodes,
 * surface owned objects that are relevant to those contexts.
 */
export function objectContextEvents(
  upcomingEvents: GuidanceEvent[],
  nodes: LifeNode[],
  now: Date = new Date(),
): GuidanceEvent[] {
  const objectNodes = nodes.filter((n) => n.type === 'object');
  const results: GuidanceEvent[] = [];
  const seenNodeIds = new Set<string>();

  // 1. Match objects to upcoming events by keyword overlap
  for (const event of upcomingEvents) {
    const hoursUntil = event.scheduledAt
      ? (event.scheduledAt.getTime() - now.getTime()) / 3_600_000
      : Infinity;
    if (hoursUntil > 7 * 24 || hoursUntil < 0) continue; // only look 7 days ahead

    const relevantObjectKeywords: string[] = [];
    for (const mapping of CONTEXT_KEYWORD_MAP) {
      if (mapping.contextTypes.includes(event.type)) {
        relevantObjectKeywords.push(...mapping.objectKeywords);
      }
    }
    if (relevantObjectKeywords.length === 0) continue;

    const titleLower = event.title.toLowerCase();

    for (const node of objectNodes) {
      if (seenNodeIds.has(node.id)) continue;
      const nameAndTags = [node.name, ...(node.tags ?? [])].join(' ').toLowerCase();
      const isRelevant = relevantObjectKeywords.some((kw) => nameAndTags.includes(kw.toLowerCase()));
      if (!isRelevant) continue;

      seenNodeIds.add(node.id);
      const loc = typeof node.attributes?.location === 'string' ? node.attributes.location : '';
      results.push({
        id: `obj-ctx-${node.id}-${event.id}`,
        type: 'object_context',
        title: node.name,
        scheduledAt: event.scheduledAt,
        source: 'memory',
        confidence: 55,
        payload: {
          itemName: node.name,
          location: loc,
          contextName: event.title,
          contextType: event.type,
          nodeId: node.id,
        },
      });
      if (results.length >= 3) return results; // cap at 3 object_context cards
    }
  }

  // 2. Surface objects with expiry dates coming up within 7 days
  const sevenDaysMs = 7 * 24 * 3_600_000;
  for (const node of objectNodes) {
    if (seenNodeIds.has(node.id)) continue;
    const expiry = node.attributes?.expiry;
    if (!expiry || typeof expiry !== 'string') continue;
    const expiryDate = new Date(expiry);
    if (Number.isNaN(expiryDate.getTime())) continue;
    const diff = expiryDate.getTime() - now.getTime();
    if (diff < 0 || diff > sevenDaysMs) continue;

    seenNodeIds.add(node.id);
    const loc = typeof node.attributes?.location === 'string' ? node.attributes.location : '';
    results.push({
      id: `obj-expiry-${node.id}`,
      type: 'object_context',
      title: `${node.name} 即将过期`,
      scheduledAt: expiryDate,
      source: 'memory',
      confidence: 70,
      payload: {
        itemName: node.name,
        location: loc,
        expiryDate: expiry,
        nodeId: node.id,
      },
    });
    if (results.length >= 3) break;
  }

  return results;
}


// ── DEC domain-engine cards (PRD TODAY-001/002) ───────────────────────────────
// runDEC() output previously computed on every load and DISCARDED. Its cards
// now flow through the same pipeline as every other source, carrying their
// evidence chain so Today can render Recommendation + Reason + Evidence.

export function decCardsToGuidanceEvents(cards: readonly RecommendationCard[]): GuidanceEvent[] {
  return cards.map((card): GuidanceEvent => ({
    id: `dec-${card.id}`,
    type: 'dec_insight',
    title: card.title,
    source: 'memory',
    confidence: Math.round((card.confidence ?? 0.6) * 100),
    payload: {
      body: card.body,
      icon: card.icon,
      primaryAction: card.primaryAction,
      evidence: card.evidence,
      evidenceSignalIds: card.evidenceSignalIds ?? [],
      reason: `${card.domainLabel} · 基于你的 ${card.evidence.length} 条记录`,
      expiresAt: card.expiresAt,
    },
  }));
}
