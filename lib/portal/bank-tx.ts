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

/* ---------- 批次 33:交易类型分流(修「转账/收入/还款被当退款」的算错)---------- */
// Plaid amount 约定:正=花出去,负=进账。但「进账」里混了 收入/转账/信用卡还款,
// 这些都不该计入收支。按 personal_finance_category 自动分流,并允许用户手动纠正、记住。

export type TxFlow = 'expense' | 'refund' | 'income' | 'transfer';

export const TX_FLOW_LABELS: Record<TxFlow, [string, string]> = {
  expense: ['支出', 'Expense'], refund: ['退款', 'Refund'], income: ['收入', 'Income'], transfer: ['转账/还款', 'Transfer'],
};

const FLOW_RULE_KEY = 'nesio-bank-flow-rule-v1';

// 环比"激增"类预警的绝对额下限:低于此额的基数,百分比无统计意义(不报噪音预警)。
const MIN_ALERT_BASE = 50;

export function loadFlowRules(): Record<string, TxFlow> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(FLOW_RULE_KEY) || '{}') as Record<string, TxFlow>; } catch { return {}; }
}

export function setFlowRule(name: string, flow: TxFlow | ''): void {
  if (typeof window === 'undefined') return;
  const rules = loadFlowRules();
  if (flow) rules[name] = flow; else delete rules[name];
  try { localStorage.setItem(FLOW_RULE_KEY, JSON.stringify(rules)); } catch { /* ignore */ }
}

/** 交易类型:用户规则优先,否则按 Plaid 分类自动判(转账/还款/收入不计收支)。 */
export function txFlow(t: BankTx, rules = loadFlowRules()): TxFlow {
  const forced = rules[t.name];
  if (forced) return forced;
  const cat = (t.category || '').toUpperCase();
  if (/INCOME/.test(cat)) return 'income';
  if (/TRANSFER|LOAN_PAYMENT/.test(cat)) return 'transfer';
  return t.amount >= 0 ? 'expense' : 'refund';
}

export interface MonthSummary {
  ym: string;
  net: number;
  gross: number;
  refunds: number;
  income: number;
  count: number;
  currency: string;
}

export function summarizeMonth(txs: BankTx[], ym: string): MonthSummary {
  const monthTxs = txs.filter((t) => txYm(t) === ym);
  const flowRules = loadFlowRules();
  let gross = 0, refunds = 0, income = 0, count = 0;
  for (const t of monthTxs) {
    const f = txFlow(t, flowRules);
    if (f === 'expense') { gross += Math.abs(t.amount); count += 1; }
    else if (f === 'refund') { refunds += Math.abs(t.amount); count += 1; }
    else if (f === 'income') income += Math.abs(t.amount);
    // transfer / 还款:不计收支
  }
  return {
    ym,
    gross: round2(gross),
    refunds: round2(refunds),
    net: round2(gross - refunds),
    income: round2(income),
    count,
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
  const flowRules = loadFlowRules();
  for (const t of txs) {
    if (txYm(t) !== ym || txFlow(t, flowRules) !== 'expense') continue;
    const cat = effectiveCategory(t, rules) || '未分类';
    m.set(cat, (m.get(cat) || 0) + Math.abs(t.amount));
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
  const flowRules = loadFlowRules();
  for (const t of txs) {
    if (txYm(t) !== ym || txFlow(t, flowRules) !== 'expense') continue;
    const name = t.name || '未知商户';
    const cur = m.get(name) || { total: 0, count: 0 };
    cur.total += Math.abs(t.amount);
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
  const flowRules = loadFlowRules();
  for (const t of txs) {
    if (t.accountId !== accountId || txYm(t) !== ym) continue;
    const f = txFlow(t, flowRules);
    if (f === 'expense') { spend += Math.abs(t.amount); count += 1; }
    else if (f === 'refund') { refund += Math.abs(t.amount); count += 1; }
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

/** 需要审核的交易:本月、真支出、没有生效分类的。 */
export function needsReview(txs: BankTx[], ym: string): BankTx[] {
  const rules = loadMerchantRules();
  const flowRules = loadFlowRules();
  return txs.filter((t) => txYm(t) === ym && txFlow(t, flowRules) === 'expense' && !effectiveCategory(t, rules)).sort((a, b) => b.amount - a.amount);
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

/* ---------- 批次 39:定期账单识别(Rocket Money 风)---------- */
// 按商户归并支出,找出周期性(周/双周/月/年)重复的扣款,估算下次日期与金额。

export interface RecurringCharge {
  name: string;
  category: string;
  avgAmount: number;
  count: number;
  lastDate: string;
  nextEstimate: string; // 'YYYY-MM-DD'
  cadenceDays: number;
  cadenceLabel: [string, string]; // [zh, en]
  currency: string;
}

/** 归一化商户名:去掉尾部门店号/流水号/日期,合并同一商家的多笔。 */
function normalizeMerchant(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[#*]?\s*\d[\d\-/.]{2,}.*$/, '') // 尾部数字串(门店号/日期)
    .replace(/\s+/g, ' ')
    .trim();
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function cadenceLabelFor(days: number): [string, string] | null {
  if (days >= 6 && days <= 8) return ['每周', 'Weekly'];
  if (days >= 12 && days <= 16) return ['每两周', 'Biweekly'];
  if (days >= 26 && days <= 35) return ['每月', 'Monthly'];
  if (days >= 58 && days <= 64) return ['每两月', 'Every 2 months'];
  if (days >= 85 && days <= 95) return ['每季', 'Quarterly'];
  if (days >= 350 && days <= 380) return ['每年', 'Yearly'];
  return null;
}

// 批次 39:定期 = 账单(订阅/水电/保险/房贷/会员/宽带/话费…),不是「常去的超市/咖啡」。
// 账单关键词命中 → 强定期候选;否则要求「金额稳定」(超市/餐饮金额飘,自动排除)。
const BILL_RE = /netflix|spotify|hulu|disney|youtube ?premium|hbo|prime video|apple\.com\/bill|icloud|adobe|dropbox|notion|chatgpt|openai|github|microsoft ?365|google ?(one|storage)|membership|会员|subscription|订阅|insurance|保险|geico|state ?farm|allstate|progressive|nationwide|premium|duke ?energy|电费|水费|燃气|gas ?(company|bill)|electric|water ?(bill|utility)|utility|comcast|xfinity|spectrum|at&t|verizon|t-?mobile|sprint|话费|宽带|internet|broadband|mortgage|房贷|月供|rent\b|房租|loan|贷款|student ?loan|gym|健身|planet ?fitness|la ?fitness|equinox|peloton|storage|自如|物业|hoa/i;
// 明确排除:餐饮/购物/超市/咖啡(去很多次也不是账单)
const NON_BILL_CAT_RE = /food|餐饮|shopping|购物|grocer|超市|coffee|咖啡/i;

/** 变异系数(标准差/均值)—— 账单金额稳定(低),超市/餐饮飘(高)。 */
function coeffVar(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  if (mean === 0) return 1;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / mean;
}

/** 把估算的下次日期滚动到今天之后(数据是历史的,别给出过去的「下次」)。 */
function rollForward(baseMs: number, cadenceDays: number): string {
  let t = baseMs;
  const step = cadenceDays * 86_400_000;
  const now = Date.now();
  let guard = 0;
  while (t < now && guard++ < 120) t += step;
  return new Date(t).toISOString().slice(0, 10);
}

// 批次 40:定期手动覆盖 —— 'yes'=强制算定期,'no'=强制排除。算法判断不对时用户自己调。
const RECUR_RULE_KEY = 'nesio-bank-recur-v1';
export function loadRecurRules(): Record<string, 'yes' | 'no'> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RECUR_RULE_KEY) || '{}') as Record<string, 'yes' | 'no'>; } catch { return {}; }
}
export function setRecurRule(name: string, v: 'yes' | 'no' | ''): void {
  if (typeof window === 'undefined') return;
  const all = loadRecurRules();
  if (v) all[name] = v; else delete all[name];
  try { localStorage.setItem(RECUR_RULE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/**
 * 识别定期账单(批次 39 重写,批次 40 加手动覆盖):
 * 1. 先按商户归并支出;2. 手动覆盖优先(yes 强制/no 排除);3. 否则判类别(账单关键词 OR
 *    非餐饮购物且金额稳定 CV<0.2);4. 间隔中位数落周期档;5. 下次日期滚动到未来。
 */
export function detectRecurring(txs: BankTx[]): RecurringCharge[] {
  const flowRules = loadFlowRules();
  const merchantRules = loadMerchantRules();
  const recurRules = loadRecurRules();
  const byKey = new Map<string, BankTx[]>();
  for (const t of txs) {
    if (txFlow(t, flowRules) !== 'expense') continue;
    if (!t.date) continue;
    const key = normalizeMerchant(t.name);
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(t);
    byKey.set(key, list);
  }

  const out: RecurringCharge[] = [];
  for (const list of byKey.values()) {
    if (list.length < 3) continue; // 至少 3 笔才谈得上「定期」
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const d = (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / 86_400_000;
      if (d > 0) gaps.push(d);
    }
    const medGap = median(gaps);
    const label = cadenceLabelFor(medGap);
    if (!label) continue;

    const last = sorted[sorted.length - 1];
    const cat = merchantRules[last.name] || suggestCategory(last.name).category;
    const amts = sorted.map((t) => Math.abs(t.amount));
    const avg = amts.reduce((s, v) => s + v, 0) / amts.length;
    const cv = coeffVar(amts);

    // ── 账单判定(手动覆盖优先)──
    const override = recurRules[last.name];
    if (override === 'no') continue; // 用户手动排除
    const isBillKeyword = BILL_RE.test(last.name);
    const isNonBill = NON_BILL_CAT_RE.test(cat) || NON_BILL_CAT_RE.test(last.name);
    // 关键词命中 = 账单(放宽金额);否则必须「非餐饮购物 且 金额稳定」;'yes' 强制算定期
    const qualifies = override === 'yes' || isBillKeyword || (!isNonBill && cv < 0.2);
    if (!qualifies) continue;

    out.push({
      name: last.name,
      category: cat,
      avgAmount: Math.round(avg * 100) / 100,
      count: sorted.length,
      lastDate: last.date,
      nextEstimate: rollForward(Date.parse(last.date) + medGap * 86_400_000, Math.round(medGap)),
      cadenceDays: Math.round(medGap),
      cadenceLabel: label,
      currency: last.currency || 'USD',
    });
  }
  return out.sort((a, b) => a.nextEstimate.localeCompare(b.nextEstimate));
}

/** 未来 n 天内预计的定期扣款汇总。 */
export function upcomingRecurring(txs: BankTx[], withinDays = 7): { items: RecurringCharge[]; total: number } {
  const now = Date.now();
  const horizon = now + withinDays * 86_400_000;
  const items = detectRecurring(txs).filter((r) => {
    const t = Date.parse(r.nextEstimate);
    return t >= now - 86_400_000 && t <= horizon;
  });
  return { items, total: Math.round(items.reduce((s, r) => s + r.avgAmount, 0) * 100) / 100 };
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
    if (avg >= MIN_ALERT_BASE && monthShopping >= MIN_ALERT_BASE && monthShopping > avg * 1.3) {
      const pct = Math.round(((monthShopping - avg) / avg) * 100);
      out.push({ level: 'warn', title: '购物支出高于往月', body: `本月购物比前 ${prevMonths.length} 个月均值高 ${pct}%` });
    }
  }

  // 待审交易
  const review = needsReview(txs, ym).length;
  if (review > 0) out.push({ level: 'info', title: `${review} 笔交易待归类`, body: '未匹配到分类的交易在「交易 → 规则审核」等你处理' });

  // 净支出环比激增。加绝对额下限:上月/本月净额太小(如上月 net $2)时百分比无统计意义,
  // 否则 $2 → $150 会报"激增 7400%"这种吓人却无意义的 risk 预警。
  const cur = summarizeMonth(txs, ym).net;
  const prevYmS = prevYm(ym);
  const prev = summarizeMonth(txs, prevYmS).net;
  if (prev >= MIN_ALERT_BASE && cur >= MIN_ALERT_BASE && cur > prev * 1.5) {
    out.push({ level: 'risk', title: '净支出环比激增', body: `本月净支出比上月高 ${Math.round(((cur - prev) / prev) * 100)}%` });
  }

  return out;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = currency === 'USD' ? '$' : currency === 'CNY' || currency === 'RMB' ? '¥' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
