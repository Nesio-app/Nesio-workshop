/**
 * Bank transactions — 本机 Plaid 流水的读取与聚合(批次 27)。
 *
 * ConnectorsHub.syncPlaid 把交易存进 localStorage['nesio-bank-tx-v1'](明细只存本机)。
 * 之前这份数据没有任何界面能看到,用户报「银行连了但记忆里没有」。
 * 这里提供纯函数聚合(本月净支出 / 分类占比 / 商户 Top),给支出分析视图用。
 *
 * 金额符号约定(Plaid):正数 = 花出去(支出),负数 = 进账(退款/收入)。
 */

export interface BankTx {
  id: string;
  date: string; // 'YYYY-MM-DD'
  name: string;
  amount: number;
  currency: string;
  category: string;
}

export const BANK_TX_KEY = 'nesio-bank-tx-v1';

export function loadBankTx(): BankTx[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(BANK_TX_KEY) || '[]') as BankTx[];
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.amount === 'number' && typeof t.date === 'string') : [];
  } catch {
    return [];
  }
}

/** 'YYYY-MM' */
export function ymOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return ymOf(d);
}

function txYm(t: BankTx): string {
  return (t.date || '').slice(0, 7);
}

/** 数据里出现过的月份,从新到旧。 */
export function availableMonths(txs: BankTx[]): string[] {
  const set = new Set<string>();
  for (const t of txs) {
    const ym = txYm(t);
    if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
  }
  return [...set].sort().reverse();
}

export function dominantCurrency(txs: BankTx[]): string {
  const counts = new Map<string, number>();
  for (const t of txs) {
    const c = (t.currency || 'USD').toUpperCase();
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = 'USD';
  let max = 0;
  for (const [c, n] of counts) if (n > max) { max = n; best = c; }
  return best;
}

export interface MonthSummary {
  ym: string;
  net: number;
  gross: number;
  refunds: number;
  count: number;
  currency: string;
}

export function summarizeMonth(txs: BankTx[], ym: string): MonthSummary {
  const monthTxs = txs.filter((t) => txYm(t) === ym);
  let gross = 0;
  let refunds = 0;
  for (const t of monthTxs) {
    if (t.amount >= 0) gross += t.amount;
    else refunds += -t.amount;
  }
  return {
    ym,
    gross: round2(gross),
    refunds: round2(refunds),
    net: round2(gross - refunds),
    count: monthTxs.length,
    currency: dominantCurrency(monthTxs.length ? monthTxs : txs),
  };
}

export interface CategorySlice {
  category: string;
  total: number;
  pct: number; // 占本月总支出比例 0..100
  deltaPct: number | null; // 环比上月,null=上月无数据
}

export function categoryBreakdown(txs: BankTx[], ym: string): CategorySlice[] {
  const cur = sumByCategory(txs, ym);
  const prev = sumByCategory(txs, prevYm(ym));
  const grand = [...cur.values()].reduce((a, b) => a + b, 0) || 1;
  return [...cur.entries()]
    .map(([category, total]) => {
      const before = prev.get(category);
      const deltaPct = before && before > 0 ? Math.round(((total - before) / before) * 100) : null;
      return { category, total: round2(total), pct: Math.round((total / grand) * 100), deltaPct };
    })
    .sort((a, b) => b.total - a.total);
}

function sumByCategory(txs: BankTx[], ym: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) {
    if (txYm(t) !== ym || t.amount <= 0) continue;
    const cat = t.category || '其他';
    m.set(cat, (m.get(cat) || 0) + t.amount);
  }
  return m;
}

export interface MerchantAgg {
  name: string;
  total: number;
  count: number;
}

export function topMerchants(txs: BankTx[], ym: string, n = 5): MerchantAgg[] {
  const m = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    if (txYm(t) !== ym || t.amount <= 0) continue;
    const name = t.name || '未知商户';
    const cur = m.get(name) || { total: 0, count: 0 };
    cur.total += t.amount;
    cur.count += 1;
    m.set(name, cur);
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, total: round2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = currency === 'USD' ? '$' : currency === 'CNY' || currency === 'RMB' ? '¥' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
