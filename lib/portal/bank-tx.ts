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
  accountId?: string;
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
  const rules = loadMerchantRules();
  for (const t of txs) {
    if (txYm(t) !== ym || t.amount <= 0) continue;
    const cat = effectiveCategory(t, rules) || '未分类';
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

/* ---------- 批次 31:账户/卡片 ---------- */

export interface BankAccount {
  id: string;
  name: string;
  mask?: string;
  type?: string;
  subtype?: string;
  balance?: number;
  currency: string;
}

export const BANK_ACCOUNTS_KEY = 'nesio-bank-accounts-v1';

export function loadBankAccounts(): BankAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(BANK_ACCOUNTS_KEY) || '[]') as BankAccount[];
    return Array.isArray(raw) ? raw.filter((a) => a && a.id) : [];
  } catch { return []; }
}

/** 某账户某月的消费/退款/笔数。 */
export function accountMonth(txs: BankTx[], accountId: string, ym: string): { spend: number; refund: number; count: number } {
  let spend = 0, refund = 0, count = 0;
  for (const t of txs) {
    if (t.accountId !== accountId || txYm(t) !== ym) continue;
    count += 1;
    if (t.amount >= 0) spend += t.amount; else refund += -t.amount;
  }
  return { spend: round2(spend), refund: round2(refund), count };
}

/* ---------- 批次 31:商户→分类规则(交易页规则审核)---------- */

const MERCHANT_RULE_KEY = 'nesio-bank-merchant-rule-v1';

export function loadMerchantRules(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(MERCHANT_RULE_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

export function setMerchantRule(name: string, category: string): void {
  if (typeof window === 'undefined') return;
  const rules = loadMerchantRules();
  if (category.trim()) rules[name] = category.trim(); else delete rules[name];
  try { localStorage.setItem(MERCHANT_RULE_KEY, JSON.stringify(rules)); } catch { /* ignore */ }
}

/** 生效分类:用户规则优先,其次 Plaid 分类。 */
export function effectiveCategory(t: BankTx, rules = loadMerchantRules()): string {
  return rules[t.name] || t.category || '';
}

/** 需要审核的交易:本月、支出、没有生效分类的。 */
export function needsReview(txs: BankTx[], ym: string): BankTx[] {
  const rules = loadMerchantRules();
  return txs.filter((t) => txYm(t) === ym && t.amount > 0 && !effectiveCategory(t, rules)).sort((a, b) => b.amount - a.amount);
}

const SUGGEST_RULES: Array<[RegExp, string]> = [
  [/coffee|cafe|starbucks|餐|饭|restaurant|mcdonald|bakery|bar\b|dining/i, 'Food'],
  [/shop|store|mall|market|超市|商场|target|walmart|costco|amazon|ulta|ikea/i, 'Shopping'],
  [/uber|lyft|gas|shell|chevron|transit|parking|加油|地铁|taxi/i, 'Travel'],
  [/netflix|spotify|hulu|subscription|membership|订阅|会员/i, 'Services'],
  [/payment|autopay|还款|transfer|转账/i, 'Payment'],
];

/** 给未分类商户猜一个分类(简单关键词规则)。 */
export function suggestCategory(name: string): { category: string; confidence: number } {
  for (const [re, cat] of SUGGEST_RULES) if (re.test(name)) return { category: cat, confidence: 0.72 };
  return { category: 'Services', confidence: 0.4 };
}

/* ---------- 批次 31:月度趋势 + 风险预警 ---------- */

export function monthlyTrend(txs: BankTx[], n = 6): Array<{ ym: string; net: number }> {
  const months = availableMonths(txs).slice(0, n).reverse();
  return months.map((ym) => ({ ym, net: summarizeMonth(txs, ym).net }));
}

export interface FinanceAlert { level: 'risk' | 'warn' | 'info'; title: string; body: string }

/** 规则预警(不是 LLM):购物超均值 / 待审交易 / 净支出环比激增。 */
export function financeAlerts(txs: BankTx[], ym: string): FinanceAlert[] {
  const out: FinanceAlert[] = [];
  const rules = loadMerchantRules();

  // 购物类超过前 6 个月均值
  const shoppingRe = /shopping|购物/i;
  const monthShopping = txs.filter((t) => txYm(t) === ym && t.amount > 0 && shoppingRe.test(effectiveCategory(t, rules))).reduce((a, t) => a + t.amount, 0);
  const prevMonths = availableMonths(txs).filter((m) => m < ym).slice(0, 6);
  if (prevMonths.length >= 2) {
    const avg = prevMonths.reduce((a, m) => a + txs.filter((t) => txYm(t) === m && t.amount > 0 && shoppingRe.test(effectiveCategory(t, rules))).reduce((s, t) => s + t.amount, 0), 0) / prevMonths.length;
    if (avg > 0 && monthShopping > avg * 1.3) {
      const pct = Math.round(((monthShopping - avg) / avg) * 100);
      out.push({ level: 'warn', title: '购物支出高于往月', body: `本月购物比前 ${prevMonths.length} 个月均值高 ${pct}%` });
    }
  }

  // 待审交易
  const review = needsReview(txs, ym).length;
  if (review > 0) out.push({ level: 'info', title: `${review} 笔交易待归类`, body: '未匹配到分类的交易在「交易 → 规则审核」等你处理' });

  // 净支出环比激增
  const cur = summarizeMonth(txs, ym).net;
  const prevYmS = prevYm(ym);
  const prev = summarizeMonth(txs, prevYmS).net;
  if (prev > 0 && cur > prev * 1.5) {
    out.push({ level: 'risk', title: '净支出环比激增', body: `本月净支出比上月高 ${Math.round(((cur - prev) / prev) * 100)}%` });
  }

  return out;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = currency === 'USD' ? '$' : currency === 'CNY' || currency === 'RMB' ? '¥' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
