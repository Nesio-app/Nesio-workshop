/**
 * finance-aggregate — 财务月读侧：银行 ∪ 同币种域内 Expense。
 * @see docs/design/finance-aggregator-spec.md
 */

import { loadBankTx, summarizeMonth, type MonthSummary } from '@/lib/portal/bank-tx';
import { listExpenses } from '@/lib/portal/finance-sources';

export interface FinanceMonthAggregate extends MonthSummary {
  /** 同币种域内净支出（已并入 gross/net） */
  domainNet: number;
  domainCount: number;
  /** 异币种域内笔数（未并入 KPI，旁条展示） */
  otherCurrencyCount: number;
}

function normCur(c: string): string {
  return (c || '').trim().toUpperCase().replace('¥', 'CNY').replace('￥', 'CNY');
}

/**
 * 银行月汇总 + 同币种域内开销。
 * 异币种不进 KPI（避免 ¥ 混进 USD），由 FinanceTab 旁条另显。
 */
export function financeMonthAggregate(ym: string): FinanceMonthAggregate {
  const txs = loadBankTx();
  const bank = summarizeMonth(txs, ym);
  const domain = listExpenses(ym, { includeBank: false, includeDomain: true, financeOnly: true });
  const bankCur = normCur(bank.currency || 'USD');
  let domainNet = 0;
  let domainCount = 0;
  let otherCurrencyCount = 0;
  for (const e of domain) {
    if (normCur(e.currency) === bankCur) {
      domainNet += e.amount;
      domainCount += 1;
    } else {
      otherCurrencyCount += 1;
    }
  }
  domainNet = Math.round(domainNet * 100) / 100;
  return {
    ...bank,
    gross: Math.round((bank.gross + domainNet) * 100) / 100,
    net: Math.round((bank.net + domainNet) * 100) / 100,
    count: bank.count + domainCount,
    domainNet,
    domainCount,
    otherCurrencyCount,
  };
}
