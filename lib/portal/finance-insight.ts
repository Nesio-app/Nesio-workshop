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
  type BankTx,
  type BankAccount,
} from './bank-tx';

export type FinanceSeverity = 'flag' | 'attention'; // flag=值得尽快看, attention=可关注
export type FinanceFindingKind = 'anomaly' | 'subscription_hike' | 'cash_runway' | 'upcoming_bill';

export interface FinanceFinding {
  id: string;
  kind: FinanceFindingKind;
  severity: FinanceSeverity;
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

// 绝对额下限:低于此额的基数,百分比无统计意义(与 bank-tx MIN_ALERT_BASE 同精神)。
const MIN_BASE = 50;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── ② 异常支出:净支出环比激增 + 单类支出激增(复用 summarizeMonth / categoryBreakdown)──
function anomalyFindings(txs: BankTx[], ym: string): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  const cur = summarizeMonth(txs, ym);
  const prev = summarizeMonth(txs, prevYm(ym));

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

  // 单类支出激增(最大的一个,deltaPct≥60% 且该类金额够大)。
  const top = categoryBreakdown(txs, ym)
    .filter((c) => c.total >= MIN_BASE && c.deltaPct != null && c.deltaPct >= 60)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  if (top) {
    out.push({
      id: `finance-cat-surge-${top.category}`,
      kind: 'anomaly',
      severity: 'attention',
      title: [`「${top.category}」支出比往月高`, `${top.category} spending is up`],
      detail: [
        `本月「${top.category}」${formatMoney(top.total, cur.currency)},环比高 ${top.deltaPct}%`,
        `${top.category} ${formatMoney(top.total, cur.currency)} this month, +${top.deltaPct}% vs last`,
      ],
    });
  }
  return out;
}

// ── ② 订阅涨价:定期扣款里最近一笔明显高于此前基线(bank-tx 没有,这里新增)──
function subscriptionHikeFindings(txs: BankTx[]): FinanceFinding[] {
  const out: FinanceFinding[] = [];
  for (const r of detectRecurring(txs)) {
    // 需有历史基线(至少 3 笔),且涨幅 >10% 且绝对涨 ≥ $1(挡掉四舍五入噪音)。
    if (r.count < 3 || r.baselineAmount <= 0) continue;
    const rise = r.latestAmount - r.baselineAmount;
    if (r.latestAmount <= r.baselineAmount * 1.1 || rise < 1) continue;
    const pct = Math.round((rise / r.baselineAmount) * 100);
    out.push({
      id: `finance-hike-${r.name}`,
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
): FinanceFinding[] {
  if (!txs.length || !ym) return [];
  const all = [
    ...anomalyFindings(txs, ym),
    ...subscriptionHikeFindings(txs),
    ...cashRunwayFindings(txs, accounts),
    ...upcomingBillFindings(txs),
  ];
  const rank: Record<FinanceSeverity, number> = { flag: 0, attention: 1 };
  return all.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
