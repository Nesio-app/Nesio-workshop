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
import { L } from '@/lib/portal/i18n';
import { getConsequenceSeverity } from './consequence-rules';
import { interruptPriority, worthInterrupting } from './interrupt-evaluator';
import { computeAttentionBudget, passesBudgetGate } from './attention-budget';
import { loadCoolingStore, isOnCooldown, recordShown, saveCoolingStore } from './cooling-store';
import { getDomainWeight } from '@/lib/portal/mirror-profile';
import { getWeight } from '@/lib/platform/personalization';

// Compute when a card's action window closes and the card becomes irrelevant.
// Google Now principle: a boarding-pass card disappears when the plane departs.
// dec_insight(跨域推荐)与 object_context(多个物品)天生有多个不同实例,不能按裸
// event.type 去重/冷却 —— 否则第一张之后全被当"同类"丢弃,旗舰跨域推荐只剩 1 张。
// 这两类按 event.id(退化用 nodeId)区分,其余事件仍按 type(一类只出一张)。
const MULTI_INSTANCE_EVENT_TYPES = new Set<GuidanceEventType>(['dec_insight', 'object_context', 'domain_insight', 'renewal']);
function dedupKey(event: GuidanceEvent): string {
  if (MULTI_INSTANCE_EVENT_TYPES.has(event.type)) {
    const nodeId = typeof event.payload?.nodeId === 'string' ? event.payload.nodeId : '';
    return `${event.type}:${event.id || nodeId}`;
  }
  return event.type;
}

function computeExpiry(event: GuidanceEvent): Date | undefined {
  // DEC cards carry their own expiry and have no scheduledAt — check first.
  if (event.type === 'dec_insight') {
    const raw = event.payload?.expiresAt;
    return typeof raw === 'string' ? new Date(raw) : undefined;
  }
  // 域判定按天刷新:今晚过期,明天带新数据重新评估(不长期挂着一条旧信号)。
  if (event.type === 'domain_insight') {
    const eod = event.scheduledAt ? new Date(event.scheduledAt) : new Date();
    eod.setHours(23, 59, 59, 0);
    return eod;
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
    case 'expiry':
      return new Date(t);                        // scheduledAt 已是当天 23:59(批次 65)
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
  expiry:         '⏳',
  renewal:        '🪪',
  birthday:       '🎂',
  anniversary:    '💝',
  holiday:        '🎈',
  travel:         '🧳',
  meeting:        '🎙',
  email_signal:   '📩',
  health_habit:   '💪',
  domain_insight: '📊',  // 兜底;实际图标由 payload.icon 提供(健康🩺/财务💳/…)
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
    case 'domain_insight':
      return l(String(event.payload.titleZh ?? event.title), String(event.payload.titleEn ?? event.title));
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
    case 'expiry':
      // 批次 65(用户点名):快过期要把话说明白,不是「截止」也不是光秃秃的 title
      if (urgency === 'critical') return l(`今天过期 · ${n}`, `Expires today · ${n}`);
      if (urgency === 'high')     return l(`明天过期 · ${n}`, `Expires tomorrow · ${n}`);
      return l(`快过期了 · ${n}`, `Expiring soon · ${n}`);
    case 'renewal': {
      const isWarranty = /warranty|保修/.test(String(event.payload.subtype ?? ''));
      if (isWarranty)             return l(`保修将到期 · ${n}`, `Warranty ending · ${n}`);
      if (urgency === 'high')     return l(`证件快过期 · ${n}`, `Expiring soon · ${n}`);
      return l(`证件到期提醒 · ${n}`, `Renewal reminder · ${n}`);
    }
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
    case 'email_signal':
      // 具体标题优先(email-signals 的 cardTitle,如「有快递待签收」);缺才退通用文案。
      return typeof event.payload.cardTitle === 'string' && event.payload.cardTitle
        ? event.payload.cardTitle
        : l('邮件需要关注', 'An email needs attention');
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
    case 'domain_insight':
      return l(String(event.payload.bodyZh ?? ''), String(event.payload.bodyEn ?? ''));
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
    case 'expiry':
      if (urgency === 'critical') return l('有效期到今天——记得用掉或处理，别浪费。', 'Valid through today — use it up or deal with it, don\'t let it go to waste.');
      return l('明天就过期了，今天优先用它。', 'Expires tomorrow — use it first today.');
    case 'renewal': {
      const isWarranty = /warranty|保修/.test(String(event.payload.subtype ?? ''));
      const exp = event.payload.expiryDate ? String(event.payload.expiryDate) : '';
      if (isWarranty) return l(`保修${exp ? `到 ${exp}` : '快到期'}——趁还在保，有毛病先送修，过保就自费了。`, `Warranty ${exp ? `ends ${exp}` : 'is ending'} — get it serviced while it\'s still covered; after that it\'s out of pocket.`);
      if (urgency === 'high') return l('不到一个月就过期了，尽快预约续办，别卡在出行前。', 'Less than a month left — book the renewal now, don\'t get stuck before a trip.');
      return l(`${exp ? `${exp} 到期。` : ''}续办常要预约、排队、邮寄，早点动手更从容。`, `${exp ? `Expires ${exp}. ` : ''}Renewals often mean appointments, queues and mailing — starting early is far easier.`);
    }
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

/** 出卡但延迟「已展示」副作用 —— 调用方确认结果会上屏后调 commitShown()(见函数尾注释)。 */
export function runGuidancePipelineDeferred(
  input: GuidancePipelineInput,
): { cards: GuidanceCard[]; commitShown: () => void } {
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

  // 排序:规则分 + Preference/mirror 口味(已退役 guidance-ranker)。
  const candidates: Array<{ card: GuidanceCard; priority: number; ruleScore: number; urgency: WindowUrgency; coolKey: string }> = [];
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
    const action = buildAction(event, urgency, locale);
    if (!action) continue;

    // Layer 2: consequence severity
    const severity = getConsequenceSeverity(event.type);

    // Layer 4: worth interrupting at all? (5-dimension priority score)
    const confidence = typeof event.confidence === 'number' ? event.confidence : 75;
    if (!worthInterrupting(severity, urgency, event.type, event.source, confidence)) continue;

    // Layer 5: attention budget gate
    if (!passesBudgetGate(budget, severity)) continue;

    // Layer 6: cooling check(按 dedupKey —— dec_insight/object_context 逐实例冷却)
    const dk = dedupKey(event);
    if (isOnCooldown(dk, urgency, coolingStore, now)) continue;

    // Dedup: 同一 dedupKey 一次 pipeline 只出一张(多实例类型按 id 区分,不再塌缩)
    if (seenTypes.has(dk)) continue;
    seenTypes.add(dk);

    // 0-10 规则分 + Preference/mirror 口味轻加权(已退役 guidance-ranker 在线学习)。
    const priority = interruptPriority(severity, urgency, event.type, event.source, confidence);

    // Hour-fit gate: outside receptive hours, only severity-3 or high-priority cards show
    if (offHours && severity < 3 && priority < 6) continue;

    // Preference 域权重(总线投影)+ mirror domainFit 作轻加权,不另起伪智能排序器。
    const prefW = getWeight('domain', event.type);
    const mirrorW = getDomainWeight(event.type);
    const ruleScore = priority + (Number.isFinite(prefW) ? (prefW - 0.5) * 2 : 0) + (mirrorW - 0.5);
    // email_signal 与 domain_insight 自带图标(邮件 provider 图标 / 域图标),其余用类型固定图标。
    const icon = (event.type === 'email_signal' || event.type === 'domain_insight') && typeof event.payload.icon === 'string'
      ? event.payload.icon
      : EVENT_ICON[event.type] ?? '📋';

    candidates.push({
      priority,
      ruleScore,
      urgency,
      coolKey: dk,
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

  // 规则分排序 + Preference/cooling;并列再按 urgency → 最近到期。
  // TODAY_CARD_BUDGET 仍是唯一"出几张"的裁决者(PRD TODAY-003)。
  const URGENCY_RANK: Record<WindowUrgency, number> = { critical: 4, high: 3, medium: 2, low: 1, closed: 0 };
  const ranked = candidates
    .sort((a, b) => {
      if (b.ruleScore !== a.ruleScore) return b.ruleScore - a.ruleScore;
      if (URGENCY_RANK[b.urgency] !== URGENCY_RANK[a.urgency]) return URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
      const ax = a.card.expiresAt ? new Date(a.card.expiresAt).getTime() : Infinity;
      const bx = b.card.expiresAt ? new Date(b.card.expiresAt).getTime() : Infinity;
      return ax - bx; // sooner expiry wins the last tie
    })
    .slice(0, TODAY_CARD_BUDGET);
  const result = ranked.map((c) => c.card);

  // 「已展示」副作用(冷却)拆成显式提交:调用方确认这轮结果
  // **真的会上屏**后才调用。此前副作用在返回前就写,而 useTodayData 的并发守卫
  // (runSeqRef)可能丢弃慢轮的 UI 输出 —— 卡被记成已展示却从未出现,下一轮全被
  // 冷却拦掉,Today 只剩兜底金句(收纳临期卡首发时踩中)。
  const commitShown = () => {
    // Record shown → update cooling state
    if (result.length > 0) {
      let updated = coolingStore;
      for (const card of result) {
        // 冷却键与 isOnCooldown 的读取键一致(dedupKey);多实例类型逐实例冷却。
        const meta = candidates.find((c) => c.card.id === card.id);
        updated = recordShown(meta?.coolKey ?? card.type, updated);
      }
      saveCoolingStore(updated);
    }
  };

  return { cards: result, commitShown };
}

/** 兼容入口:出卡并立即提交「已展示」(单次同步调用场景 / 既有测试)。 */
export function runGuidancePipeline(input: GuidancePipelineInput): GuidanceCard[] {
  const { cards, commitShown } = runGuidancePipelineDeferred(input);
  commitShown();
  return cards;
}
