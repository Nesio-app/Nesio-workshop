/**
 * 财务 L1 特征层(财务⑬,设计见 docs/design/finance-expert-layers.md)。
 *
 * 输入流水/账户,输出结构化特征,供 L2 判定 / L3 评分消费。全部纯函数、稳健统计
 * (median/MAD,不被单月尖峰污染)、数据不足返回 null 不硬算。不落库、不读存储
 * (调用方传入 loadBankTx()/loadBankAccounts() 的结果)。
 */
import {
  summarizeMonth, availableMonths, detectRecurring, effectiveCategory, txFlow, loadFlowRules,
  expenseMerchants, median, ymOf, merchantKey,
  type BankTx, type BankAccount, type RecurringCharge, type Holding,
} from './bank-tx';

const AVG_MONTH_DAYS = 30.44; // 公历平均月长,用于任意周期 → 月化

/* ---------- 分类个人基线(median/MAD) ---------- */

export interface CategoryBaseline {
  category: string;
  median: number; // 近 6 个完整月该类月支出中位数
  mad: number;    // 偏差中位数(稳健离散度)
  months: number; // 实际参与的月数(≥3 才出基线)
}

/** 近 6 个**完整**月(不含当前月)该类月支出基线;历史不足 3 个月返回 null(不硬算)。 */
export function categoryBaseline(txs: BankTx[], category: string, now: Date = new Date()): CategoryBaseline | null {
  const curYm = ymOf(now);
  const months = availableMonths(txs).filter((m) => m < curYm).slice(0, 6);
  if (months.length < 3) return null;
  const rules = loadFlowRules();
  const evidence = expenseMerchants(txs);
  const totals = months.map((ym) =>
    txs.filter((t) => (t.date || '').slice(0, 7) === ym
      && txFlow(t, rules, evidence) === 'expense'
      && effectiveCategory(t) === category)
      .reduce((s, t) => s + Math.abs(t.amount), 0));
  const med = median(totals);
  const mad = median(totals.map((v) => Math.abs(v - med)));
  return { category, median: Math.round(med * 100) / 100, mad: Math.round(mad * 100) / 100, months: months.length };
}

/** modified z-score(×0.6745/MAD,稳健异常口径;阈值惯例 3.5)。MAD=0 无法分辨,返回 null。 */
export function baselineZ(value: number, b: CategoryBaseline): number | null {
  if (!b || b.mad <= 0) return null;
  return Math.round(((0.6745 * (value - b.median)) / b.mad) * 100) / 100;
}

/* ---------- 收入检测(发薪流周期化) ---------- */

const PAYROLL_RE = /payroll|direct ?dep|\bdd\b|salary|wages|工资|薪/i;

export interface IncomeStream {
  name: string;
  cadenceDays: number;
  avgAmount: number;   // 单次进账中位数(绝对值)
  monthly: number;     // 月化
  count: number;
  lastDate: string;
}

export interface IncomeDetection {
  monthlyIncome: number; // 各流月化合计
  streams: IncomeStream[];
}

/**
 * 收入流:INCOME 类或名字带发薪词的负数(进账)交易,按商户归并;≥3 次、间隔规整
 * (MAD/中位 ≤0.3,与 detectRecurring 同门)才算流。输出各流周期与月化收入。
 */
export function detectIncome(txs: BankTx[]): IncomeDetection | null {
  const rules = loadFlowRules();
  const byKey = new Map<string, BankTx[]>();
  for (const t of txs) {
    if (t.amount >= 0 || !t.date) continue;
    const isIncome = txFlow(t, rules) === 'income' || PAYROLL_RE.test(t.name || '');
    if (!isIncome) continue;
    const key = merchantKey(t); // 财务⑲:entity id 优先归并发薪流
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(t);
  }
  const streams: IncomeStream[] = [];
  for (const list of byKey.values()) {
    if (list.length < 3) continue;
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const d = (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / 86_400_000;
      if (d > 0) gaps.push(d);
    }
    if (!gaps.length) continue;
    const medGap = median(gaps);
    const madGap = median(gaps.map((g) => Math.abs(g - medGap)));
    if (!medGap || medGap < 5 || medGap > 35 || madGap / medGap > 0.3) continue; // 周薪~月薪窗口,间隔要规整
    const avg = median(sorted.map((t) => Math.abs(t.amount)));
    const monthly = (avg * AVG_MONTH_DAYS) / medGap;
    const last = sorted[sorted.length - 1];
    streams.push({
      name: last.name,
      cadenceDays: Math.round(medGap),
      avgAmount: Math.round(avg * 100) / 100,
      monthly: Math.round(monthly * 100) / 100,
      count: sorted.length,
      lastDate: last.date,
    });
  }
  if (!streams.length) return null;
  const monthlyIncome = Math.round(streams.reduce((s, x) => s + x.monthly, 0) * 100) / 100;
  return { monthlyIncome, streams };
}

/* ---------- 收入构成(财务⑯:工资/利息/分红/退税…按细分类分桶) ---------- */

export interface IncomeSlice { detail: string; total: number }

/** 某月收入按 PFC 细分类分桶(缺细分归 INCOME_OTHER),金额降序。 */
export function incomeBreakdown(txs: BankTx[], ym: string): IncomeSlice[] {
  const rules = loadFlowRules();
  const m = new Map<string, number>();
  for (const t of txs) {
    if ((t.date || '').slice(0, 7) !== ym) continue;
    if (txFlow(t, rules) !== 'income') continue;
    const d = t.categoryDetail || 'INCOME_OTHER';
    m.set(d, (m.get(d) || 0) + Math.abs(t.amount));
  }
  return [...m.entries()]
    .map(([detail, total]) => ({ detail, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

/* ---------- 月度收支序列 ---------- */

export interface MonthCashflow { ym: string; income: number; net: number; saved: number }

/** 近 n 个月(含当前月,时间升序)的 收入/净支出/结余(= income − net)。 */
export function monthlyCashflow(txs: BankTx[], n = 6): MonthCashflow[] {
  return availableMonths(txs).slice(0, n).reverse().map((ym) => {
    const s = summarizeMonth(txs, ym);
    return { ym, income: s.income, net: s.net, saved: Math.round((s.income - s.net) * 100) / 100 };
  });
}

/* ---------- 订阅/账单月化负担 ---------- */

export interface SubscriptionLoad { monthly: number; count: number; items: Array<{ name: string; monthly: number }> }

/** 定期账单统一月化(avg × 30.44 ÷ 周期天数)后的合计 —— 「每月固定要出去多少」。 */
export function subscriptionLoad(txs: BankTx[], recurring: RecurringCharge[] = detectRecurring(txs)): SubscriptionLoad {
  const items = recurring.map((r) => ({
    name: r.name,
    monthly: Math.round(((r.avgAmount * AVG_MONTH_DAYS) / Math.max(1, r.cadenceDays)) * 100) / 100,
  }));
  return {
    monthly: Math.round(items.reduce((s, x) => s + x.monthly, 0) * 100) / 100,
    count: items.length,
    items,
  };
}

/* ---------- 余额投影(直接法:已知账单流出 + 发薪流入,逐日滚动) ---------- */

export interface BalanceProjection {
  start: number;            // 起点:存款账户余额合计
  min: number;              // 窗口内最低点
  minDate: string;
  negativeDate: string | null; // 首次转负的日期(null = 窗口内不转负)
  days: number;
}

/** 存款余额起步,未来 days 天逐日扣账单/加发薪;无存款余额数据返回 null。 */
export function balanceProjection(
  txs: BankTx[], accounts: BankAccount[], days = 30, now: Date = new Date(),
): BalanceProjection | null {
  const deposits = accounts.filter((a) => (a.type || '').toLowerCase() === 'depository' && typeof a.balance === 'number');
  if (!deposits.length) return null;
  const start = deposits.reduce((s, a) => s + (a.balance || 0), 0);

  // 事件表:date(ms) → Δ。账单:nextEstimate 起按周期滚;发薪:lastDate 起按周期滚进窗口。
  const events: Array<{ t: number; delta: number }> = [];
  const horizon = now.getTime() + days * 86_400_000;
  for (const r of detectRecurring(txs)) {
    let t = Date.parse(r.nextEstimate);
    const step = Math.max(1, r.cadenceDays) * 86_400_000;
    let guard = 0;
    while (t <= horizon && guard++ < 64) {
      if (t >= now.getTime()) events.push({ t, delta: -r.avgAmount });
      t += step;
    }
  }
  const income = detectIncome(txs);
  for (const s of income?.streams ?? []) {
    let t = Date.parse(s.lastDate);
    const step = Math.max(1, s.cadenceDays) * 86_400_000;
    let guard = 0;
    while (t <= horizon && guard++ < 64) {
      if (t >= now.getTime()) events.push({ t, delta: s.avgAmount });
      t += step;
    }
  }
  events.sort((a, b) => a.t - b.t);

  let bal = start;
  let min = start;
  let minDate = now.toISOString().slice(0, 10);
  let negativeDate: string | null = null;
  for (const e of events) {
    bal += e.delta;
    if (bal < min) { min = bal; minDate = new Date(e.t).toISOString().slice(0, 10); }
    if (bal < 0 && !negativeDate) negativeDate = new Date(e.t).toISOString().slice(0, 10);
  }
  return { start: Math.round(start * 100) / 100, min: Math.round(min * 100) / 100, minDate, negativeDate, days };
}

/* ---------- 投资组合(财务㉗:持仓聚合 / 结构占比 / 集中度) ---------- */

/** Plaid security.type → 展示标签(中文;未知类型原样透传)。 */
const SECURITY_TYPE_LABELS: Record<string, string> = {
  'equity': '股票',
  'etf': 'ETF',
  'mutual fund': '基金',
  'fixed income': '债券',
  'cash': '现金',
  'derivative': '衍生品',
  'cryptocurrency': '加密资产',
  'loan': '贷款类',
  'other': '其他',
};

export interface PortfolioPosition {
  name: string;
  ticker?: string;
  typeLabel: string;
  quantity: number;
  value: number;
  costBasis: number | null; // 该持仓总成本(机构缺数据 → null,不硬算盈亏)
  gain: number | null;      // value − costBasis
  pct: number;              // 占组合市值 %
}

export interface PortfolioSlice { label: string; value: number; pct: number }

export interface PortfolioSummary {
  totalValue: number;
  gain: number | null;     // 仅统计有成本数据的持仓;全缺 → null
  gainPct: number | null;
  positions: PortfolioPosition[]; // 按市值降序;同一证券跨账户合并
  byType: PortfolioSlice[];       // 结构占比,按市值降序
  concentrated: PortfolioPosition | null; // 单一持仓 >30%(多于一只时才提示)
}

/** 持仓聚合:同 ticker(无 ticker 用名称)跨账户合并;无持仓返回 null。 */
export function portfolioSummary(holdings: Holding[]): PortfolioSummary | null {
  const valid = holdings.filter((h) => h && typeof h.value === 'number' && h.value > 0);
  if (!valid.length) return null;
  const byKey = new Map<string, { name: string; ticker?: string; type: string; quantity: number; value: number; cost: number; hasCost: boolean; missingCost: boolean }>();
  for (const h of valid) {
    const key = (h.ticker || h.name).toUpperCase();
    const cur = byKey.get(key) ?? { name: h.name, ticker: h.ticker, type: (h.type || 'other').toLowerCase(), quantity: 0, value: 0, cost: 0, hasCost: false, missingCost: false };
    cur.quantity += h.quantity || 0;
    cur.value += h.value;
    if (typeof h.costBasis === 'number' && h.costBasis > 0) { cur.cost += h.costBasis; cur.hasCost = true; } else { cur.missingCost = true; }
    byKey.set(key, cur);
  }
  const totalValue = [...byKey.values()].reduce((s, p) => s + p.value, 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const positions: PortfolioPosition[] = [...byKey.values()]
    .map((p) => {
      // 成本残缺(部分账户没给)时不报盈亏,宁缺毋错
      const costOk = p.hasCost && !p.missingCost;
      return {
        name: p.name, ticker: p.ticker,
        typeLabel: SECURITY_TYPE_LABELS[p.type] ?? p.type,
        quantity: r2(p.quantity), value: r2(p.value),
        costBasis: costOk ? r2(p.cost) : null,
        gain: costOk ? r2(p.value - p.cost) : null,
        pct: totalValue > 0 ? Math.round((p.value / totalValue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  const typeMap = new Map<string, number>();
  for (const p of positions) typeMap.set(p.typeLabel, (typeMap.get(p.typeLabel) || 0) + p.value);
  const byType: PortfolioSlice[] = [...typeMap.entries()]
    .map(([label, value]) => ({ label, value: r2(value), pct: totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : 0 }))
    .sort((a, b) => b.value - a.value);

  const withCost = positions.filter((p) => p.gain !== null);
  const costSum = withCost.reduce((s, p) => s + (p.costBasis || 0), 0);
  const gain = withCost.length ? r2(withCost.reduce((s, p) => s + (p.gain || 0), 0)) : null;
  const gainPct = gain !== null && costSum > 0 ? Math.round((gain / costSum) * 1000) / 10 : null;

  // 集中度:只有一只时提示是噪音;现金类不算集中风险
  const top = positions.find((p) => p.typeLabel !== '现金');
  const concentrated = positions.length > 1 && top && top.pct > 30 ? top : null;

  return { totalValue: r2(totalValue), gain, gainPct, positions, byType, concentrated };
}
