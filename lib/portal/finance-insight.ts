/**
 * 财务洞察 —— 在 bank-tx 的确定性聚合之上做「模式识别 + 风险」,产出可进 Today 的 findings。
 *
 * 定位(仿健康四层的引擎/知识分离):
 *   bank-tx.ts = 数据层(解析/聚合/定期识别/账户),这里 = 判定层。
 *   不重复 bank-tx:复用 summarizeMonth / categoryBreakdown / detectRecurring / upcomingRecurring /
 *   账户余额;只加两类它没有的检测(订阅涨价、现金流跑道),并把已有的异常支出/未来账单
 *   归一成带分级、双语、稳定 id 的 finding —— 供 guidance 桥(financeFindingsToGuidanceEvents)消费。
 *
 * 全部确定性、可单测、非建议投资。阈值保守(有绝对额下限,避免小基数百分比噪音)。
 */
import {
  summarizeMonth,
  prevYm,
  categoryBreakdown,
  detectRecurring,
  upcomingRecurring,
  availableMonths,
  formatMoney,
  dominantCurrency,
  effectiveCategory,
  ymOf,
  median,
  type BankTx,
  type BankAccount,
} from './bank-tx';
import { categoryBaseline, baselineZ, balanceProjection, detectIncome, monthlyCashflow } from './finance-features';
import { categoryLabel } from './tx-category';

export type FinanceSeverity = 'flag' | 'attention'; // flag=值得尽快看, attention=可关注
export type FinanceFindingKind =
  | 'anomaly' | 'subscription_hike' | 'cash_runway' | 'upcoming_bill'
  // 财务⑭(L2,docs/design/finance-expert-layers.md):
  | 'fee_audit' | 'new_recurring' | 'balance_risk' | 'savings_rate';

export interface FinanceFinding {
  id: string;
  kind: FinanceFindingKind;
  severity: FinanceSeverity;
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

// 绝对额下限:低于此额的基数,百分比无统计意义(与 bank-tx MIN_ALERT_BASE 同精神)。
const MIN_BASE = 50;

// ── ② 异常支出:净支出环比激增 + 单类支出激增(复用 summarizeMonth / categoryBreakdown)──
function anomalyFindings(txs: BankTx[], ym: string, opts?: { domainNet?: number; prevDomainNet?: number }): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  // 口径统一:净支出与 KPI 同含域内(小票/手动)支出 —— 此前风险预警与页面 KPI 各说各话
  const curBase = summarizeMonth(txs, ym);
  const prevBase = summarizeMonth(txs, prevYm(ym));
  const cur = { ...curBase, net: Math.round((curBase.net + (opts?.domainNet ?? 0)) * 100) / 100 };
  const prev = { ...prevBase, net: Math.round((prevBase.net + (opts?.prevDomainNet ?? 0)) * 100) / 100 };

  // 净支出环比激增(>50%,两月都够大)。>100% 记 flag,否则 attention。
  if (prev.net >= MIN_BASE && cur.net >= MIN_BASE && cur.net > prev.net * 1.5) {
    const pct = Math.round(((cur.net - prev.net) / prev.net) * 100);
    out.push({
      id: 'finance-net-surge',
      kind: 'anomaly',
      severity: pct >= 100 ? 'flag' : 'attention',
      title: ['本月支出明显高于上月', 'Spending is well above last month'],
      detail: [
        `本月净支出 ${formatMoney(cur.net, cur.currency)},比上月高 ${pct}%`,
        `Net spend ${formatMoney(cur.net, cur.currency)}, ${pct}% above last month`,
      ],
    });
  }

  // 财务⑭:单类漂移 —— 对**个人基线**(近 6 完整月 median/MAD)的 modified z-score >3.5
  // 才报,替代「环比 >60%」的一刀切;基线可用的分类由 drift 负责,粗环比只兜底基线
  // 不足的分类(历史 <3 月 / MAD=0),避免同类双报。
  const cats = categoryBreakdown(txs, ym);
  const monthMid = new Date(`${ym}-15T00:00:00`);
  const driftOwned = new Set<string>();
  for (const c of cats) {
    if (c.total < MIN_BASE) continue;
    const b = categoryBaseline(txs, c.category, monthMid);
    if (!b) continue;
    const z = baselineZ(c.total, b);
    if (z == null) continue; // MAD=0(常数月)稳健口径无法分辨 → 留给环比兜底
    driftOwned.add(c.category);
    if (z > 3.5) {
      const zh = categoryLabel(c.category, 'zh');
      const en = categoryLabel(c.category, 'en');
      out.push({
        id: `finance-cat-drift-${c.category}`,
        kind: 'anomaly',
        severity: 'attention',
        title: [`「${zh}」支出高于你的习惯`, `${en} spending is above your usual`],
        detail: [
          `本月「${zh}」${formatMoney(c.total, cur.currency)},你近 ${b.months} 个月通常约 ${formatMoney(b.median, cur.currency)}`,
          `${en} ${formatMoney(c.total, cur.currency)} this month vs your usual ~${formatMoney(b.median, cur.currency)} (${b.months} mo)`,
        ],
      });
    }
  }

  // 单类支出激增(环比兜底:仅基线不可用的分类;deltaPct≥60% 且该类金额够大)。
  const top = cats
    .filter((c) => c.total >= MIN_BASE && c.deltaPct != null && c.deltaPct >= 60 && !driftOwned.has(c.category))
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  if (top) {
    // 财务②:分类已是 PFC 枚举,用户可见文案经 categoryLabel 出友好名(id 保持枚举,稳定)。
    const zh = categoryLabel(top.category, 'zh');
    const en = categoryLabel(top.category, 'en');
    out.push({
      id: `finance-cat-surge-${top.category}`,
      kind: 'anomaly',
      severity: 'attention',
      title: [`「${zh}」支出比往月高`, `${en} spending is up`],
      detail: [
        `本月「${zh}」${formatMoney(top.total, cur.currency)},环比高 ${top.deltaPct}%`,
        `${en} ${formatMoney(top.total, cur.currency)} this month, +${top.deltaPct}% vs last`,
      ],
    });
  }
  return out;
}

// ── 财务⑭:费用体检 —— 本月银行费用(ATM/透支/外币/利息)合计(BillGuard:灰色费用年均 ~$350)──
function feeAuditFindings(txs: BankTx[], ym: string): FinanceFinding[] {
  const fees = txs.filter((t) => (t.date || '').slice(0, 7) === ym && t.amount > 0 && effectiveCategory(t) === 'BANK_FEES');
  if (!fees.length) return [];
  const total = fees.reduce((s, t) => s + Math.abs(t.amount), 0);
  const ccy = fees[0].currency || dominantCurrency(txs);
  return [{
    id: 'finance-fee-audit',
    kind: 'fee_audit',
    severity: 'attention',
    title: ['本月有银行费用产生', 'Bank fees this month'],
    detail: [
      `${fees.length} 笔共 ${formatMoney(total, ccy)}(如 ${fees[0].name});多数费用可申请减免或调整习惯避开`,
      `${fees.length} fee(s), ${formatMoney(total, ccy)} (e.g. ${fees[0].name}) — many are waivable`,
    ],
  }];
}

// ── 财务⑭:新订阅知情 —— 刚成熟(恰好 3 笔)且首笔在近 90 天内的定期扣款(试用转付费是最常见灰色扣费)──
function newRecurringFindings(txs: BankTx[]): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  for (const r of detectRecurring(txs)) {
    if (r.count !== 3) continue;
    const firstMs = Date.parse(r.lastDate) - r.cadenceDays * (r.count - 1) * 86_400_000;
    if (Date.now() - firstMs > 90 * 86_400_000) continue;
    out.push({
      id: `finance-new-recur-${r.key}`,
      kind: 'new_recurring',
      severity: 'attention',
      title: [`新识别到定期扣款:${r.name}`, `New recurring charge: ${r.name}`],
      detail: [
        `${r.cadenceLabel[0]} ${formatMoney(r.avgAmount, r.currency)},近 3 期首次成型 —— 如不知情,值得看一眼(可能是试用转付费)`,
        `${r.cadenceLabel[1]}, ${formatMoney(r.avgAmount, r.currency)} — just matured; worth a look if unexpected (free trials often convert)`,
      ],
    });
  }
  return out;
}

// ── 财务⑭:余额风险 —— 30 天投影内存款转负(唯一配用 flag/红色的真实风险)──
function balanceRiskFindings(txs: BankTx[], accounts: BankAccount[]): FinanceFinding[] {
  const proj = balanceProjection(txs, accounts, 30);
  if (!proj || !proj.negativeDate) return [];
  const ccy = dominantCurrency(txs);
  return [{
    id: 'finance-balance-risk',
    kind: 'balance_risk',
    severity: 'flag',
    title: ['未来 30 天存款可能不够账单', 'Balance may not cover upcoming bills'],
    detail: [
      `按定期账单与发薪推算,约 ${proj.negativeDate.slice(5).replace('-', '/')} 前后余额见底(最低约 ${formatMoney(proj.min, ccy)});提前挪一笔或调整账单日即可`,
      `Projection dips below zero ~${proj.negativeDate} (low ~${formatMoney(proj.min, ccy)}) — moving funds or shifting a due date covers it`,
    ],
  }];
}

// ── 财务⑭:储蓄率 —— 有收入数据且最近 2 个完整月结余为负(50/30/20:20% 储蓄向)──
function savingsRateFindings(txs: BankTx[]): FinanceFinding[] {
  if (!detectIncome(txs)) return []; // 没有可靠收入流,不硬算
  const curYm = ymOf(new Date());
  const completed = monthlyCashflow(txs, 8).filter((m) => m.ym < curYm && m.income > 0);
  const last2 = completed.slice(-2);
  if (last2.length < 2 || !last2.every((m) => m.saved < 0)) return [];
  const ccy = dominantCurrency(txs);
  const gap = Math.abs(last2[last2.length - 1].saved);
  return [{
    id: 'finance-savings-rate',
    kind: 'savings_rate',
    severity: 'attention',
    title: ['最近两个月支出略高于收入', 'Spending has edged above income lately'],
    detail: [
      `上月支出比收入多约 ${formatMoney(gap, ccy)};不用一次补齐,先从一类支出轻轻收一点即可`,
      `Last month spent ~${formatMoney(gap, ccy)} over income — a gentle trim in one category is enough to start`,
    ],
  }];
}

// ── ② 订阅涨价:定期扣款里最近一笔明显高于此前基线(bank-tx 没有,这里新增)──
function subscriptionHikeFindings(txs: BankTx[]): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  for (const r of detectRecurring(txs)) {
    // 需有历史基线(至少 3 笔),且涨幅 ≥5% 且绝对涨 ≥ $1(挡掉四舍五入噪音)。
    // 财务⑭:阈值从 10% 放宽到 5% —— 订阅价格爬升(BillGuard "cost creep")常是小步慢涨。
    if (r.count < 3 || r.baselineAmount <= 0) continue;
    const rise = r.latestAmount - r.baselineAmount;
    if (r.latestAmount < r.baselineAmount * 1.05 || rise < 1) continue;
    const pct = Math.round((rise / r.baselineAmount) * 100);
    out.push({
      id: `finance-hike-${r.key}`,
      kind: 'subscription_hike',
      severity: pct >= 25 ? 'flag' : 'attention',
      title: [`${r.name} 定期扣款涨价了`, `${r.name} recurring charge went up`],
      detail: [
        `${r.name} 最近一笔 ${formatMoney(r.latestAmount, r.currency)},此前约 ${formatMoney(r.baselineAmount, r.currency)}(涨 ${pct}%)`,
        `${r.name} latest ${formatMoney(r.latestAmount, r.currency)} vs ~${formatMoney(r.baselineAmount, r.currency)} before (+${pct}%)`,
      ],
    });
  }
  return out;
}

// ── ③ 现金流跑道:存款账户余额 ÷ 近月均支出 = 还能撑几个月(bank-tx 没有,这里新增)──
// 保守:只用存款(depository)账户的正余额;需 ≥2 个月支出历史;跑道 <1.5 月记 flag,<3 月 attention。
function cashRunwayFindings(txs: BankTx[], accounts: BankAccount[]): FinanceFinding[] {
  const ccy = dominantCurrency(txs);
  const depository = accounts.filter(
    (a) => (a.type || '').toLowerCase() === 'depository'
      && typeof a.balance === 'number' && a.balance > 0
      && (a.currency || '').toUpperCase() === ccy,
  );
  if (!depository.length) return [];
  const balance = depository.reduce((s, a) => s + (a.balance || 0), 0);

  // 近月均支出(最多取 3 个最近月的 gross;需 ≥2 个月)。
  const months = availableMonths(txs).slice(0, 3);
  const grosses = months.map((m) => summarizeMonth(txs, m).gross).filter((g) => g > 0);
  if (grosses.length < 2) return [];
  const avgMonthly = median(grosses);
  if (avgMonthly < MIN_BASE) return [];

  const runwayMonths = balance / avgMonthly;
  if (runwayMonths >= 3) return [];
  const m = Math.round(runwayMonths * 10) / 10;
  return [{
    id: 'finance-cash-runway',
    kind: 'cash_runway',
    severity: runwayMonths < 1.5 ? 'flag' : 'attention',
    title: ['现金流跑道偏短', 'Cash runway is short'],
    detail: [
      `存款 ${formatMoney(balance, ccy)},按近月均支出约能撑 ${m} 个月`,
      `${formatMoney(balance, ccy)} in cash ≈ ${m} months at recent spend`,
    ],
  }];
}

// ── 未来账单:7 天内的定期扣款(复用 upcomingRecurring;时效性强,天然适合 Today)──
function upcomingBillFindings(txs: BankTx[]): FinanceFinding[] {
  const { items, total } = upcomingRecurring(txs, 7);
  if (!items.length) return [];
  const ccy = items[0].currency;
  const names = items.slice(0, 3).map((i) => i.name).join('、');
  const namesEn = items.slice(0, 3).map((i) => i.name).join(', ');
  return [{
    id: 'finance-upcoming-bills',
    kind: 'upcoming_bill',
    severity: 'attention',
    title: [`未来 7 天有 ${items.length} 笔定期扣款`, `${items.length} recurring charges in the next 7 days`],
    detail: [
      `约 ${formatMoney(total, ccy)}:${names}${items.length > 3 ? ' 等' : ''}`,
      `~${formatMoney(total, ccy)}: ${namesEn}${items.length > 3 ? '…' : ''}`,
    ],
  }];
}

/**
 * 财务 findings 总入口。ym 默认取最近有数据的月份。
 * 返回按严重度(flag 优先)排序的 finding —— 给 Today 桥;完整明细仍在财务页。
 */
export function financeFindings(
  txs: BankTx[],
  accounts: BankAccount[] = [],
  ym: string = availableMonths(txs)[0] ?? '',
  opts?: { domainNet?: number; prevDomainNet?: number },
): FinanceFinding[] {
  if (!txs.length || !ym) return [];
  const all = [
    ...anomalyFindings(txs, ym, opts),
    ...subscriptionHikeFindings(txs),
    ...cashRunwayFindings(txs, accounts),
    ...upcomingBillFindings(txs),
    ...feeAuditFindings(txs, ym),
    ...newRecurringFindings(txs),
    ...balanceRiskFindings(txs, accounts),
    ...savingsRateFindings(txs),
  ];
  const rank: Record<FinanceSeverity, number> = { flag: 0, attention: 1 };
  return all.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
