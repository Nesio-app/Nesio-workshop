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
import type { ClinicalFinding } from '@/lib/portal/health-clinical';
import type { RiskScore } from '@/lib/portal/health-risk';
import type { FinanceFinding } from '@/lib/portal/finance-insight';
import type { PlaceFinding } from '@/lib/portal/place-insight';
import type { InventoryFinding } from '@/lib/portal/inventory';
import type { MoodFinding } from '@/lib/portal/mood-insight';
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

// ── 域洞察 → guidance(通用脊柱)────────────────────────────────────────────────
// 各域(健康/财务/…)的确定性判定接入 Today 主循环的**唯一**通道:域先把判定归一成
// DomainInsightItem,这里统一转成 payload 驱动的 domain_insight 事件,经七层仲裁。
// 新增一个域 = 写一个薄适配器把它的 finding 映成 DomainInsightItem,**零管线改动**。
// warm-coach:文案不制造焦虑、软提示、始终可跳过;红旗优先、每域最多 3 条(不让 Today 变报表)。

/** 域判定归一形态(域把自己的 finding 映成它)。severity 决定优先级/置信/窗口。 */
export interface DomainInsightItem {
  id: string;               // 域内稳定 id(逐实例去重/冷却);最终事件 id = `${domain}-${id}`
  severity: 'flag' | 'attention';
  title: [string, string];  // [zh, en]
  body: [string, string];   // [zh, en]
  cta: [string, string];    // warm-coach 软提示文案(域特定,写在这里=知识随域走)
}

/** 通用核:一组域洞察 → domain_insight 事件(红旗优先、封顶 3)。 */
export function insightsToGuidanceEvents(
  domain: string, icon: string, reasonPrefix: string, items: readonly DomainInsightItem[],
): GuidanceEvent[] {
  const events: GuidanceEvent[] = items.map((it): GuidanceEvent => ({
    id: `${domain}-${it.id}`,
    type: 'domain_insight',
    title: it.title[0],
    source: 'habit',
    confidence: it.severity === 'flag' ? 84 : 68,
    payload: {
      domain, icon, findingId: it.id, severity: it.severity,
      titleZh: it.title[0], titleEn: it.title[1],
      bodyZh: it.body[0], bodyEn: it.body[1],
      ctaLabelZh: it.cta[0], ctaLabelEn: it.cta[1],
      reason: `${reasonPrefix} · 来自你的数据`,
    },
  }));
  return events.sort((a, b) => (a.payload.severity === 'flag' ? 0 : 1) - (b.payload.severity === 'flag' ? 0 : 1)).slice(0, 3);
}

// 健康:②模式(evaluateHealthFindings)+ ③风险(computeRiskScores)→ 域洞察。
// 红旗软性建议「和医生聊聊」,其余轻观察;达标/正常(info/low)不打扰。
const HEALTH_CTA_FLAG: [string, string] = ['这条来自你的健康数据,方便时可以和医生聊聊。', 'This comes from your own health data — worth a chat with a clinician when you can.'];
const HEALTH_CTA_SOFT: [string, string] = ['了解这条来自你健康数据的观察。', 'A gentle observation from your own health data.'];

export function healthFindingsToGuidanceEvents(
  findings: readonly ClinicalFinding[],
  scores: readonly RiskScore[],
): GuidanceEvent[] {
  const items: DomainInsightItem[] = [];
  for (const f of findings) {
    if (f.severity !== 'flag' && f.severity !== 'attention') continue;
    items.push({
      id: f.id, severity: f.severity,
      title: f.title,
      body: [`${f.detail[0]} · 依据 ${f.source}`, `${f.detail[1]} · per ${f.source}`],
      cta: f.severity === 'flag' ? HEALTH_CTA_FLAG : HEALTH_CTA_SOFT,
    });
  }
  for (const s of scores) {
    if (s.category !== 'high' && s.category !== 'moderate') continue;
    const severity = s.category === 'high' ? 'flag' : 'attention';
    items.push({
      id: `risk-${s.id}`, severity,
      title: [`${s.label[0]} · ${s.value}`, `${s.label[1]} · ${s.value}`],
      body: [`${s.detail[0]} · 依据 ${s.source}`, `${s.detail[1]} · per ${s.source}`],
      cta: severity === 'flag' ? HEALTH_CTA_FLAG : HEALTH_CTA_SOFT,
    });
  }
  return insightsToGuidanceEvents('health', '🩺', '健康', items);
}

// 财务:financeFindings(异常支出/订阅涨价/现金流/未来账单)→ 域洞察。
const FINANCE_CTA: [string, string] = ['来自你的账户数据,想看细节可以打开财务页。', 'From your own account data — open Finance for details.'];

export function financeFindingsToGuidanceEvents(
  findings: readonly FinanceFinding[],
): GuidanceEvent[] {
  const items: DomainInsightItem[] = findings.map((f) => ({
    id: f.id, severity: f.severity, title: f.title, body: f.detail, cta: FINANCE_CTA,
  }));
  return insightsToGuidanceEvents('finance', '💳', '财务', items);
}

// 收纳:效期判定(已过期=flag,30 天内=attention;物品即 life-graph object 节点)→ 域洞察。
const INVENTORY_CTA: [string, string] = ['来自你的收纳记录,点开收纳可以处理或改效期。', 'From your storage notes — open Storage to handle it.'];

export function inventoryFindingsToGuidanceEvents(
  findings: readonly InventoryFinding[],
): GuidanceEvent[] {
  const items: DomainInsightItem[] = findings.map((f) => ({
    id: f.id, severity: f.severity, title: f.title, body: f.detail, cta: INVENTORY_CTA,
  }));
  return insightsToGuidanceEvents('inventory', '📦', '收纳', items);
}

// 地图:placeFindings(活动范围/习惯断档,只出 attention 轻观察)→ 域洞察。
const PLACE_CTA: [string, string] = ['来自你的足迹数据,想看细节可以打开时间线。', 'From your own places data — open Timeline for details.'];

export function placeFindingsToGuidanceEvents(
  findings: readonly PlaceFinding[],
): GuidanceEvent[] {
  const items: DomainInsightItem[] = findings
    .filter((f) => f.severity === 'flag' || f.severity === 'attention')
    .map((f) => ({ id: f.id, severity: f.severity as 'flag' | 'attention', title: f.title, body: f.detail, cta: PLACE_CTA }));
  return insightsToGuidanceEvents('location', '📍', '活动', items);
}

// 心情:moodFindings(情绪持续偏低 CUSUM,情绪域从严只出 attention)→ 域洞察。
// warm-coach:出口给足(跳过/稍后由卡片机制自带),文案不评判。
const MOOD_CTA: [string, string] = ['来自你的「此刻」记录;想歇歇或找人聊聊,都算照顾自己。', 'From your own check-ins — a break or a chat both count as taking care.'];

export function moodFindingsToGuidanceEvents(
  findings: readonly MoodFinding[],
): GuidanceEvent[] {
  const items: DomainInsightItem[] = findings
    .filter((f) => f.severity === 'flag' || f.severity === 'attention')
    .map((f) => ({ id: f.id, severity: f.severity as 'flag' | 'attention', title: f.title, body: f.detail, cta: MOOD_CTA }));
  return insightsToGuidanceEvents('mood', '🌤', '心情', items);
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
