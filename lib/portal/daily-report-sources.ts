/**
 * daily-report-sources —— 把 Nesio 各个面上「今天该说的那一句」收齐,喂给日报。
 *
 * 2026-07-30 用户:「我也想有 nesio 的每日日报文字版,但是要横跨 nesio 的所有面」。
 *
 * ── 为什么单独一个模块 ────────────────────────────────────────────────
 * 日报本体(daily-report.ts)是纯函数:给它什么它排什么,不碰存储。
 * 而「从十几个面上取数」必然要读一堆 store,还得每面各自 try/catch
 * (一个面的数据坏了不能把整份日报带塌)。两件事分开,纯的那半才留得住可单测。
 *
 * ── 取数原则:先用已有的枢纽,不另起炉灶 ──────────────────────────────
 * 七个域(健康/财务/地点/物品/心情/关系/阅读)**已经**有一个单一判定源:
 * `gatherDomainInsights()`。AI 判决层一直在吃它,日报此前一条都没接 ——
 * 所以「横跨所有面」的主要工作不是新写取数,是把这条线接上。
 * 它覆盖不到的几面(提醒/健身/衣橱/做饭/在途订单)在这里各补一段。
 *
 * ── 红线:每一面只准送「今天真要你动 / 今天真的变了」的东西 ────────────
 * 「本周没有异常」「衣橱里有 12 件上衣」这类**不进日报**。
 * 凡是没被拦住的都算数 = 42 条流水账 = 没人读第二天。配额在 daily-report.ts 里收口。
 */

import { gatherDomainInsights } from './domain-insights';
import { listReminders } from './schedule-reminders';
import { listWardrobe, suggestOutfit, inferFormalNeed } from './wardrobe';
import { getDayPlan } from '@/lib/cooking/meal-calendar';
import { loadTrainingState, protocolById } from '@/lib/platform/training-protocol-engine';
import { activeProtocol } from '@/lib/platform/training-overrides';
import { pickPhaseIndex, pickTodaySessionIndex } from '@/lib/platform/fitness-home-core';
import type { CalendarEvent } from './types';
import type {
  DailyReportDomainInsight, DailyReportReminder, DailyReportOrder,
} from './daily-report';

/** 各面收齐后的那一小把东西 —— 正好是 DailyReportInput 的跨面扩展部分。 */
export interface DailyReportExtras {
  reminders: DailyReportReminder[];
  domainInsights: DailyReportDomainInsight[];
  fitnessSession?: string;
  meals: string[];
  orders: DailyReportOrder[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 邮件节点上的 orderStatus → 给人看的那个词。认不出的**不给**(不猜)。 */
const ORDER_STATUS_TEXT: Record<string, string> = {
  ordered: '已下单',
  shipped: '已发货',
  delivered: '已送达',
  refunded: '已退款',
  canceled: '已取消',
};

/** 节点上这几个字段够不够格进日报的「在途订单」。 */
interface Orderish { name?: string; source?: string; attributes?: Record<string, unknown> }

/**
 * 在途订单里「今天值得提一句」的那几条。
 *
 * 正向判据:只有**还在路上或刚有结果**的才占今天的位置 ——
 * 「已下单」「已取消」是过去式,没有今天要你做的事。
 */
export function collectOrders(nodes: readonly Orderish[], limit = 4): DailyReportOrder[] {
  const out: DailyReportOrder[] = [];
  for (const n of nodes) {
    if (n.source !== 'email' || !n.name) continue;
    const a = n.attributes || {};
    const raw = typeof a.orderStatus === 'string' ? a.orderStatus : '';
    if (raw !== 'shipped' && raw !== 'delivered' && raw !== 'refunded') continue;
    const status = ORDER_STATUS_TEXT[raw];
    if (!status) continue;
    out.push({ title: n.name, status, ...(typeof a.eta === 'string' && a.eta ? { eta: a.eta } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 收齐各面。**每一面各自 try/catch** —— 一个面的数据坏了,其余照常出;
 * 整份日报绝不因为某个面塌掉而消失(和 gatherDomainInsights 内部同一个写法)。
 *
 * 只在客户端跑(读 localStorage / IDB 镜像)。
 * @param now 定稿时刻(当天 08:00)。判「今天」用它,不用真实当前时间。
 */
export function collectDailyReportExtras(now: Date = new Date()): DailyReportExtras {
  const out: DailyReportExtras = { reminders: [], domainInsights: [], meals: [], orders: [] };
  if (typeof window === 'undefined') return out;
  const todayKey = dayKeyOf(now);

  // ① 七个域(健康/财务/地点/物品/心情/关系/阅读)—— 已有的单一判定源
  try {
    out.domainInsights = gatherDomainInsights().map((i) => ({
      domain: i.domain, severity: i.severity, title: i.title, detail: i.detail,
    }));
  } catch { /* 某个域的数据坏了不影响其余 */ }

  // ② 我自己设的提醒(家务 / 账单 due)。做完的不再提。
  try {
    out.reminders = listReminders()
      .filter((r) => !r.doneAt && r.at.slice(0, 10) === todayKey)
      .map((r) => ({ title: r.title, at: r.at, kind: r.kind }));
  } catch { /* ignore */ }

  // ③ 今天该练哪个 —— 和健身首页/例行卡共用同一套选法(当前阶段 + 跳过本周已练的),
  //    别在这儿另算一个答案:用户在健身页看到「下肢 A」,日报里说「上肢 B」就废了。
  try {
    const st = loadTrainingState();
    const seed = st.activeProtocolId ? protocolById(st.activeProtocolId) : undefined;
    const p = seed ? activeProtocol(seed) : undefined;
    if (p) {
      const phase = p.phases[pickPhaseIndex(p.phases, st.startedAt, now)];
      const ids = (phase?.sessions ?? []).map((x) => x.id);
      const sess = phase?.sessions[pickTodaySessionIndex(ids, st.log, now, p.id)];
      if (sess) out.fitnessSession = sess.name.zh;
    }
  } catch { /* 没排训练计划就没有这一行 */ }

  // ④ 今天吃什么(自己排的餐)
  try {
    const plan = getDayPlan(todayKey);
    out.meals = [plan.breakfast, plan.lunch, plan.dinner].filter((x): x is string => Boolean(x));
  } catch { /* ignore */ }

  return out;
}

/**
 * 今天穿什么。单独一个函数,因为它要**今天的天气和今天的日历**当输入 ——
 * 那两样在调用方(useTodayData)手上已经有了,再从存储里读一遍只会读到不同的快照。
 */
export function outfitNoteFor(
  weather: { tempMinC?: number; tempMaxC?: number; temperatureC?: number; precipProb?: number } | undefined,
  todayEvents: readonly CalendarEvent[],
  now: Date = new Date(),
): string | undefined {
  try {
    const closet = listWardrobe();
    // 衣橱是空的就别说话 —— 「今天穿 …」底下一件衣服都没有,比不说更糟。
    if (!closet.length) return undefined;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const s = suggestOutfit(closet, {
      // 代表温度取今日最低更稳(早晚偏冷),没有就退当前温
      repTempC: num(weather?.tempMinC) ?? num(weather?.temperatureC),
      tempMinC: num(weather?.tempMinC),
      tempMaxC: num(weather?.tempMaxC),
      precipProb: num(weather?.precipProb),
      formalNeed: inferFormalNeed(todayEvents),
    }, now.toISOString());
    const names = s.pieces.slice(0, 3).map((g) => g.name).filter(Boolean);
    if (!names.length) return undefined;
    return `${names.join(' + ')}${s.needUmbrella ? ',带把伞' : ''}`;
  } catch {
    return undefined;
  }
}
