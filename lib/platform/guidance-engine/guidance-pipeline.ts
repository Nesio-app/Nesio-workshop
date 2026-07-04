/**
 * Guidance Pipeline — orchestrator for all seven layers
 *
 * Input:  raw GuidanceEvent[] from any source + today's scored calendar objects
 * Output: up to 2 GuidanceCard[], sorted by priority, ready to render
 *
 * Pipeline order:
 *   Layer 3 → Action Window (is now the right time?)
 *   Hard gate → Actionability (can user act in 1 minute?)
 *   Layer 2 → Consequence (what happens if ignored?)
 *   Layer 4 → Interrupt Evaluator (worth showing at all?)
 *   Layer 5 → Attention Budget (is user's day already overloaded?)
 *   Layer 6 → Cooling Store (shown too recently?)
 *   Dedup   → one card per event type
 *
 * Layer 1 (event detection) and Layer 7 (learning) live outside this function:
 * Layer 1 = source-adapters.ts (call before runGuidancePipeline)
 * Layer 7 = future; interface is reserved in GuidancePipelineInput
 */

import type { AttentionObject } from '@/lib/platform/attention-engine';
import type { GuidanceEvent, GuidanceCard, GuidanceEventType, WindowUrgency } from './types';
import { getActionWindow } from './action-window';
import { buildAction } from './actionability';
import { getConsequenceSeverity } from './consequence-rules';
import { interruptPriority, worthInterrupting } from './interrupt-evaluator';
import { computeAttentionBudget, passesBudgetGate } from './attention-budget';
import { loadCoolingStore, isOnCooldown, recordShown, saveCoolingStore } from './cooling-store';

// Compute when a card's action window closes and the card becomes irrelevant.
// Google Now principle: a boarding-pass card disappears when the plane departs.
function computeExpiry(event: GuidanceEvent): Date | undefined {
  // DEC cards carry their own expiry and have no scheduledAt — check first.
  if (event.type === 'dec_insight') {
    const raw = event.payload?.expiresAt;
    return typeof raw === 'string' ? new Date(raw) : undefined;
  }
  if (!event.scheduledAt) return undefined;
  const t = event.scheduledAt.getTime();
  switch (event.type) {
    case 'flight':
      return new Date(t - 2 * 3_600_000);      // card expires 2h before flight (on the way)
    case 'medical':
    case 'meeting':
      return new Date(t - 0.5 * 3_600_000);    // expires 30min before (too late to prep)
    case 'deadline':
      return new Date(t);                        // expires at the deadline itself
    case 'birthday':
    case 'anniversary': {
      const eod = new Date(event.scheduledAt);
      eod.setHours(23, 59, 59, 0);
      return eod;                                // expires end of that day
    }
    default:
      return undefined;
  }
}

const EVENT_ICON: Record<GuidanceEventType, string> = {
  flight:         '✈️',
  medical:        '🏥',
  deadline:       '⏰',
  birthday:       '🎂',
  anniversary:    '💝',
  travel:         '🧳',
  meeting:        '🎙',
  email_signal:   '📩',
  health_habit:   '💪',
  weather_cold:   '🧥',
  weather_rain:   '☂️',
  object_context: '📦',
  dec_insight:    '💡',
};

function buildTitle(event: GuidanceEvent, urgency: WindowUrgency): string {
  const n = event.title.slice(0, 22);
  switch (event.type) {
    case 'dec_insight': return event.title;
    case 'flight':
      if (urgency === 'critical') return `出发时间到了 · ${n}`;
      if (urgency === 'high')     return `值机窗口已开 · ${n}`;
      return `航班提醒 · ${n}`;
    case 'travel':
      if (urgency === 'critical') return `出发时间 · ${n}`;
      return `旅行准备 · ${n}`;
    case 'medical':
      if (urgency === 'critical') return `预约时间到 · ${n}`;
      return `就诊提醒 · ${n}`;
    case 'meeting':
      if (urgency === 'critical') return `马上开始 · ${n}`;
      if (urgency === 'high')     return `快要开会了 · ${n}`;
      return `今天有安排 · ${n}`;
    case 'deadline':
      if (urgency === 'critical') return `今天截止 · ${n}`;
      if (urgency === 'high')     return `明天截止 · ${n}`;
      return `截止日临近 · ${n}`;
    case 'birthday':
      if (urgency === 'critical') return `今天是 ${n} 的生日`;
      if (urgency === 'high')     return `明天 · ${n}`;
      return `即将到来 · ${n}`;
    case 'anniversary':
      if (urgency === 'critical') return `今天 · ${n}`;
      return `纪念日临近 · ${n}`;
    case 'weather_cold': return '今天很冷，记得加件衣';
    case 'weather_rain': return '今天有雨，记得带伞';
    case 'email_signal': return `邮件需要关注`;
    case 'health_habit': return '今天的健康打卡';
    case 'object_context': {
      const itemName = String(event.payload.itemName ?? event.title);
      const contextName = String(event.payload.contextName ?? '');
      if (contextName) return `${itemName} 可能用得上 · ${contextName}`;
      return `你有件东西可能用得上：${itemName}`;
    }
    default: return n;
  }
}

function buildBody(event: GuidanceEvent, urgency: WindowUrgency): string {
  switch (event.type) {
    case 'dec_insight': return typeof event.payload.body === 'string' ? event.payload.body : '';
    case 'flight':
      if (urgency === 'critical') return '现在需要出发了，不要错过登机时间。';
      return '值机通常 1–2 分钟，现在处理最省心，到机场就直接走。';
    case 'travel':
      if (urgency === 'critical') return '出发时间到了，快速检查随身物品。';
      return '行程在即，确认行李和出行信息。';
    case 'medical':
      if (urgency === 'critical') return '预约时间快到了，准备好就诊材料出发。';
      return '提前确认预约信息，避免临时手忙脚乱。';
    case 'meeting':
      if (urgency === 'critical') return '会议即将开始，立即准备好。';
      if (urgency === 'high')     return '还有不到一小时，趁现在准备材料和链接。';
      return '今天有安排，提前做好准备会更从容。';
    case 'deadline':
      if (urgency === 'critical') return '今天最后期限，哪怕完成第一步也比拖延好。';
      return '明天到期，今天推进一下比明天临时抱佛脚轻松得多。';
    case 'birthday':
    case 'anniversary':
      if (urgency === 'critical') return '今天记得发条消息，哪怕一句话也能让人感到温暖。';
      if (urgency === 'high')     return '明天是重要日子，今晚花几分钟准备一下。';
      return '还有几天，现在准备礼物或安排比到时候手忙脚乱好得多。';
    case 'weather_cold':
      return `${Math.round(Number(event.payload.temperatureC ?? 0))}°C，真的需要多穿一件，出门前准备好。`;
    case 'weather_rain':
      return '出门前把雨伞放进包，一秒钟的事。';
    case 'email_signal':
      return String(event.payload.cardBody ?? '这封邮件可能需要你做一个简单决定。');
    case 'health_habit':
      return `${String(event.payload.itemName ?? '今天的健康计划')} — 花 1 分钟开始就算赢了。`;
    case 'object_context': {
      const itemName = String(event.payload.itemName ?? '');
      const loc = String(event.payload.location ?? '');
      const contextName = String(event.payload.contextName ?? '');
      const locStr = loc ? `（存放在 ${loc}）` : '';
      if (contextName) return `你记录了一件 "${itemName}"${locStr}，可能和"${contextName}"有关，确认一下？`;
      const expiry = event.payload.expiryDate ? `有效期至 ${String(event.payload.expiryDate)}` : '';
      if (expiry) return `${itemName} · ${expiry}${locStr}，该用了还是处理了。`;
      return `${itemName}${locStr}，回头看看是否用得上。`;
    }
    default:
      return '';
  }
}

/** Today 首屏统一预算(PRD TODAY-003):所有来源的卡经同一仲裁,最多 3 张。 */
export const TODAY_CARD_BUDGET = 3;

export interface GuidancePipelineInput {
  events: GuidanceEvent[];
  scoredCalendar: AttentionObject[]; // from attention engine — drives budget
  now?: Date;
  /** From energy-state (此刻 EWMA baseline): 'low' tightens the budget one level. */
  energy?: 'low' | 'normal' | 'high' | 'unknown';
  /** From mirror-profile hourEngagement: user's most receptive hours (0-23). */
  goodHours?: number[];
}

function tightenBudget(budget: ReturnType<typeof computeAttentionBudget>): ReturnType<typeof computeAttentionBudget> {
  if (budget === 'ample') return 'limited';
  return 'exhausted';
}

export function runGuidancePipeline(input: GuidancePipelineInput): GuidanceCard[] {
  const now = input.now ?? new Date();
  const coolingStore = loadCoolingStore();
  let budget = computeAttentionBudget(input.scoredCalendar);
  // Low personal energy → fewer interruptions today (critical events still pass)
  if (input.energy === 'low') budget = tightenBudget(budget);
  // Outside the user's learned receptive hours, non-critical cards need a higher bar
  const offHours = Boolean(
    input.goodHours && input.goodHours.length > 0 && !input.goodHours.includes(now.getHours()),
  );

  const candidates: Array<{ card: GuidanceCard; priority: number; urgency: WindowUrgency }> = [];
  const seenTypes = new Set<string>();

  // Pre-filter: drop events whose action window has already closed (card would be stale).
  const liveEvents = input.events.filter((e) => {
    const expiry = computeExpiry(e);
    return !expiry || expiry.getTime() > now.getTime();
  });

  for (const event of liveEvents) {
    // Layer 3: is the action window open right now?
    const urgency = getActionWindow(event, now);
    if (urgency === 'closed') continue;

    // Actionability hard gate: must have a 1-minute first step
    const action = buildAction(event, urgency);
    if (!action) continue;

    // Layer 2: consequence severity
    const severity = getConsequenceSeverity(event.type);

    // Layer 4: worth interrupting at all? (5-dimension priority score)
    const confidence = typeof event.confidence === 'number' ? event.confidence : 75;
    if (!worthInterrupting(severity, urgency, event.type, event.source, confidence)) continue;

    // Layer 5: attention budget gate
    if (!passesBudgetGate(budget, severity)) continue;

    // Layer 6: cooling check
    if (isOnCooldown(event.type, urgency, coolingStore, now)) continue;

    // Dedup: one card per event type per pipeline run
    if (seenTypes.has(event.type)) continue;
    seenTypes.add(event.type);

    const priority = interruptPriority(severity, urgency, event.type, event.source, confidence);

    // Hour-fit gate: outside receptive hours, only severity-3 or high-priority cards show
    if (offHours && severity < 3 && priority < 6) continue;
    const icon = event.type === 'email_signal' && typeof event.payload.icon === 'string'
      ? event.payload.icon
      : EVENT_ICON[event.type] ?? '📋';

    candidates.push({
      priority,
      urgency,
      card: {
        id: `guidance-${event.id}`,
        eventId: event.id,
        type: event.type,
        icon,
        title: buildTitle(event, urgency),
        body: buildBody(event, urgency),
        action,
        priority,
        nodeId: typeof event.payload.nodeId === 'string' ? event.payload.nodeId : undefined,
        expiresAt: computeExpiry(event),
        evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence as GuidanceCard['evidence'] : undefined,
        reason: typeof event.payload.reason === 'string' ? event.payload.reason : undefined,
      },
    });
  }

  // Sort by priority desc — TODAY_CARD_BUDGET is the single arbiter (PRD TODAY-003)
  const result = candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, TODAY_CARD_BUDGET)
    .map((c) => c.card);

  // Record shown → update cooling state
  if (result.length > 0) {
    let updated = coolingStore;
    for (const card of result) {
      // Find urgency for this card to set correct cooldown
      const meta = candidates.find((c) => c.card.id === card.id);
      updated = recordShown(card.type + (meta ? `_${meta.urgency}` : ''), updated);
      updated = recordShown(card.type, updated); // also cool by type alone
    }
    saveCoolingStore(updated);
  }

  return result;
}
