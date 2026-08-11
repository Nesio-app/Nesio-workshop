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
import { listInventoryItems } from './inventory';
import { loadFeatureUsage } from './feature-usage';
import { looseThreads } from './loose-threads';
import { getLifeGraph } from './life-graph';
import { loadTrainingState, protocolById } from '@/lib/platform/training-protocol-engine';
import { activeProtocol } from '@/lib/platform/training-overrides';
import { pickPhaseIndex, pickTodaySessionIndex } from '@/lib/platform/fitness-home-core';
import type { CalendarEvent } from './types';
import type {
  DailyReportDomainInsight, DailyReportReminder, DailyReportOrder, DailyReportAhead,
} from './daily-report';
import { AHEAD_DAYS } from './daily-report';

/** 各面收齐后的那一小把东西 —— 正好是 DailyReportInput 的跨面扩展部分。 */
export interface DailyReportExtras {
  reminders: DailyReportReminder[];
  domainInsights: DailyReportDomainInsight[];
  fitnessSession?: string;
  meals: string[];
  /* orders 不在这里 —— 它由调用方用 collectOrders(节点) 单独算,因为节点在它手上。
     自查发现:这里原本挂着一个 `orders: []`,**从没被赋值过**,然后被调用方整个覆盖。
     结果不错,但它是个说谎的字段:看着像「这里管订单」,其实一行都不管。 */
  /** 未来两周里确定会发生的事(已知日期,无推算) */
  ahead: DailyReportAhead[];
  /** 我自己说过想做、却一直没动的那几条(见 loose-threads) */
  threads: string[];
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
    const pick = (key: string): string => {
      const v = a[key];
      return typeof v === 'string' && v.trim() ? v.trim() : '';
    };
    const eta = pick('eta');
    const amount = pick('amount');
    const orderNo = pick('orderNo');
    const trackingNo = pick('trackingNo');
    const store = pick('store');
    out.push({
      title: n.name,
      status,
      ...(eta ? { eta } : {}),
      ...(amount ? { amount } : {}),
      ...(orderNo ? { orderNo } : {}),
      ...(trackingNo ? { trackingNo } : {}),
      ...(store ? { store } : {}),
    });
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
  const out: DailyReportExtras = { reminders: [], domainInsights: [], meals: [], ahead: [], threads: [] };
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
      .map((r) => ({
        title: r.title,
        at: r.at,
        kind: r.kind,
        ...(r.note?.trim() ? { note: r.note.trim() } : {}),
      }));
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

  /* ⑤ 往前看:未来两周确定会发生的事。**只收已知日期,不做任何推算**
     (见 DailyReportAhead 的红线)。日历那部分由调用方补 —— 它手上就有 events,
     从存储再读一遍只会读到另一个快照。 */
  const from = dayKeyOf(now);
  const until = new Date(now); until.setDate(until.getDate() + AHEAD_DAYS);
  const untilKey = dayKeyOf(until);
  const inWindow = (ymd: string) => ymd > from && ymd <= untilKey;   // 今天不算(今天有自己的段)

  try {
    for (const r of listReminders()) {
      if (r.doneAt) continue;
      const d = r.at.slice(0, 10);
      if (inWindow(d)) out.ahead.push({ date: d, title: r.title, kind: 'reminder' });
    }
  } catch { /* ignore */ }

  try {
    for (const it of listInventoryItems()) {
      if (!it.expiry) continue;
      if (inWindow(it.expiry)) out.ahead.push({ date: it.expiry, title: it.name, kind: 'expiry' });
    }
  } catch { /* ignore */ }

  /* ⑥ 好久没关注的面(2026-07-30 用户点名要的)。
     **没有变化本身是一种变化** —— 所以它当成一条 domainInsight 塞进去,
     自然走差分那条路:越过阈值那天算「新出现」,之后每天都在就不再刷屏。 */
  try {
    for (const it of domainNeglect(now)) out.domainInsights.push(it);
  } catch { /* ignore */ }

  /* ⑦ 没接上的线头 —— 我对「未来机会」的答复。
     Nesio 唯一有依据说「机会」的,是**你自己说过想做、却一直没动的事**,
     不是我觉得你该干什么。后者需要判断「什么对你好」,那是这个仓库的红线;
     而且推不准会连累前面那些确定的部分。 */
  try {
    out.threads = looseThreads(getLifeGraph(), now.getTime()).slice(0, 2).map((n) => n.name);
  } catch { /* ignore */ }

  return out;
}

/** 洞察页里那几个面 → 日报里的域名(和 DOMAIN_LABEL 对得上)。 */
const TAB_DOMAIN: Record<string, string> = {
  health: 'health',
  finance: 'finance',
  timeline: 'location',
  inventory: 'inventory',
  relationships: 'relationship',
  reflection: 'reading',
};

/** 多久没打开算「好久没关注」。三周 —— 再短会烦。 */
const NEGLECT_DAYS = 21;

/**
 * 好久没关注的面。
 *
 * 判据是**正向**的:必须**曾经打开过**(used 里有这个 key),然后超过 NEGLECT_DAYS 天没再打开。
 * 「从来没打开过」一律不算 —— 那不是「疏于关注」,那是「你可能压根不用这个功能」,
 * 而且新装 App 第二天就被告知「你三周没看健康了」是彻头彻尾的假话。
 * (数据源是 2026-07-30 才在洞察页切 tab 时开始记的,所以头三周这一段本来就该是空的。)
 */
export function domainNeglect(now: Date = new Date()): DailyReportDomainInsight[] {
  const out: DailyReportDomainInsight[] = [];
  if (typeof window === 'undefined') return out;
  const used = loadFeatureUsage().used || {};
  for (const [tab, domain] of Object.entries(TAB_DOMAIN)) {
    const last = used[`tab:${tab}`];
    if (typeof last !== 'number' || !Number.isFinite(last)) continue;   // 从没打开过 → 不判断
    const days = Math.floor((now.getTime() - last) / 86_400_000);
    if (days < NEGLECT_DAYS) continue;
    out.push({
      domain,
      severity: 'attention',
      title: `${days} 天没看了`,
      detail: '不是提醒你有问题,只是它这阵子没在你眼前',
    });
  }
  return out;
}

/**
 * 未来两周的日历项 → 「往前看」。
 * 单独一个函数,因为 events 在调用方手上(useTodayData 刚从缓存读出来)——
 * 回存储再读一遍只会读到另一个快照。
 */
export function aheadEvents(
  events: readonly { title?: string; start?: string }[],
  now: Date = new Date(),
): DailyReportAhead[] {
  const from = dayKeyOf(now);
  const until = new Date(now); until.setDate(until.getDate() + AHEAD_DAYS);
  const untilKey = dayKeyOf(until);
  const out: DailyReportAhead[] = [];
  for (const e of events) {
    if (!e.title || !e.start) continue;
    const d = new Date(e.start);
    if (Number.isNaN(d.getTime())) continue;
    const ymd = dayKeyOf(d);
    if (ymd > from && ymd <= untilKey) out.push({ date: ymd, title: e.title, kind: 'event' });
  }
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
