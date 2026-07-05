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
 *   Dedup   → one card per identity (per type, except DEC insights per id)
 *
 * Layer 1 (event detection) and Layer 7 (learning) live outside this function:
 * Layer 1 = source-adapters.ts (call before runGuidancePipeline)
 * Layer 7 = future; interface is reserved in GuidancePipelineInput
 */

import type { AttentionObject } from '@/lib/platform/attention-engine';
import type { GuidanceEvent, GuidanceCard, GuidanceEventType, WindowUrgency } from './types';
import { getActionWindow } from './action-window';
import { buildAction } from './actionability';
import { L } from '@/lib/portal/i18n';
import { getConsequenceSeverity } from './consequence-rules';
import { interruptPriority, interruptPriorityRaw, worthInterrupting } from './interrupt-evaluator';
import { computeAttentionBudget, passesBudgetGate } from './attention-budget';
import { loadCoolingStore, isOnCooldown, recordShown, saveCoolingStore } from './cooling-store';
import { coolingKey, makeDedupGate } from './guidance-dedup.mjs';

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
    case 'anniversary':
    case 'holiday': {
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
  holiday:        '🎈',
  travel:         '🧳',
  meeting:        '🎙',
  email_signal:   '📩',
  health_habit:   '💪',
  weather_cold:   '🧥',
  weather_rain:   '☂️',
  object_context: '📦',
  dec_insight:    '💡',
};

function buildTitle(event: GuidanceEvent, urgency: WindowUrgency, locale: string = 'zh'): string {
  const n = event.title.slice(0, 22);
  const l = (zh: string, en: string) => L(locale, zh, en);
  switch (event.type) {
    case 'dec_insight': return event.title;
    case 'flight':
      if (urgency === 'critical') return l(`出发时间到了 · ${n}`, `Time to leave · ${n}`);
      if (urgency === 'high')     return l(`值机窗口已开 · ${n}`, `Check-in is open · ${n}`);
      return l(`航班提醒 · ${n}`, `Flight reminder · ${n}`);
    case 'travel':
      if (urgency === 'critical') return l(`出发时间 · ${n}`, `Departure time · ${n}`);
      return l(`旅行准备 · ${n}`, `Trip prep · ${n}`);
    case 'medical':
      if (urgency === 'critical') return l(`预约时间到 · ${n}`, `Appointment now · ${n}`);
      return l(`就诊提醒 · ${n}`, `Appointment reminder · ${n}`);
    case 'meeting':
      if (urgency === 'critical') return l(`马上开始 · ${n}`, `Starting now · ${n}`);
      if (urgency === 'high')     return l(`快要开会了 · ${n}`, `Meeting soon · ${n}`);
      return l(`今天有安排 · ${n}`, `On today · ${n}`);
    case 'deadline':
      if (urgency === 'critical') return l(`今天截止 · ${n}`, `Due today · ${n}`);
      if (urgency === 'high')     return l(`明天截止 · ${n}`, `Due tomorrow · ${n}`);
      return l(`截止日临近 · ${n}`, `Deadline approaching · ${n}`);
    case 'birthday':
      if (urgency === 'critical') return l(`今天是 ${n} 的生日`, `Today is ${n}'s birthday`);
      if (urgency === 'high')     return l(`明天 · ${n}`, `Tomorrow · ${n}`);
      return l(`即将到来 · ${n}`, `Coming up · ${n}`);
    case 'anniversary':
      if (urgency === 'critical') return l(`今天 · ${n}`, `Today · ${n}`);
      return l(`纪念日临近 · ${n}`, `Anniversary coming up · ${n}`);
    case 'holiday':
      if (urgency === 'critical') return l(`今天是 ${n}`, `Today is ${n}`);
      if (urgency === 'high')     return l(`明天是 ${n}`, `Tomorrow is ${n}`);
      return l(`${n} 快到了`, `${n} is coming up`);
    case 'weather_cold': return l('今天很冷，记得加件衣', "It's cold today — layer up");
    case 'weather_rain': return l('今天有雨，记得带伞', 'Rain today — bring an umbrella');
    case 'email_signal': return l('邮件需要关注', 'An email needs attention');
    case 'health_habit': return l('今天的健康打卡', "Today's health check-in");
    case 'object_context': {
      const itemName = String(event.payload.itemName ?? event.title);
      const contextName = String(event.payload.contextName ?? '');
      if (contextName) return l(`${itemName} 可能用得上 · ${contextName}`, `${itemName} might be useful · ${contextName}`);
      return l(`你有件东西可能用得上：${itemName}`, `You own something useful here: ${itemName}`);
    }
    default: return n;
  }
}

function buildBody(event: GuidanceEvent, urgency: WindowUrgency, locale: string = 'zh'): string {
  const l = (zh: string, en: string) => L(locale, zh, en);
  switch (event.type) {
    case 'dec_insight': return typeof event.payload.body === 'string' ? event.payload.body : '';
    case 'flight':
      if (urgency === 'critical') return l('现在需要出发了，不要错过登机时间。', 'Time to leave now — don\'t miss boarding.');
      return l('值机通常 1–2 分钟，现在处理最省心，到机场就直接走。', 'Check-in takes 1–2 minutes. Do it now and walk straight through at the airport.');
    case 'travel':
      if (urgency === 'critical') return l('出发时间到了，快速检查随身物品。', 'Departure time — quick check of your essentials.');
      return l('行程在即，确认行李和出行信息。', 'Trip coming up — confirm bags and travel details.');
    case 'medical':
      if (urgency === 'critical') return l('预约时间快到了，准备好就诊材料出发。', 'Appointment is close — grab your documents and go.');
      return l('提前确认预约信息，避免临时手忙脚乱。', 'Confirm the details ahead so there\'s no last-minute scramble.');
    case 'meeting':
      if (urgency === 'critical') return l('会议即将开始，立即准备好。', 'The meeting is about to start — get ready now.');
      if (urgency === 'high')     return l('还有不到一小时，趁现在准备材料和链接。', 'Less than an hour — prep the materials and link now.');
      return l('今天有安排，提前做好准备会更从容。', 'It\'s on today — a little prep goes a long way.');
    case 'deadline':
      if (urgency === 'critical') return l('今天最后期限，哪怕完成第一步也比拖延好。', 'Final deadline today — even the first step beats stalling.');
      return l('明天到期，今天推进一下比明天临时抱佛脚轻松得多。', 'Due tomorrow — a push today is far easier than a scramble tomorrow.');
    case 'birthday':
    case 'anniversary':
      if (urgency === 'critical') return l('今天记得发条消息，哪怕一句话也能让人感到温暖。', 'Send a message today — even one line means a lot.');
      if (urgency === 'high')     return l('明天是重要日子，今晚花几分钟准备一下。', 'Big day tomorrow — take a few minutes tonight to prepare.');
      return l('还有几天，现在准备礼物或安排比到时候手忙脚乱好得多。', 'A few days out — preparing now beats a last-minute rush.');
    case 'holiday':
      if (urgency === 'critical') return l('公司和学校一般都放假。今天有什么活动安排吗？说一句就能记下来。', 'Most offices and schools are off. Any plans today? Say it and it sticks.');
      return l('公司和学校一般都放假——想安排点什么？现在说一句，到时候 Nesio 会帮你记着。', 'Most offices and schools are off — want to plan something? Say it now and Nesio will remember.');
    case 'weather_cold':
      return l(`${Math.round(Number(event.payload.temperatureC ?? 0))}°C，真的需要多穿一件，出门前准备好。`, `${Math.round(Number(event.payload.temperatureC ?? 0))}°C — you genuinely need another layer. Get it ready before heading out.`);
    case 'weather_rain':
      return l('出门前把雨伞放进包，一秒钟的事。', 'Drop an umbrella in your bag before leaving — takes a second.');
    case 'email_signal':
      return String(event.payload.cardBody ?? l('这封邮件可能需要你做一个简单决定。', 'This email may need a quick decision from you.'));
    case 'health_habit':
      return l(`${String(event.payload.itemName ?? '今天的健康计划')} — 花 1 分钟开始就算赢了。`, `${String(event.payload.itemName ?? "today's health plan")} — one minute to start counts as a win.`);
    case 'object_context': {
      const itemName = String(event.payload.itemName ?? '');
      const loc = String(event.payload.location ?? '');
      const contextName = String(event.payload.contextName ?? '');
      const locStr = loc ? L(locale, `（存放在 ${loc}）`, ` (stored at ${loc})`) : '';
      if (contextName) return l(`你记录了一件 "${itemName}"${locStr}，可能和"${contextName}"有关，确认一下？`, `You logged "${itemName}"${locStr} — it may relate to "${contextName}". Worth a check?`);
      const expiry = event.payload.expiryDate ? l(`有效期至 ${String(event.payload.expiryDate)}`, `valid until ${String(event.payload.expiryDate)}`) : '';
      if (expiry) return l(`${itemName} · ${expiry}${locStr}，该用了还是处理了。`, `${itemName} · ${expiry}${locStr} — use it or deal with it.`);
      return l(`${itemName}${locStr}，回头看看是否用得上。`, `${itemName}${locStr} — worth checking if it\'s useful.`);
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
  /** UI 语言(zh/en),卡片标题/正文/动作随界面语言(批次 9)。 */
  locale?: string;
}

function tightenBudget(budget: ReturnType<typeof computeAttentionBudget>): ReturnType<typeof computeAttentionBudget> {
  if (budget === 'ample') return 'limited';
  return 'exhausted';
}

export function runGuidancePipeline(input: GuidancePipelineInput): GuidanceCard[] {
  const now = input.now ?? new Date();
  const locale = input.locale ?? 'zh';
  const coolingStore = loadCoolingStore();
  let budget = computeAttentionBudget(input.scoredCalendar);
  // Low personal energy → fewer interruptions today (critical events still pass)
  if (input.energy === 'low') budget = tightenBudget(budget);
  // Outside the user's learned receptive hours, non-critical cards need a higher bar
  const offHours = Boolean(
    input.goodHours && input.goodHours.length > 0 && !input.goodHours.includes(now.getHours()),
  );

  const candidates: Array<{ card: GuidanceCard; priority: number; rawPriority: number; urgency: WindowUrgency }> = [];
  // Dedup gate: one card per identity. DEC insights are keyed by id (each is an
  // independent recommendation); every other type collapses to one card.
  const isDuplicate = makeDedupGate();

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
    const action = buildAction(event, urgency, locale);
    if (!action) continue;

    // Layer 2: consequence severity
    const severity = getConsequenceSeverity(event.type);

    // Layer 4: worth interrupting at all? (5-dimension priority score)
    const confidence = typeof event.confidence === 'number' ? event.confidence : 75;
    if (!worthInterrupting(severity, urgency, event.type, event.source, confidence)) continue;

    // Layer 5: attention budget gate
    if (!passesBudgetGate(budget, severity)) continue;

    // Layer 6: cooling check (by identity — DEC insights cool per card, not per type)
    if (isOnCooldown(coolingKey(event.type, event.id), urgency, coolingStore, now)) continue;

    // Dedup: one card per identity per pipeline run
    if (isDuplicate(event.type, event.id)) continue;

    const priority = interruptPriority(severity, urgency, event.type, event.source, confidence);
    const rawPriority = interruptPriorityRaw(severity, urgency, event.type, event.source, confidence);

    // Hour-fit gate: outside receptive hours, only severity-3 or high-priority cards show
    if (offHours && severity < 3 && priority < 6) continue;
    const icon = event.type === 'email_signal' && typeof event.payload.icon === 'string'
      ? event.payload.icon
      : EVENT_ICON[event.type] ?? '📋';

    candidates.push({
      priority,
      rawPriority,
      urgency,
      card: {
        id: `guidance-${event.id}`,
        eventId: event.id,
        type: event.type,
        icon,
        title: buildTitle(event, urgency, locale),
        body: buildBody(event, urgency, locale),
        action,
        priority,
        nodeId: typeof event.payload.nodeId === 'string' ? event.payload.nodeId : undefined,
        expiresAt: computeExpiry(event),
        evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence as GuidanceCard['evidence'] : undefined,
        reason: typeof event.payload.reason === 'string' ? event.payload.reason : undefined,
      },
    });
  }

  // Sort by RAW priority desc (0-100, unrounded) — TODAY_CARD_BUDGET is the single
  // arbiter (PRD TODAY-003). Sorting on the rounded 0-10 would tie most cards and
  // degrade the top-N pick to insertion order.
  const result = candidates
    .sort((a, b) => b.rawPriority - a.rawPriority)
    .slice(0, TODAY_CARD_BUDGET)
    .map((c) => c.card);

  // Record shown → update cooling state
  if (result.length > 0) {
    let updated = coolingStore;
    for (const card of result) {
      // Find urgency for this card to set correct cooldown
      const meta = candidates.find((c) => c.card.id === card.id);
      // Cool by identity — DEC insights per card id, everything else per type —
      // so showing one DEC insight doesn't suppress the others (PRD TODAY-002).
      const key = coolingKey(card.type, card.eventId);
      updated = recordShown(key + (meta ? `_${meta.urgency}` : ''), updated);
      updated = recordShown(key, updated); // also cool by identity alone
    }
    saveCoolingStore(updated);
  }

  return result;
}
