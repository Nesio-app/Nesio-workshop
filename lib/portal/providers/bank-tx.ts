/**
 * Bank transactions — 本机 Plaid 流水的读取与聚合(批次 27)。
 *
 * ConnectorsHub.syncPlaid 把交易存进 localStorage['nesio-bank-tx-v1'](明细只存本机)。
 * 之前这份数据没有任何界面能看到,用户报「银行连了但记忆里没有」。
 * 这里提供纯函数聚合(本月净支出 / 分类占比 / 商户 Top),给支出分析视图用。
 *
 * 金额符号约定(Plaid):正数 = 花出去(支出),负数 = 进账(退款/收入)。
 */

import { reportStorageDropped } from '../storage-health';
import { createBlobStore } from '../idb-blob-store';
import { normalizeCategory } from '../tx-category';

export interface BankTx {
  id: string;
  date: string; // 'YYYY-MM-DD'
  name: string;
  amount: number;
  currency: string;
  category: string;
  categoryDetail?: string; // 财务⑨:Plaid PFC detailed(FOOD_AND_DRINK_COFFEE…),只作展示细化
  accountId?: string;
  merchantId?: string;   // 财务⑲:Plaid merchant_entity_id —— 官方商户实体,归并同商户不同描述符
  merchantLogo?: string; // 商户 logo URL(Plaid 提供;可缺)
}

/** 财务⑲:商户归并键 —— Plaid 官方实体 id 优先("NETFLIX.COM 866-…"/"Netflix Inc" 同 id),
 * 缺失(老数据/无富化的机构)回退字符串归一。定期识别/退款证据/商户 Top 统一用它。 */
export function merchantKey(t: Pick<BankTx, 'name' | 'merchantId'>): string {
  return t.merchantId || normalizeMerchant(t.name);
}

/** 财务㉚:学习规则三级读取 —— entity 键(商户改名不变)→ 归一名(描述符噪音)→
 * 原始名(老规则原位兼容,不做数据迁移)。 */
function ruleFor<T>(rules: Record<string, T>, t: Pick<BankTx, 'name' | 'merchantId'>): T | undefined {
  return rules[merchantKey(t)] ?? rules[normalizeMerchant(t.name)] ?? rules[t.name];
}

export const BANK_TX_KEY = 'nesio-bank-tx-v1';
export const BANK_SYNCED_AT_KEY = 'nesio-bank-synced-at';

// 批次 57:流水/账户(体量大)挪 IndexedDB —— 腾 localStorage 配额;老数据水合时迁移。
// 规则(flow/merchant/recur)+ 同步时间戳(小)仍留 localStorage。
const txStore = createBlobStore<BankTx[]>({
  key: BANK_TX_KEY, updateEvent: 'nesio-bank-updated',
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

/**
 * 孤儿交易过滤(财务①:sandbox 混库清洗)—— 交易的 accountId 不属于任何已知账户 = 旧环境残留
 * (换 Plaid item/环境后,旧交易永远不在新 item 的 removedIds 里,靠这里识别)。
 * fail-safe:账户表为空(没同步过账户/水合未完成)不过滤;无 accountId 的老数据保守保留。
 * 账户表是按 id 只增合并的(见 saveBankAccounts),临时失败的银行不丢账户 → 不会误杀活银行交易。
 */
export function filterToKnownAccounts(txs: BankTx[], accounts: BankAccount[]): BankTx[] {
  if (!accounts.length) return txs;
  const known = new Set(accounts.map((a) => a.id));
  // 财务⑪:早期同步代码不存 accountId,那批(sandbox 时代)残留曾靠"保守保留"永远清不掉
  // (Madison/Tectra $500 假商户一直赖在定期页)。只要数据集里已有带 accountId 的现代交易,
  // 无 accountId 的就是旧环境残留 → 隐藏;整库都没有 accountId(纯老用户)才整体保留。
  const hasModern = txs.some((t) => t.accountId);
  return txs.filter((t) => (t.accountId ? known.has(t.accountId) : !hasModern));
}

export function loadBankTx(): BankTx[] {
  const raw = txStore.load();
  // Number.isFinite 挡掉 NaN(typeof NaN === 'number' 会漏过去,污染整月汇总)。
  const base = Array.isArray(raw) ? raw.filter((t) => t && Number.isFinite(t.amount) && typeof t.date === 'string') : [];
  // 读时过滤孤儿:显示立即治愈;下次同步 merge 经由本函数 → 储存自然清掉。备份读原始 IDB,可逆。
  return filterToKnownAccounts(base, loadBankAccounts());
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

export type TxFlow = 'expense' | 'refund' | 'rebate' | 'income' | 'transfer';

export const TX_FLOW_LABELS: Record<TxFlow, [string, string]> = {
  expense: ['支出', 'Expense'], refund: ['退款', 'Refund'], rebate: ['返还/报销', 'Credit'], income: ['收入', 'Income'], transfer: ['转账/还款', 'Transfer'],
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

/** 财务㉚:按 merchantKey 写类型规则(entity id 优先)——商户改描述符/改名后规则仍生效。 */
export function setFlowRuleFor(t: Pick<BankTx, 'name' | 'merchantId'>, flow: TxFlow | ''): void {
  const key = merchantKey(t);
  setFlowRule(key, flow);
  if (flow) rememberRuleLabel(key, t.name);
}

// 财务⑤:statement credit(卡权益返还/报销,AMEX Global Entry credit、rebate、cashback 等)
// 不是商户退款——没有对应的「退货」动作,叫「退款」误导。只在本会判成 refund 的分支上按
// 名字保守识别(CREDIT UNION 是机构名,排除);金额口径与退款相同(冲抵支出),纯语义分流。
const REBATE_NAME_RE = /STATEMENT CREDIT|\bREBATE\b|REIMBURSE|CASH ?BACK|\bCREDIT\b(?!\s+UNION)|返还|报销/i;

/** 财务⑪:退款证据集 —— 数据集中出现过支出的商户(⑲:entity id 优先归并)。退款必须有对应的"买过"。 */
export function expenseMerchants(txs: BankTx[]): Set<string> {
  const out = new Set<string>();
  for (const t of txs) {
    if (t.amount > 0) {
      const k = merchantKey(t);
      if (k) out.add(k);
      // 兼容:老支出无 merchantId、新退款有 —— 归一名同样入证据集,两把钥匙都能开
      const nk = normalizeMerchant(t.name);
      if (nk) out.add(nk);
    }
  }
  return out;
}

/**
 * 交易类型:用户规则优先,否则按 Plaid 分类自动判(转账/还款/收入不计收支)。
 * 财务⑪:传入 evidence(expenseMerchants)时,负数交易只有该商户买过才算 refund,
 * 否则归 transfer —— PayPal 收款/亲友转入此前被记成「退款」倒扣净支出。不传保持旧行为。
 */
export function txFlow(t: BankTx, rules = loadFlowRules(), evidence?: Set<string>): TxFlow {
  const forced = ruleFor(rules, t);
  if (forced) return forced;
  const cat = (t.category || '').toUpperCase();
  if (/INCOME/.test(cat)) return 'income';
  if (/TRANSFER|LOAN_PAYMENT/.test(cat)) return 'transfer';
  if (!cat) {
    // 分类缺失(Plaid 老账户/未增强常见):正数=花出去仍是可靠支出;负数=进账时无法区分
    // 退款/收入/转账,一律当 transfer 不计收支 —— 避免把工资/转账当退款倒扣净支出。
    return t.amount >= 0 ? 'expense' : 'transfer';
  }
  if (t.amount >= 0) return 'expense';
  if (REBATE_NAME_RE.test(t.name || '')) return 'rebate';
  if (evidence && !evidence.has(merchantKey(t)) && !evidence.has(normalizeMerchant(t.name))) return 'transfer';
  return 'refund';
}

/* ---------- 财务③:内部调整对识别 ---------- */
// 银行内部重分配(cash advance 调整等)常成对出现:同日、同账户、同额一正一负、名字带调整词。
// 净效果为零、对用户零信息量,但以两条噪音行出现在交易列表。这里保守配对(双方名字都须命中
// 关键词,不凭金额巧合杀真交易),供显示层折叠;它们本就是 transfer 流,统计不受影响。
const ADJUSTMENT_NAME_RE = /\bADJ\b|REDIST|ADJUSTMENT|REVERSAL|OFFSET|冲正|调整/i;

/** 返回可折叠的内部调整对的交易 id 集合(一对一贪心配对,配不上的单条保留)。 */
export function internalAdjustmentIds(txs: BankTx[]): Set<string> {
  const out = new Set<string>();
  const buckets = new Map<string, BankTx[]>(); // date|accountId|abs(amount) → 候选
  for (const t of txs) {
    if (!ADJUSTMENT_NAME_RE.test(t.name || '')) continue;
    const key = `${t.date}|${t.accountId || ''}|${Math.abs(t.amount)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(t);
  }
  for (const group of buckets.values()) {
    const pos = group.filter((t) => t.amount > 0);
    const neg = group.filter((t) => t.amount < 0);
    const pairs = Math.min(pos.length, neg.length);
    for (let i = 0; i < pairs; i++) { out.add(pos[i].id); out.add(neg[i].id); }
  }
  return out;
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
  const evidence = expenseMerchants(txs); // 财务⑪:退款要有"买过"的证据,否则按转账不计收支
  let gross = 0, refunds = 0, income = 0, count = 0;
  for (const t of monthTxs) {
    if (ccyOf(t) !== ccy) continue;
    const f = txFlow(t, flowRules, evidence);
    if (f === 'expense') { gross += Math.abs(t.amount); count += 1; }
    else if (f === 'refund' || f === 'rebate') { refunds += Math.abs(t.amount); count += 1; } // 返还与退款同口径冲抵支出
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
  deltaPct: number | null; // 环比上月;null=上月无数据或基数太小(百分比无意义)
  isNew: boolean; // 上月完全没有此类支出
}

// 财务④:环比基数下限。上月不足 $50 的类别,百分比全是小基数噪音(¥30→¥314 就是
// +946%),读者得到的是惊吓不是信息;这类只标「新增」或干脆不标。
const DELTA_MIN_BASE = 50;

export function categoryBreakdown(txs: BankTx[], ym: string): CategorySlice[] {
  const cur = sumByCategory(txs, ym);
  const prev = sumByCategory(txs, prevYm(ym));
  const grand = [...cur.values()].reduce((a, b) => a + b, 0) || 1;
  return [...cur.entries()]
    .map(([category, total]) => {
      const before = prev.get(category) || 0;
      const deltaPct = before >= DELTA_MIN_BASE ? Math.round(((total - before) / before) * 100) : null;
      return { category, total: round2(total), pct: Math.round((total / grand) * 100), deltaPct, isNew: before <= 0 };
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
  logo?: string; // 财务⑲:商户 logo URL(Plaid 富化;可缺)
}

export function topMerchants(txs: BankTx[], ym: string, n = 5): MerchantAgg[] {
  const m = new Map<string, { total: number; count: number }>();
  const flowRules = loadFlowRules();
  const ccy = monthCurrency(txs, ym); // 当月主币种,与 KPI 同口径
  // 财务⑲:按商户实体归并(entity id 优先)——"NETFLIX.COM 866-…"/"Netflix Inc" 合成一行
  const meta = new Map<string, { name: string; logo?: string }>();
  for (const t of txs) {
    if (txYm(t) !== ym || ccyOf(t) !== ccy || txFlow(t, flowRules) !== 'expense') continue;
    const key = merchantKey(t) || '未知商户';
    const cur = m.get(key) || { total: 0, count: 0 };
    cur.total += Math.abs(t.amount);
    cur.count += 1;
    m.set(key, cur);
    meta.set(key, { name: t.name || '未知商户', logo: t.merchantLogo || meta.get(key)?.logo });
  }
  return [...m.entries()]
    .map(([key, v]) => ({ name: meta.get(key)?.name || key, logo: meta.get(key)?.logo, total: round2(v.total), count: v.count }))
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
  limit?: number;       // 财务㉙:信用卡额度(利用率 = balance/limit)
  currency: string;
  institution?: string; // 财务⑧:机构名(Chase / American Express…)
  logo?: string;        // 机构 logo(base64 PNG,Plaid 提供;可缺)
  color?: string;       // 机构主色(#rrggbb;可缺)
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

/**
 * 写入账户(供 ConnectorsHub.syncPlaid)。财务①:默认按 id **只增合并**,不整体替换 ——
 * 多银行时某家临时失败(API 报错/重连中)当次返回不含它的账户,整体替换会把它从账户表里
 * 抹掉,进而让孤儿过滤误杀它的交易。合并语义:同 id 用最新字段(余额/名称会更新),
 * 未出现的旧账户保留(历史数据仍可归属;「彻底删除」仍全清)。
 *
 * 财务⑧:路由确认「本次每个存活 token 的账户都拉全了」(authoritative)时用 replace 整体
 * 替换 —— 只增合并永不退场,重复授权留下的旧 item 账户会一直重复显示、其交易双份计数;
 * 权威快照替换后,旧 item 的本地交易被孤儿过滤自动隐藏。
 */
// 财务⑪→⑯:同一实体账户判定。⑪要求名字完全相同,但新旧 item 对同一账户可能给出
// 不同写法的名字(官方名 vs 显示名),重复副本因此漏杀(用户「7937 还是 2 个」)。
// 加固:mask + 类型(subtype/type)相同,且 ① 双方机构相同,或 ② 旧条目没有机构元数据
// (⑧ 之前的存量,恰是重复来源),或 ③ 归一化名字相同。缺 mask 一律不判(保守)。
const acctTypeKey = (a: BankAccount) => (a.subtype || a.type || '').toLowerCase();
function isSameUnderlyingAccount(incoming: BankAccount, stored: BankAccount): boolean {
  if (!incoming?.mask || !stored?.mask || incoming.mask !== stored.mask) return false;
  if (acctTypeKey(incoming) !== acctTypeKey(stored)) return false;
  if (stored.institution && incoming.institution) return stored.institution === incoming.institution;
  if (!stored.institution) return true;
  return (stored.name || '').trim().toLowerCase() === (incoming.name || '').trim().toLowerCase();
}

/* ---------- 财务㉗:投资持仓(点时快照,同步时整体替换) ---------- */

export interface Holding {
  accountId: string;
  name: string;
  ticker?: string;
  type?: string;    // equity / etf / mutual fund / cash / fixed income / …(Plaid security type)
  quantity: number;
  value: number;    // 市值(机构口径)
  costBasis?: number;
  currency: string;
}

export const BANK_HOLDINGS_KEY = 'nesio-fin-holdings-v1';

const holdingsStore = createBlobStore<Holding[]>({
  key: BANK_HOLDINGS_KEY, updateEvent: 'nesio-bank-updated',
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

export function loadHoldings(): Holding[] {
  const raw = holdingsStore.load();
  return Array.isArray(raw) ? raw : [];
}

/** 持仓是点时快照 → 整体替换(空列表不写,防同步半途清空)。 */
export function saveHoldings(holdings: Holding[]): void {
  if (!holdings.length) return;
  holdingsStore.save(holdings.filter((h) => h && h.accountId));
}

/** 财务⑯:手动移除账户(重复/失效副本兜底)。若该账户仍在连接中,下次同步会重新拉回。 */
export function removeBankAccount(id: string): void {
  accountsStore.save(loadBankAccounts().filter((a) => a.id !== id));
}

export function saveBankAccounts(accounts: BankAccount[], opts?: { replace?: boolean }): void {
  if (opts?.replace && accounts.length > 0) {
    accountsStore.save(accounts.filter((a) => a?.id));
    return;
  }
  const cur = accountsStore.load();
  const byId = new Map<string, BankAccount>();
  for (const a of Array.isArray(cur) ? cur : []) if (a?.id) byId.set(a.id, a);
  // 指纹去重:本次同步的账户与既存账户是同一实体账户但不同 id → 旧 id 是重复授权残留,
  // 退场(其交易随之被孤儿过滤隐藏)。同 id 正常合并更新。
  const incoming = accounts.filter((a) => a?.id);
  for (const [id, b] of [...byId]) {
    if (incoming.some((a) => a.id !== id && isSameUnderlyingAccount(a, b))) byId.delete(id);
  }
  for (const a of accounts) if (a?.id) byId.set(a.id, { ...byId.get(a.id), ...a });
  accountsStore.save([...byId.values()]);
}

/* ---------- 财务⑩:账户类型友好名 + 资产小结 ---------- */

const SUBTYPE_LABELS: Record<string, [string, string]> = {
  checking: ['支票', 'Checking'], savings: ['储蓄', 'Savings'], 'money market': ['货币市场', 'Money market'],
  cd: ['定期存单', 'CD'], 'credit card': ['信用卡', 'Credit card'], paypal: ['PayPal', 'PayPal'],
  brokerage: ['投资', 'Brokerage'], ira: ['退休 IRA', 'IRA'], '401k': ['退休 401k', '401k'],
  hsa: ['医保储蓄 HSA', 'HSA'], mortgage: ['房贷', 'Mortgage'], student: ['学贷', 'Student loan'], auto: ['车贷', 'Auto loan'],
};
const TYPE_LABELS: Record<string, [string, string]> = {
  depository: ['存款', 'Deposit'], credit: ['信用卡', 'Credit'], investment: ['投资', 'Investment'],
  brokerage: ['投资', 'Investment'], loan: ['贷款', 'Loan'], other: ['账户', 'Account'],
};

/** 账户类型友好名 [zh, en](subtype 优先,type 兜底;都不认识时原样)。 */
export function accountTypeLabel(a: { type?: string; subtype?: string }): [string, string] {
  const sub = (a.subtype || '').toLowerCase();
  if (SUBTYPE_LABELS[sub]) return SUBTYPE_LABELS[sub];
  const type = (a.type || '').toLowerCase();
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  const raw = a.subtype || a.type || '';
  return raw ? [raw, raw] : ['账户', 'Account'];
}

/** 资产小结(单币种口径):存款 + 投资 − 信用卡欠款 − 贷款 = 净资产。无余额的账户跳过。
 *  免费最大化·Plaid A:此前 loan 类型(房贷/学贷/车贷)完全没进公式 → 净资产虚高一整笔
 *  贷款。现按负债计入(loanOwed),并从净资产里减掉。 */
export function assetSummary(accounts: BankAccount[], currency = 'USD'): { deposits: number; investments: number; creditOwed: number; loanOwed: number; net: number } {
  let deposits = 0, investments = 0, creditOwed = 0, loanOwed = 0;
  for (const a of accounts) {
    if ((a.currency || 'USD').toUpperCase() !== currency.toUpperCase()) continue;
    if (typeof a.balance !== 'number') continue;
    const t = (a.type || '').toLowerCase();
    if (t === 'depository') deposits += a.balance;
    else if (t === 'investment' || t === 'brokerage') investments += a.balance;
    else if (t === 'credit') creditOwed += a.balance;
    else if (t === 'loan') loanOwed += a.balance; // loan.balance = 剩余本金(欠款)
  }
  return {
    deposits: round2(deposits), investments: round2(investments),
    creditOwed: round2(creditOwed), loanOwed: round2(loanOwed),
    net: round2(deposits + investments - creditOwed - loanOwed),
  };
}

/** 免费最大化·Plaid A:投资组合未实现盈亏 = Σ市值 − Σ成本(有成本的持仓才计)。
 *  value/costBasis 早已存了,只是从没做减法呈现。gainPct 相对成本。 */
export function holdingsGainLoss(holdings: Holding[]): { value: number; cost: number; gain: number; gainPct: number } {
  let value = 0, cost = 0;
  for (const h of holdings) {
    if (typeof h.costBasis !== 'number' || h.costBasis <= 0) continue; // 无成本口径不算(避免把市值当盈亏)
    value += h.value || 0;
    cost += h.costBasis;
  }
  const gain = value - cost;
  return { value: round2(value), cost: round2(cost), gain: round2(gain), gainPct: cost > 0 ? round2((gain / cost) * 100) : 0 };
}

/** 某账户某月的消费/退款/笔数。 */
export function accountMonth(txs: BankTx[], accountId: string, ym: string): { spend: number; refund: number; count: number } {
  let spend = 0, refund = 0, count = 0;
  const flowRules = loadFlowRules();
  const evidence = expenseMerchants(txs);
  const acctTxs = txs.filter((t) => t.accountId === accountId);
  const ccy = dominantCurrency(acctTxs.length ? acctTxs : txs); // 单账户按其主币种,避免跨币种裸加
  for (const t of txs) {
    if (t.accountId !== accountId || txYm(t) !== ym || ccyOf(t) !== ccy) continue;
    const f = txFlow(t, flowRules, evidence);
    if (f === 'expense') { spend += Math.abs(t.amount); count += 1; }
    else if (f === 'refund' || f === 'rebate') { refund += Math.abs(t.amount); count += 1; }
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

/** 财务㉚:按 merchantKey 写分类规则(entity id 优先)。 */
export function setMerchantRuleFor(t: Pick<BankTx, 'name' | 'merchantId'>, category: string): void {
  const key = merchantKey(t);
  setMerchantRule(key, category);
  if (category.trim()) rememberRuleLabel(key, t.name);
}

// 财务㉚:entity id 作规则键不可读,「已学规则」面板展示时用 label 映射还原商户名。
const RULE_LABEL_KEY = 'nesio-bank-rule-label-v1';

export function loadRuleLabels(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RULE_LABEL_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

function rememberRuleLabel(key: string, name: string): void {
  if (typeof window === 'undefined' || !key || key === name) return;
  const all = loadRuleLabels();
  if (all[key] === name) return;
  all[key] = name;
  try { localStorage.setItem(RULE_LABEL_KEY, JSON.stringify(all)); } catch { reportStorageDropped(); }
}

/** 生效分类:用户规则优先,其次 Plaid 分类;经 normalizeCategory 归一(财务②:旧自家词汇
 * 与 PFC 枚举合流,统计里同类不再被拆成两组)。 */
export function effectiveCategory(t: BankTx, rules = loadMerchantRules()): string {
  return normalizeCategory(ruleFor(rules, t) || t.category || '');
}

/** 需要审核的交易:本月、真支出、没有生效分类的。 */
export function needsReview(txs: BankTx[], ym: string): BankTx[] {
  const rules = loadMerchantRules();
  const flowRules = loadFlowRules();
  return txs.filter((t) => txYm(t) === ym && txFlow(t, flowRules) === 'expense' && !effectiveCategory(t, rules)).sort((a, b) => b.amount - a.amount);
}

// 财务②:建议值统一为 PFC 枚举(uber/gas 语义上是交通;流媒体订阅归娱乐)。
const SUGGEST_RULES: Array<[RegExp, string]> = [
  [/coffee|cafe|starbucks|餐|饭|restaurant|mcdonald|bakery|bar\b|dining/i, 'FOOD_AND_DRINK'],
  [/shop|store|mall|market|超市|商场|target|walmart|costco|amazon|ulta|ikea/i, 'GENERAL_MERCHANDISE'],
  [/uber|lyft|gas|shell|chevron|transit|parking|加油|地铁|taxi/i, 'TRANSPORTATION'],
  [/netflix|spotify|hulu|subscription|membership|订阅|会员/i, 'ENTERTAINMENT'],
  [/payment|autopay|还款|transfer|转账/i, 'LOAN_PAYMENTS'],
];

/** 商户名分词(英文单词 + 中文串,长度≥2)。 */
function merchantTokens(name: string): string[] {
  return normalizeMerchant(name).split(/[^a-z0-9一-龥]+/).filter((t) => t.length >= 2);
}

/** 从用户已设的商户规则里学一个 token→分类 频次表(你的历史纠正就是训练数据)。 */
function learnTokenCategory(rules: Record<string, string>): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {};
  for (const [name, cat] of Object.entries(rules)) {
    const norm = normalizeCategory(cat);
    for (const tok of merchantTokens(name)) {
      (map[tok] ||= {})[norm] = (map[tok][norm] || 0) + 1;
    }
  }
  return map;
}

// ── 2b②:近似 token 匹配(纯本地模糊,不上 embedding)────────────────────────────
// 真实失败模式是"变体":MCDONALD'S #123 → mcdonald,你纠正过的 McDonalds → mcdonalds,
// 精确匹配挂掉(复数/所有格/缩写同理)。模糊门槛保守:token ≥4 字符才敢模糊;
// 前缀包含(长度差 ≤2)或编辑距离 ≤1;模糊票权重 0.5(不如精确票自信)。
// 不上 embedding:本函数是同步渲染路径 + 变体匹配不需要语义;结论记录于 algorithm-layer-plan。
function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++diff > 1) return false; }
    return true;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]; // s 比 l 短 1:允许一次插入
  let i = 0, j = 0, skipped = false;
  while (i < s.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true; j++;
  }
  return true;
}

function tokenSimilar(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false; // 短 token 模糊太危险(uber≈ubon 之类)
  if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) return true; // mcdonald~mcdonalds
  return editDistanceAtMost1(a, b);
}

const FUZZY_WEIGHT = 0.5;

/**
 * 给未分类商户猜分类:先用"你自己纠正过的同类词"投票(从数据学),精确 token 没命中的
 * 再做保守模糊匹配(半票);都没学到再退回关键词规则。
 * 例:你把 Wegmans / Trader Joe's 都归过 Food,新的 "Joe's Market" 命中 joe/market → Food;
 * 你把 McDonalds 归过 Food,"MCDONALD'S #123" 经 mcdonald~mcdonalds 模糊命中 → Food(置信略低)。
 */
export function suggestCategory(name: string, rules: Record<string, string> = loadMerchantRules()): { category: string; confidence: number } {
  const learned = learnTokenCategory(rules);
  const learnedTokens = Object.keys(learned);
  const votes: Record<string, number> = {};
  let total = 0;
  for (const tok of merchantTokens(name)) {
    const exact = learned[tok];
    if (exact) {
      for (const [cat, c] of Object.entries(exact)) { votes[cat] = (votes[cat] || 0) + c; total += c; }
      continue;
    }
    // 精确未命中 → 保守模糊(半票)
    for (const lt of learnedTokens) {
      if (!tokenSimilar(tok, lt)) continue;
      for (const [cat, c] of Object.entries(learned[lt])) { votes[cat] = (votes[cat] || 0) + c * FUZZY_WEIGHT; total += c * FUZZY_WEIGHT; }
    }
  }
  if (total > 0) {
    const [cat, best] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    // 置信 = 该分类占比 × 证据量因子(1 个样本别太自信,4+ 个才接近上限);模糊半票天然压低置信
    const confidence = Math.min(0.9, (best / total) * (0.6 + 0.3 * Math.min(1, total / 4)));
    return { category: cat, confidence: Math.round(confidence * 100) / 100 };
  }
  for (const [re, cat] of SUGGEST_RULES) if (re.test(name)) return { category: cat, confidence: 0.72 };
  return { category: 'GENERAL_SERVICES', confidence: 0.4 };
}

/* ---------- 批次 39:定期账单识别(Rocket Money 风)---------- */
// 按商户归并支出,找出周期性(周/双周/月/年)重复的扣款,估算下次日期与金额。

export interface RecurringCharge {
  name: string;
  key: string; // 财务㉚:商户归并键(merchantKey)——手动覆盖(不是定期)写这个键,改名不丢
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
  // 财务⑰:mature = ≥3 笔成熟(Plaid 同口径);predicted = 早识别(2 笔规律,或知名订阅
  // 品牌 1 笔按月假设)。predicted 只作展示提示,不进订阅负担/余额投影等统计。
  status: 'mature' | 'predicted';
  logo?: string; // 财务⑲:商户 logo URL(Plaid 富化;可缺)
}

/** 归一化商户名:去掉尾部门店号/流水号/日期,合并同一商家的多笔。 */
export function normalizeMerchant(name: string): string {
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
// 财务⑨:高频误伤词加词界 —— rent\b 会命中 "diffeRENT"/"paRENT",loan 命中 "sLOANe",
// gym 命中 "GYMboree",hoa 命中 "HOAgie"。账单词必须整词出现。
const BILL_RE = /netflix|spotify|hulu|disney|youtube ?premium|hbo|prime video|apple\.com\/bill|icloud|adobe|dropbox|notion|chatgpt|openai|github|microsoft ?365|google ?(one|storage)|membership|会员|subscription|订阅|insurance|保险|geico|state ?farm|allstate|progressive|nationwide|premium|duke ?energy|电费|水费|燃气|gas ?(company|bill)|electric|water ?(bill|utility)|utility|comcast|xfinity|spectrum|at&t|verizon|t-?mobile|sprint|话费|宽带|internet|broadband|mortgage|房贷|月供|\brent\b|房租|\bloans?\b|贷款|student ?loan|\bgym\b|健身|planet ?fitness|la ?fitness|equinox|peloton|storage|自如|物业|\bhoa\b/i;
// 明确排除:餐饮/购物/超市/咖啡(去很多次也不是账单)
const NON_BILL_CAT_RE = /food|餐饮|shopping|merchandise|购物|grocer|超市|coffee|咖啡/i;

// 财务⑰→⑱:已知订阅商户先验库(核心信号,业界 COF/MCC 商户表同理)——命中先验的商户
// 1 笔即标记、2 笔不需要周期证据。条目:匹配模式 + 默认周期 + 默认分类。歧义词(calm/
// medium/zoom…)锚定域名形式,避免误伤同名实体店;条目只增,误报由「不是定期」✕ 兜底。
export interface KnownSubscription { re: RegExp; cadenceDays: 30 | 365; category: string }

export const KNOWN_SUBSCRIPTIONS: KnownSubscription[] = [
  // 流媒体/视频
  { re: /netflix/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /hulu/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /disney ?\+|disneyplus/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /hbo ?max|\bmax\.com/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /paramount ?\+/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /peacock ?(tv|premium)?/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /apple ?tv/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /prime ?video/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /youtube ?(premium|tv)/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /crunchyroll/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /fubo ?tv|sling ?tv/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  // 音乐/音频
  { re: /spotify/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /apple ?music/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /pandora\b/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /tidal/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /audible/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /sirius ?xm/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  // 软件/云/AI
  { re: /apple\.com\/bill|icloud|apple ?one/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /google ?(one|storage)/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /dropbox/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /adobe/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /microsoft ?365|office ?365/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /\bnotion\b/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /\bcanva\b/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /github/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /openai|chatgpt/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /claude\.ai|anthropic/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /midjourney/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /grammarly/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /1password|lastpass/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /nord ?vpn|express ?vpn|surfshark/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /zoom\.us|zoom ?video/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /evernote|todoist/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  // 新闻/阅读/创作者
  { re: /nytimes|ny ?times/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /wall ?st(reet)? ?journal|\bwsj\b/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /washington ?post/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /economist/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /medium\.com/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /substack/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /kindle ?unlimited/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /patreon/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  // 健身/健康
  { re: /peloton/i, cadenceDays: 30, category: 'PERSONAL_CARE' },
  { re: /planet ?fitness|la ?fitness|24 ?hour ?fitness|crunch ?fitness|equinox|orangetheory|classpass/i, cadenceDays: 30, category: 'PERSONAL_CARE' },
  { re: /strava|whoop\b/i, cadenceDays: 30, category: 'PERSONAL_CARE' },
  { re: /calm\.com|headspace/i, cadenceDays: 30, category: 'PERSONAL_CARE' },
  { re: /myfitnesspal|noom\b/i, cadenceDays: 30, category: 'PERSONAL_CARE' },
  // 游戏
  { re: /playstation ?(network|plus)?|sony ?interactive/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /xbox ?(game ?pass)?/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /nintendo/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /steampowered|steam ?(games|purchase)/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  { re: /twitch/i, cadenceDays: 30, category: 'ENTERTAINMENT' },
  // 会员/配送(年付常见的标年付)
  { re: /amazon ?prime(?! ?video)/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /walmart ?\+/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /instacart ?\+|dashpass|door ?dash ?pass|uber ?one/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /costco.*member|member.*costco/i, cadenceDays: 365, category: 'GENERAL_SERVICES' },
  { re: /sam'?s ?club.*member|member.*sam'?s/i, cadenceDays: 365, category: 'GENERAL_SERVICES' },
  // 学习/其他
  { re: /duolingo/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /coursera|skillshare|masterclass|chegg/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /tinder|bumble/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  { re: /ring\.com|simplisafe|\badt\b/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
  // 财务⑳:水电气(市政/大型公用事业)
  { re: /duke ?energy/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /pg&e|pacific ?gas/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /con ?ed(ison)?/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /national ?grid/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /dominion ?energy/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /georgia ?power|florida ?power|\bfpl\b/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /socal ?(edison|gas)|\bsce\b|sdg&e/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /xcel ?energy|ameren|dte ?energy|pse&g|centerpoint|nv ?energy|\baps\b|\bsrp\b/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /peoples ?gas|nicor|columbia ?gas/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /american ?water|waste ?management|republic ?services/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  // 网络/有线/手机
  { re: /comcast|xfinity/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /spectrum|charter ?comm/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /\bcox ?comm|cox ?cable/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /centurylink|lumen|frontier ?comm|optimum|altice/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /google ?fiber|verizon ?fios/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  { re: /verizon ?(wireless)?|at&t|t-?mobile|mint ?mobile|visible\b|cricket ?wireless|boost ?mobile|google ?fi\b|us ?cellular/i, cadenceDays: 30, category: 'RENT_AND_UTILITIES' },
  // 保险
  { re: /geico|state ?farm|progressive ?(ins|casualty)?|allstate|nationwide ?(ins)?|usaa|liberty ?mutual|farmers ?ins/i, cadenceDays: 30, category: 'GENERAL_SERVICES' },
];

/** 名字命中已知订阅商户先验 → 返回条目(默认周期/分类),否则 null。 */
export function matchKnownSubscription(name: string): KnownSubscription | null {
  const n = name || '';
  for (const k of KNOWN_SUBSCRIPTIONS) if (k.re.test(n)) return k;
  return null;
}

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
 * 识别定期账单(批次 39 重写,批次 40 加手动覆盖,财务⑰加早识别):
 * 1. 先按商户归并支出;2. 手动覆盖优先(yes 强制/no 排除);3. 否则判类别(账单关键词 OR
 *    非餐饮购物且金额稳定 CV<0.2);4. 间隔中位数落周期档;5. 下次日期滚动到未来。
 * 财务⑰(对齐 Plaid mature=3 笔 + early detection):默认只回成熟流(≥3 笔,统计消费面
 * 不受预测污染);includePredicted 时另回「待确认」——2 笔且(账单词命中或两笔金额几乎
 * 一致)且间隔落周期档;或知名订阅品牌 1 笔(按月假设)。
 */
export function detectRecurring(txs: BankTx[], opts?: { includePredicted?: boolean }): RecurringCharge[] {
  const flowRules = loadFlowRules();
  const merchantRules = loadMerchantRules();
  const recurRules = loadRecurRules();
  const byKey = new Map<string, BankTx[]>();
  for (const t of txs) {
    if (txFlow(t, flowRules) !== 'expense') continue;
    if (!t.date) continue;
    const key = merchantKey(t); // 财务⑲:entity id 优先,同商户不同描述符不再裂成两条流
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(t);
    byKey.set(key, list);
  }

  const out: RecurringCharge[] = [];
  for (const list of byKey.values()) {
    // ── 财务⑰:早识别(仅 includePredicted;手动 no 依然排除)──
    if (list.length < 3) {
      if (!opts?.includePredicted || !list.length) continue;
      const sorted2 = list.slice().sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted2[sorted2.length - 1];
      if (ruleFor(recurRules, last) === 'no') continue;
      const isNonBill = NON_BILL_CAT_RE.test(last.name);
      // 财务⑱:先验优先 —— 命中已知订阅商户库的,1 笔即标、2 笔不需要周期证据。
      // 财务⑳:RENT_AND_UTILITIES 分类同为强先验(市政公司穷举不了,但 Plaid 分类会给;
      // 水电账单金额天然浮动,先验路径不要求金额一致)。
      const known = matchKnownSubscription(last.name);
      const plaidCat2 = [...sorted2].reverse().find((t) => (t.category || '').trim())?.category || '';
      const catPred = normalizeCategory(ruleFor(merchantRules, last) || plaidCat2) || known?.category || suggestCategory(last.name).category;
      const strongPrior = !!known || catPred === 'RENT_AND_UTILITIES';
      const assumedLabel = (d: number): [string, string] => (d >= 300 ? ['每年(推测)', 'Yearly (assumed)'] : ['每月(推测)', 'Monthly (assumed)']);
      let cadence = 0; let label: [string, string] | null = null;
      if (sorted2.length === 2) {
        const gap = (Date.parse(sorted2[1].date) - Date.parse(sorted2[0].date)) / 86_400_000;
        label = cadenceLabelFor(gap);
        cadence = Math.round(gap);
        const amtClose = Math.abs(sorted2[1].amount - sorted2[0].amount) <= Math.max(1, Math.abs(sorted2[0].amount) * 0.02);
        const qualifies = ruleFor(recurRules, last) === 'yes' || strongPrior || (!isNonBill && !!label && (BILL_RE.test(last.name) || amtClose));
        if (!qualifies) continue;
        if (!label) {
          // 间隔不成周期(重订阅/补缴等):有强先验才继续,用先验默认周期
          if (!strongPrior) continue;
          cadence = known?.cadenceDays ?? 30;
          label = assumedLabel(cadence);
        }
      } else {
        // 1 笔:强先验(已知商户 或 水电气网类)即标,周期用先验默认并明示推测
        if (!strongPrior || Math.abs(last.amount) > 3000) continue;
        cadence = known?.cadenceDays ?? 30;
        label = assumedLabel(cadence);
      }
      const amts2 = sorted2.map((t) => Math.abs(t.amount));
      const avg2 = amts2.reduce((s, v) => s + v, 0) / amts2.length;
      out.push({
        name: last.name,
        key: merchantKey(last),
        category: catPred,
        avgAmount: Math.round(avg2 * 100) / 100,
        count: sorted2.length,
        lastDate: last.date,
        nextEstimate: rollForward(Date.parse(last.date) + cadence * 86_400_000, cadence),
        cadenceDays: cadence,
        cadenceLabel: label,
        currency: last.currency || 'USD',
        latestAmount: round2(amts2[amts2.length - 1]),
        baselineAmount: round2(amts2[0]),
        status: 'predicted',
        logo: [...sorted2].reverse().find((t) => t.merchantLogo)?.merchantLogo,
      });
      continue;
    }
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const d = (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / 86_400_000;
      if (d > 0) gaps.push(d);
    }
    const medGap = median(gaps);
    const label = cadenceLabelFor(medGap);
    if (!label) continue;
    // 财务⑨:间隔要围着中位数聚 —— 3 笔碰巧散落的消费也能凑出一个「中位间隔」落进周期档,
    // 但那不是周期。各间隔对中位数偏差的中位数(MAD)超过中位间隔的 30% → 不算定期。
    const madGap = median(gaps.map((g) => Math.abs(g - medGap)));
    if (!medGap || madGap / medGap > 0.3) continue;

    const last = sorted[sorted.length - 1];
    // 财务②:分类优先级 用户规则 > 交易自带 Plaid 分类(最新一笔非空)> 关键词建议。
    // 此前无视 Plaid 分类直接猜 → YouTube/健身房全兜底成 Services。
    const plaidCat = [...sorted].reverse().find((t) => (t.category || '').trim())?.category || '';
    const cat = normalizeCategory(ruleFor(merchantRules, last) || plaidCat) || suggestCategory(last.name).category;
    const amts = sorted.map((t) => Math.abs(t.amount));
    const avg = amts.reduce((s, v) => s + v, 0) / amts.length;
    const cv = coeffVar(amts);
    const latestAmount = round2(amts[amts.length - 1]);
    const priorAmts = amts.slice(0, -1);
    const baselineAmount = priorAmts.length ? round2(median(priorAmts)) : latestAmount;

    // ── 账单判定(手动覆盖优先)──
    const override = ruleFor(recurRules, last);
    if (override === 'no') continue; // 用户手动排除
    // 财务⑳:账单判定 = 关键词 OR 水电气网类(金额天然浮动,CV 不设限)OR 已知商户先验
    const isBill = BILL_RE.test(last.name) || cat === 'RENT_AND_UTILITIES' || !!matchKnownSubscription(last.name);
    const isNonBill = NON_BILL_CAT_RE.test(cat) || NON_BILL_CAT_RE.test(last.name);
    // 账单(放宽金额);否则必须「非餐饮购物 且 金额稳定」;'yes' 强制算定期
    const qualifies = override === 'yes' || isBill || (!isNonBill && cv < 0.2);
    if (!qualifies) continue;

    out.push({
      name: last.name,
      key: merchantKey(last),
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
      status: 'mature',
      logo: [...sorted].reverse().find((t) => t.merchantLogo)?.merchantLogo,
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
  // 财务④:小数位统一——整数金额不带小数($500),带分的恒两位($100.80,不再 $100.8)。
  const hasCents = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  const body = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}
