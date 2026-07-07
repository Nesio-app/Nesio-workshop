/**
 * 财务 L3 评分层(财务⑮,对标 health-risk):财务体检分项 —— 有出处的通行标准,
 * 数据齐才算(不为凑指标硬编),分项呈现不合成单一总分(CFPB Well-Being 是问卷量表,
 * 交易数据只能近似其客观面,合成总分会冒充精度)。纯函数、非投资建议。
 */
import {
  summarizeMonth, availableMonths, dominantCurrency, formatMoney, median, ymOf,
  type BankTx, type BankAccount,
} from './bank-tx';
import { detectIncome, subscriptionLoad, monthlyCashflow } from './finance-features';

export type FinanceRiskCategory = 'info' | 'low' | 'moderate' | 'high';

export interface FinanceScore {
  id: string;
  label: [string, string];
  value: string;             // 展示值(如 "4.2 mo" / "18%")
  category: FinanceRiskCategory;
  detail: [string, string];
  source: string;
}

const MIN_SPEND = 50; // 月净支出低于此额,比率无意义

/** 近 6 个完整月的月净支出 median(≥2 个有效月才算)。 */
function monthlyNetMedian(txs: BankTx[], now: Date): number | null {
  const curYm = ymOf(now);
  const nets = availableMonths(txs)
    .filter((m) => m < curYm).slice(0, 6)
    .map((m) => summarizeMonth(txs, m).net)
    .filter((n) => n >= MIN_SPEND);
  if (nets.length < 2) return null;
  return median(nets);
}

export function computeFinanceScores(txs: BankTx[], accounts: BankAccount[] = [], now: Date = new Date()): FinanceScore[] {
  const out: FinanceScore[] = [];
  if (!txs.length) return out;
  const ccy = dominantCurrency(txs);
  const netMedian = monthlyNetMedian(txs, now);

  // ── 应急金月数 = 存款 ÷ 月净支出 median(3–6 个月是通行共识)──
  const deposits = accounts
    .filter((a) => (a.type || '').toLowerCase() === 'depository' && typeof a.balance === 'number' && (a.balance || 0) > 0 && (a.currency || 'USD').toUpperCase() === ccy)
    .reduce((s, a) => s + (a.balance || 0), 0);
  if (deposits > 0 && netMedian) {
    const m = Math.round((deposits / netMedian) * 10) / 10;
    const category: FinanceRiskCategory = m < 1 ? 'high' : m < 3 ? 'moderate' : m < 6 ? 'low' : 'info';
    out.push({
      id: 'finance-score-emergency-fund',
      label: ['应急金', 'Emergency fund'],
      value: `${m} mo`,
      category,
      detail: [
        `存款 ${formatMoney(deposits, ccy)} ≈ ${m} 个月支出;通行参考是 3–6 个月`,
        `${formatMoney(deposits, ccy)} ≈ ${m} months of spend; 3–6 months is the common guideline`,
      ],
      source: 'Fidelity / St. Louis Fed(3–6 个月应急金共识)',
    });
  }

  // ── 储蓄率 = (收入 − 净支出) / 收入(近 3 个完整月 median;需可靠收入流)──
  const income = detectIncome(txs);
  if (income && netMedian) {
    const curYm = ymOf(now);
    const rates = monthlyCashflow(txs, 8)
      .filter((mc) => mc.ym < curYm && mc.income > 0)
      .slice(-3)
      .map((mc) => (mc.income - mc.net) / mc.income);
    if (rates.length >= 2) {
      const r = median(rates);
      const pct = Math.round(r * 100);
      const category: FinanceRiskCategory = r < 0 ? 'high' : r < 0.1 ? 'moderate' : r < 0.2 ? 'low' : 'info';
      out.push({
        id: 'finance-score-savings-rate',
        label: ['储蓄率', 'Savings rate'],
        value: `${pct}%`,
        category,
        detail: [
          `近几个月收入约 ${formatMoney(income.monthlyIncome, ccy)}/月,结余約 ${pct}%;50/30/20 法则建议 20% 归储蓄`,
          `~${formatMoney(income.monthlyIncome, ccy)}/mo income, saving ~${pct}%; the 50/30/20 rule suggests 20% to savings`,
        ],
        source: '50/30/20 预算法则(Warren)',
      });
    }
  }

  // ── 订阅负担率 = 定期账单月化 ÷ 月收入(>10% 值得盘一盘)──
  if (income) {
    const load = subscriptionLoad(txs);
    if (load.count > 0 && income.monthlyIncome > 0) {
      const ratio = load.monthly / income.monthlyIncome;
      const pct = Math.round(ratio * 100);
      const category: FinanceRiskCategory = ratio > 0.1 ? 'moderate' : ratio > 0.05 ? 'low' : 'info';
      out.push({
        id: 'finance-score-subscription-load',
        label: ['订阅负担', 'Subscription load'],
        value: `${pct}%`,
        category,
        detail: [
          `${load.count} 项定期约 ${formatMoney(load.monthly, ccy)}/月,占收入 ${pct}%;超过 10% 值得盘一盘哪些还在用`,
          `${load.count} recurring ≈ ${formatMoney(load.monthly, ccy)}/mo (${pct}% of income); above 10% is worth an audit`,
        ],
        source: '订阅审计实践(Rocket Money 口径,策展)',
      });
    }
  }

  // ── 信用卡额度利用率 = 欠款合计 ÷ 额度合计(FICO:<30% 好;不用红——不是安全风险)──
  const cards = accounts.filter((a) =>
    (a.type || '').toLowerCase() === 'credit' && typeof a.balance === 'number' && typeof a.limit === 'number' && (a.limit || 0) > 0);
  if (cards.length) {
    const owed = cards.reduce((s, a) => s + Math.max(0, a.balance || 0), 0);
    const limit = cards.reduce((s, a) => s + (a.limit || 0), 0);
    const ratio = owed / limit;
    const pct = Math.round(ratio * 100);
    const category: FinanceRiskCategory = ratio < 0.3 ? 'info' : ratio <= 0.5 ? 'low' : 'moderate';
    out.push({
      id: 'finance-score-credit-utilization',
      label: ['额度利用率', 'Credit utilization'],
      value: `${pct}%`,
      category,
      detail: [
        `${cards.length} 张信用卡共欠 ${formatMoney(owed, ccy)},额度 ${formatMoney(limit, ccy)},利用率 ${pct}%;信用评分口径 30% 以内最友好${ratio > 0.5 ? ',有空可以想想先还哪张' : ''}`,
        `${cards.length} card(s) owe ${formatMoney(owed, ccy)} of ${formatMoney(limit, ccy)} (${pct}%); under 30% is friendliest to credit scores${ratio > 0.5 ? ' — worth planning which to pay down first' : ''}`,
      ],
      source: 'FICO(利用率占评分约 30%,<30% 通行参考)',
    });
  }

  const rank: Record<FinanceRiskCategory, number> = { high: 0, moderate: 1, low: 2, info: 3 };
  return out.sort((a, b) => rank[a.category] - rank[b.category]);
}
