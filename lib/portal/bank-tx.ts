/**
 * Bank transactions — 本机 Plaid 流水的读取与聚合(批次 27)。
 *
 * ConnectorsHub.syncPlaid 把交易存进 localStorage['nesio-bank-tx-v1'](明细只存本机)。
 * 之前这份数据没有任何界面能看到,用户报「银行连了但记忆里没有」。
 * 这里提供纯函数聚合(本月净支出 / 分类占比 / 商户 Top),给支出分析视图用。
 *
 * 金额符号约定(Plaid):正数 = 花出去(支出),负数 = 进账(退款/收入)。
 */

import { reportStorageDropped } from './storage-health';
import { createBlobStore } from './idb-blob-store';

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
export const BANK_SYNCED_AT_KEY = 'nesio-bank-synced-at';

// 批次 57:流水/账户(体量大)挪 IndexedDB —— 腾 localStorage 配额;老数据水合时迁移。
// 规则(flow/merchant/recur)+ 同步时间戳(小)仍留 localStorage。
const txStore = createBlobStore<BankTx[]>({
  key: BANK_TX_KEY, updateEvent: 'nesio-bank-updated',
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

export function loadBankTx(): BankTx[] {
  const raw = txStore.load();
  // Number.isFinite 挡掉 NaN(typeof NaN === 'number' 会漏过去,污染整月汇总)。
  return Array.isArray(raw) ? raw.filter((t) => t && Number.isFinite(t.amount) && typeof t.date === 'string') : [];
}

/** 写入流水(供 ConnectorsHub.syncPlaid)。 */
export function saveBankTx(txs: BankTx[]): void {
  txStore.save(txs);
}

/** 是否已有流水数据(供 personalization has-data 门,避免直读已迁走的 localStorage)。 */
export function hasBankTxData(): boolean {
  const raw = txStore.load();
  return Array.isArray(raw) && raw.length > 0;
}

/** 上次 Plaid 同步时间(ISO);无则 null。供财务卡显示"数据截至何时"。 */
export function loadBankSyncedAt(): string | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(BANK_SYNCED_AT_KEY);
  return v || null;
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
    const c = (t.currency || '').toUpperCase();
    if (!c) continue; // 币种缺失的交易不参与主币种投票(也不进金额统计)
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

export function loadFlowRules(): Record<string, TxFlow> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(FLOW_RULE_KEY) || '{}') as Record<string, TxFlow>; } catch { return {}; }
}

export function setFlowRule(name: string, flow: TxFlow | ''): void {
  if (typeof window === 'undefined') return;
  const rules = loadFlowRules();
  if (flow) rules[name] = flow; else delete rules[name];
  try { localStorage.setItem(FLOW_RULE_KEY, JSON.stringify(rules)); } catch { reportStorageDropped(); }
}

/** 交易类型:用户规则优先,否则按 Plaid 分类自动判(转账/还款/收入不计收支)。 */
export function txFlow(t: BankTx, rules = loadFlowRules()): TxFlow {
  const forced = rules[t.name];
  if (forced) return forced;
  const cat = (t.category || '').toUpperCase();
  if (/INCOME/.test(cat)) return 'income';
  if (/TRANSFER|LOAN_PAYMENT/.test(cat)) return 'transfer';
  if (!cat) {
    // 分类缺失(Plaid 老账户/未增强常见):正数=花出去仍是可靠支出;负数=进账时无法区分
    // 退款/收入/转账,一律当 transfer 不计收支 —— 避免把工资/转账当退款倒扣净支出。
    return t.amount >= 0 ? 'expense' : 'transfer';
  }
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

/** 一笔交易的币种(大写归一;缺失返回 '' —— 不默认 USD,避免外币混入 USD 汇总)。 */
function ccyOf(t: BankTx): string {
  return (t.currency || '').toUpperCase();
}

/** 某月的主币种(与 summarizeMonth 同源:该月为空则退回全量),供分类/商户统一口径,
 *  修「分类·商户用全量主币种、KPI 用当月主币种 → 两套口径 + 贴错货币符号」。 */
function monthCurrency(txs: BankTx[], ym: string): string {
  const monthTxs = txs.filter((t) => txYm(t) === ym);
  return dominantCurrency(monthTxs.length ? monthTxs : txs);
}

/** 本月被排除出金额统计的"其他币种/缺币种"交易笔数 —— 财务卡据此如实提示"另有 N 笔未计入"。 */
export function excludedTxCount(txs: BankTx[], ym: string): number {
  const ccy = monthCurrency(txs, ym);
  return txs.filter((t) => txYm(t) === ym && ccyOf(t) !== ccy).length;
}

export function summarizeMonth(txs: BankTx[], ym: string): MonthSummary {
  const monthTxs = txs.filter((t) => txYm(t) === ym);
  // 只汇总主币种的交易 —— 跨币种裸加($100 + ¥700 = 800)会给出任何币种下都不存在的数字。
  const ccy = dominantCurrency(monthTxs.length ? monthTxs : txs);
  const flowRules = loadFlowRules();
  let gross = 0, refunds = 0, income = 0, count = 0;
  for (const t of monthTxs) {
    if (ccyOf(t) !== ccy) continue;
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
    currency: ccy,
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
  const ccy = monthCurrency(txs, ym); // 当月主币种,与 summarizeMonth/KPI 同口径
  for (const t of txs) {
    if (txYm(t) !== ym || ccyOf(t) !== ccy || txFlow(t, flowRules) !== 'expense') continue;
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
  const ccy = monthCurrency(txs, ym); // 当月主币种,与 KPI 同口径
  for (const t of txs) {
    if (txYm(t) !== ym || ccyOf(t) !== ccy || txFlow(t, flowRules) !== 'expense') continue;
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

const accountsStore = createBlobStore<BankAccount[]>({
  key: BANK_ACCOUNTS_KEY, updateEvent: 'nesio-bank-updated',
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

export function loadBankAccounts(): BankAccount[] {
  const raw = accountsStore.load();
  return Array.isArray(raw) ? raw.filter((a) => a && a.id) : [];
}

/** 写入账户(供 ConnectorsHub.syncPlaid)。 */
export function saveBankAccounts(accounts: BankAccount[]): void {
  accountsStore.save(accounts);
}

/** 某账户某月的消费/退款/笔数。 */
export function accountMonth(txs: BankTx[], accountId: string, ym: string): { spend: number; refund: number; count: number } {
  let spend = 0, refund = 0, count = 0;
  const flowRules = loadFlowRules();
  const acctTxs = txs.filter((t) => t.accountId === accountId);
  const ccy = dominantCurrency(acctTxs.length ? acctTxs : txs); // 单账户按其主币种,避免跨币种裸加
  for (const t of txs) {
    if (t.accountId !== accountId || txYm(t) !== ym || ccyOf(t) !== ccy) continue;
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
  try { localStorage.setItem(MERCHANT_RULE_KEY, JSON.stringify(rules)); } catch { reportStorageDropped(); }
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

/** 商户名分词(英文单词 + 中文串,长度≥2)。 */
function merchantTokens(name: string): string[] {
  return normalizeMerchant(name).split(/[^a-z0-9一-龥]+/).filter((t) => t.length >= 2);
}

/** 从用户已设的商户规则里学一个 token→分类 频次表(你的历史纠正就是训练数据)。 */
function learnTokenCategory(rules: Record<string, string>): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {};
  for (const [name, cat] of Object.entries(rules)) {
    for (const tok of merchantTokens(name)) {
      (map[tok] ||= {})[cat] = (map[tok][cat] || 0) + 1;
    }
  }
  return map;
}

/**
 * 给未分类商户猜分类:先用"你自己纠正过的同类词"投票(从数据学),没学到再退回关键词规则。
 * 例:你把 Wegmans / Trader Joe's 都归过 Food,新的 "Joe's Market" 命中 joe/market → Food。
 */
export function suggestCategory(name: string, rules: Record<string, string> = loadMerchantRules()): { category: string; confidence: number } {
  const learned = learnTokenCategory(rules);
  const votes: Record<string, number> = {};
  let total = 0;
  for (const tok of merchantTokens(name)) {
    const m = learned[tok];
    if (m) for (const [cat, c] of Object.entries(m)) { votes[cat] = (votes[cat] || 0) + c; total += c; }
  }
  if (total > 0) {
    const [cat, best] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    // 置信 = 该分类占比 × 证据量因子(1 个样本别太自信,4+ 个才接近上限)
    const confidence = Math.min(0.9, (best / total) * (0.6 + 0.3 * Math.min(1, total / 4)));
    return { category: cat, confidence: Math.round(confidence * 100) / 100 };
  }
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
  latestAmount: number;   // 最近一笔金额(供「订阅涨价」比对)
  baselineAmount: number; // 此前各笔的中位数(无历史时 = latestAmount)
}

/** 归一化商户名:去掉尾部门店号/流水号/日期,合并同一商家的多笔。 */
function normalizeMerchant(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[#*]?\s*\d[\d\-/.]{2,}.*$/, '') // 尾部数字串(门店号/日期)
    .replace(/\s+/g, ' ')
    .trim();
}

export function median(nums: number[]): number {
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
  try { localStorage.setItem(RECUR_RULE_KEY, JSON.stringify(all)); } catch { reportStorageDropped(); }
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
    const latestAmount = round2(amts[amts.length - 1]);
    const priorAmts = amts.slice(0, -1);
    const baselineAmount = priorAmts.length ? round2(median(priorAmts)) : latestAmount;

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
      latestAmount,
      baselineAmount,
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

/* ---------- 批次 31:月度趋势 ---------- */
// 风险预警已收口到 finance-insight.financeFindings(Layer1 漂移收口):此前这里另有一套
// financeAlerts(购物超均值/净支出激增),与统一层函数级双实现,财务页和 Today/问一问
// 据同一份流水各说各话。单类激增(泛化了购物专项)/净支出激增以 financeFindings 为准。

export function monthlyTrend(txs: BankTx[], n = 6): Array<{ ym: string; net: number }> {
  const months = availableMonths(txs).slice(0, n).reverse();
  return months.map((ym) => ({ ym, net: summarizeMonth(txs, ym).net }));
}

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = currency === 'USD' ? '$' : currency === 'CNY' || currency === 'RMB' ? '¥' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
