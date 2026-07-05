/**
 * bank-tx core — 纯函数(无 localStorage / DOM 依赖),供 bank-tx.ts 与 node 行为测试共用。
 *
 * 抽出这里是为了让两个 HIGH 修复可被真行为测试覆盖(bank-tx.ts 本身是 .ts,
 * 而测试 harness 跑裸 .mjs、无 TS loader):
 *   ① 货币作用域 —— dominantCurrency / inCurrency:聚合前先按主币种分组,
 *      否则 $10 与 ¥10 会被直接相加成 20。
 *   ② 定期检测 —— evaluateRecurringGroup:间隔 CV 门 + 最小样本,
 *      挡下「间隔 [1,59] 中位数 30 → 误判每月」这类从噪声造出的账单。
 */

/** 全量交易里出现最多的币种(缺省 USD)。 */
export function dominantCurrency(txs) {
  const counts = new Map();
  for (const t of txs) {
    const c = (t.currency || 'USD').toUpperCase();
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = 'USD';
  let max = 0;
  for (const [c, n] of counts) if (n > max) { max = n; best = c; }
  return best;
}

/** 是否属于给定币种(缺省按 USD)。 */
export function inCurrency(t, cur) {
  return (t.currency || 'USD').toUpperCase() === cur;
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 变异系数(标准差/均值)—— 账单金额/间隔稳定(低),超市/餐饮飘(高)。 */
export function coeffVar(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  if (mean === 0) return 1;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / mean;
}

export function cadenceLabelFor(days) {
  if (days >= 6 && days <= 8) return ['每周', 'Weekly'];
  if (days >= 12 && days <= 16) return ['每两周', 'Biweekly'];
  if (days >= 26 && days <= 35) return ['每月', 'Monthly'];
  if (days >= 58 && days <= 64) return ['每两月', 'Every 2 months'];
  if (days >= 85 && days <= 95) return ['每季', 'Quarterly'];
  if (days >= 350 && days <= 380) return ['每年', 'Yearly'];
  return null;
}

/** 归一化商户名:去掉尾部门店号/流水号/日期,合并同一商家的多笔。 */
export function normalizeMerchant(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[#*]?\s*\d[\d\-/.]{2,}.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 定期 = 账单(订阅/水电/保险/房贷/会员/宽带/话费…),不是「常去的超市/咖啡」。
export const BILL_RE = /netflix|spotify|hulu|disney|youtube ?premium|hbo|prime video|apple\.com\/bill|icloud|adobe|dropbox|notion|chatgpt|openai|github|microsoft ?365|google ?(one|storage)|membership|会员|subscription|订阅|insurance|保险|geico|state ?farm|allstate|progressive|nationwide|premium|duke ?energy|电费|水费|燃气|gas ?(company|bill)|electric|water ?(bill|utility)|utility|comcast|xfinity|spectrum|at&t|verizon|t-?mobile|sprint|话费|宽带|internet|broadband|mortgage|房贷|月供|rent\b|房租|loan|贷款|student ?loan|gym|健身|planet ?fitness|la ?fitness|equinox|peloton|storage|自如|物业|hoa/i;
export const NON_BILL_CAT_RE = /food|餐饮|shopping|购物|grocer|超市|coffee|咖啡/i;

// 间隔规律性上限:定期账单的相邻间隔应当稳定(CV 低)。噪声(如 1 天、59 天)会被挡下。
export const MAX_GAP_CV = 0.25;

/** 把估算的下次日期滚动到 now 之后(数据是历史的,别给出过去的「下次」)。now 可注入以便测试。 */
export function rollForward(baseMs, cadenceDays, nowMs = Date.now()) {
  let t = baseMs;
  const step = cadenceDays * 86_400_000;
  let guard = 0;
  while (t < nowMs && guard++ < 120) t += step;
  return new Date(t).toISOString().slice(0, 10);
}

/** 相邻日期(YYYY-MM-DD,已排序)之间的正向天数间隔。 */
export function gapDaysOf(sortedDates) {
  const gaps = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const d = (Date.parse(sortedDates[i]) - Date.parse(sortedDates[i - 1])) / 86_400_000;
    if (d > 0) gaps.push(d);
  }
  return gaps;
}

/**
 * 判断一组同商户支出是否为定期账单,并算出周期/下次/均额。返回 RecurringCharge 形状或 null。
 * txns: [{ date:'YYYY-MM-DD', amount, name, currency }](同商户,已按 expense + 币种过滤)。
 * opts.resolveCategory(name)->string;opts.now(ms);opts.fallbackCurrency。
 */
export function evaluateRecurringGroup(txns, opts = {}) {
  const isBillKeyword = txns.some((t) => BILL_RE.test(t.name));
  // 关键词账单信号强,3 笔即可;否则要 4 笔(≥3 个间隔)才谈得上稳定周期。
  const minCharges = isBillKeyword ? 3 : 4;
  if (txns.length < minCharges) return null;

  const sorted = txns.slice().sort((a, b) => a.date.localeCompare(b.date));
  const gaps = gapDaysOf(sorted.map((t) => t.date));
  if (gaps.length < 2) return null;
  const medGap = median(gaps);
  const label = cadenceLabelFor(medGap);
  if (!label) return null;
  // 间隔必须规律:day1/day2/day60(间隔 1、59)中位数=30 会被误判「每月」,这里挡掉。
  if (coeffVar(gaps) > MAX_GAP_CV) return null;

  const last = sorted[sorted.length - 1];
  const category = opts.resolveCategory ? opts.resolveCategory(last.name) : (opts.category || '');
  const amts = sorted.map((t) => Math.abs(t.amount));
  const avg = amts.reduce((s, v) => s + v, 0) / amts.length;
  const cv = coeffVar(amts);

  const isNonBill = NON_BILL_CAT_RE.test(category) || NON_BILL_CAT_RE.test(last.name);
  // 关键词命中 = 账单(放宽金额);否则必须「非餐饮购物 且 金额稳定」
  const qualifies = isBillKeyword || (!isNonBill && cv < 0.2);
  if (!qualifies) return null;

  return {
    name: last.name,
    category,
    avgAmount: Math.round(avg * 100) / 100,
    count: sorted.length,
    lastDate: last.date,
    nextEstimate: rollForward(Date.parse(last.date) + medGap * 86_400_000, Math.round(medGap), opts.now),
    cadenceDays: Math.round(medGap),
    cadenceLabel: label,
    currency: last.currency || opts.fallbackCurrency || 'USD',
  };
}
