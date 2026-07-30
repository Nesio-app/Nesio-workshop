/**
 * ledger-allocation — 分摊(L4)。
 *
 * 一笔支出拆到多个去处:$300 的超市账单里 $120 是给家里囤货、$80 是给猫、
 * $100 是聚餐 AA 别人的份;一笔 $1200 的年费按 12 个月摊。
 *
 * **会计原则:分摊不修改原分录。**(QuickBooks / Xero / Beancount 一致)
 * 原分录记的是「银行那天扣了 $300」——那是外部事实,改了它就再也对不上账。
 * 分摊记的是「这 $300 我认为该算到哪几处」——那是你的判断,单独一层。
 *
 * 两层分开还带来一个实际好处:分摊改一百次,对账状态不受影响,
 * 因为原分录一个字没动(见 ledger-entry 的源字段/人字段分层)。
 *
 * 三条硬约束:
 *   ① **合计必须等于原额**,一分不差。差一分就不许存 —— 「大致分了一下」
 *      的结果是月度按类别汇总和总额对不上,而那种错最难查。
 *   ② 每份金额必须为正。负的分摊等于把钱从别处挪过来,那是另一笔交易。
 *   ③ 分摊了的分录在**按类别聚合**时用分摊,在**按总额聚合**时用原额。
 *      两边都算分摊 = 双计;两边都算原额 = 分摊白做。
 *
 * 纯函数,不碰存储(存哪由调用方决定,同 ledger-entry 的做法)。
 */

export interface AllocationSplit {
  /** 去处:分类 / 人 / 资产 —— 由调用方定义语义,这一层只管数。 */
  target: string;
  /** 正数。 */
  amount: number;
  note?: string;
}

export type AllocationVerdict =
  | { ok: true; splits: AllocationSplit[] }
  | { ok: false; reason: 'sum_mismatch'; delta: number }
  | { ok: false; reason: 'nonpositive' | 'empty' | 'duplicate_target' };

const cents = (n: number): number => Math.round((Number(n) || 0) * 100);

/**
 * 校验一组分摊。**不许「大致分了一下」** —— 合计差一分就不通过。
 *
 * `delta` 是「还差多少没分」(正 = 少分了,负 = 分多了),给 UI 直接显示,
 * 让人知道还剩多少要摊,而不是只看到一句「合计不对」。
 */
export function validateAllocation(total: number, splits: readonly AllocationSplit[]): AllocationVerdict {
  if (!splits.length) return { ok: false, reason: 'empty' };
  const seen = new Set<string>();
  for (const s of splits) {
    if (!(cents(s.amount) > 0)) return { ok: false, reason: 'nonpositive' };
    // 同一个去处出现两次 —— 多半是重复添加,合并起来比默默相加更清楚
    if (seen.has(s.target)) return { ok: false, reason: 'duplicate_target' };
    seen.add(s.target);
  }
  const sum = splits.reduce((a, s) => a + cents(s.amount), 0);
  const delta = cents(Math.abs(total)) - sum;
  if (delta !== 0) return { ok: false, reason: 'sum_mismatch', delta: delta / 100 };
  return { ok: true, splits: splits.map((s) => ({ ...s, amount: cents(s.amount) / 100 })) };
}

/**
 * 平均分成 n 份,余数给**第一份**。
 *
 * 为什么余数不平摊到最后一份:$100 分 3 份 = 33.34 / 33.33 / 33.33。
 * 给第一份的话,列表从上往下读时第一眼看到的就是那个「多一分」的,
 * 不会在最后一行冒出来让人以为算错了。这是显示上的事,合计一样。
 */
export function splitEvenly(total: number, n: number, targets?: readonly string[]): AllocationSplit[] {
  if (!(n >= 1)) return [];
  const t = cents(Math.abs(total));
  const base = Math.floor(t / n);
  const rest = t - base * n;
  return Array.from({ length: n }, (_, i) => ({
    target: targets?.[i] ?? `#${i + 1}`,
    amount: (base + (i === 0 ? rest : 0)) / 100,
  }));
}

/**
 * 按月摊(年费/保险这类)。返回 `YYYY-MM → 金额`,余数给第一个月。
 * 同样只算不存 —— 「这笔年费每月摊多少」是个视图,不是十二条新交易。
 */
export function amortizeMonthly(total: number, startMonth: string, months: number): Array<{ month: string; amount: number }> {
  if (!(months >= 1) || !/^\d{4}-\d{2}$/.test(startMonth)) return [];
  const parts = splitEvenly(total, months);
  const y0 = Number(startMonth.slice(0, 4)); const m0 = Number(startMonth.slice(5, 7));
  return parts.map((p, i) => {
    const m = m0 + i;
    const y = y0 + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    return { month: `${y}-${String(mm).padStart(2, '0')}`, amount: p.amount };
  });
}

/**
 * 按类别聚合时该用哪些数。
 *
 * 有分摊 → 用分摊的各份;没有 → 用原额挂在它自己的分类下。
 * **总额聚合不许走这里**(走了就是把同一笔钱按两套口径各算一次)。
 */
export function allocationForCategoryTotals(
  entry: { amount: number; category?: string },
  splits?: readonly AllocationSplit[],
): AllocationSplit[] {
  if (splits && splits.length) return splits.map((s) => ({ ...s }));
  return [{ target: entry.category || '', amount: Math.abs(entry.amount) }];
}
