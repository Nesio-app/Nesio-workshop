/**
 * ledger-refund — 退款配对(L4)。
 *
 * 设计依据见 docs/design/finance-ledger-plan.md「退款」一节。
 *
 * 一笔退款要能找回它对应的那笔消费,否则:
 *   · 月支出虚高(退回来的钱没冲掉花出去的);
 *   · 「这条 AMAZON 到底花了多少」永远答不上来 —— 原额 91.69,退了 35.77,
 *     实际 55.92,但账上是两条互不相干的记录。
 *
 * 三条判据,都是**保守**的 —— 配错比不配贵得多(配错会让两笔真实的钱互相抵消):
 *   ① 退款金额 ≤ 原额(退得比买的多是异常,不配,让对账去暴露);
 *   ② 退款日期在原消费**之后**(退款不可能发生在购买前);
 *   ③ 商户名对得上(退款描述通常带原商户名 + REFUND/CREDIT/退款)。
 *
 * 配对是**建议 + 确认**,不是自动生效:退款关系会改变月度数字,自动认了就是
 * 「财务数据自己变了」那一类病。否决进否决记忆(同 receipt-match 的负样本思路),
 * 永不重复推荐 —— 一个被否过的建议反复弹出来,比不建议更烦。
 *
 * 净额本身不存(见 ledger-entry.netLedgerAmount:存事实,算净额)。这里只存**关系**。
 */

import { reportStorageDropped } from './storage-health';
import { createBlobStore } from './idb-blob-store';

export interface RefundCandidateInput {
  id: string;
  /** YYYY-MM-DD */
  occurredAt: string;
  /** 绝对值。方向由调用方在入口判好 —— 这一层不猜谁是退款。 */
  amount: number;
  merchant?: string;
}

const LINK_KEY = 'nesio-refund-link-v1';
const REJECT_KEY = 'nesio-refund-rejected-v1';

const rejectStore = typeof createBlobStore === 'function'
  ? createBlobStore<string[]>({
      key: REJECT_KEY,
      updateEvent: 'nesio-refund-rejected-updated',
      validate: (v) => Array.isArray(v),
      onWriteError: reportStorageDropped,
    })
  : null;
const linkStore = typeof createBlobStore === 'function'
  ? createBlobStore<Record<string, string>>({
      key: LINK_KEY,
      updateEvent: 'nesio-refund-link-updated',
      validate: (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
      onWriteError: reportStorageDropped,
    })
  : null;

/** 一对的稳定键。退款在前、原消费在后 —— 顺序固定,免得同一对存两份。 */
export function refundPairKey(refundId: string, purchaseId: string): string {
  return `${refundId}|${purchaseId}`;
}

// ── 否决记忆 ────────────────────────────────────────────────────────────────

export function loadRejectedRefundPairs(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const fromStore = rejectStore?.load();
  if (Array.isArray(fromStore)) return new Set(fromStore);
  try { return new Set(JSON.parse(localStorage.getItem(REJECT_KEY) || '[]') as string[]); } catch { return new Set(); }
}

/** 否决一对(幂等)。写失败要说出来 —— 否则下次又推荐同一对,人会以为「不是」没生效。 */
export function rejectRefundPair(refundId: string, purchaseId: string): void {
  if (typeof window === 'undefined') return;
  const set = loadRejectedRefundPairs();
  set.add(refundPairKey(refundId, purchaseId));
  if (rejectStore) { rejectStore.save([...set]); return; }
  try { localStorage.setItem(REJECT_KEY, JSON.stringify([...set])); } catch { reportStorageDropped(); }
}

// ── 已确认的关联 ────────────────────────────────────────────────────────────

/** refundId → purchaseId。一笔退款只能挂一笔消费。 */
export function loadRefundLinks(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const fromStore = linkStore?.load();
  if (fromStore && typeof fromStore === 'object' && !Array.isArray(fromStore)) return fromStore;
  try {
    const v = JSON.parse(localStorage.getItem(LINK_KEY) || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch { return {}; }
}

/**
 * 确认一对。`purchaseId` 传 null = 解除关联。
 *
 * 返回 false = 没存上,调用方必须给可见失败态 —— 静默失败的话人会看到
 * 「我明明关联了,月支出怎么没变」。
 */
export function linkRefund(refundId: string, purchaseId: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const map = loadRefundLinks();
  if (purchaseId) map[refundId] = purchaseId; else delete map[refundId];
  if (linkStore) { linkStore.save(map); return true; }
  try { localStorage.setItem(LINK_KEY, JSON.stringify(map)); return true; }
  catch { reportStorageDropped(); return false; }
}

/** 某笔消费名下已确认的退款 id。 */
export function refundsOf(purchaseId: string, links = loadRefundLinks()): string[] {
  return Object.entries(links).filter(([, p]) => p === purchaseId).map(([r]) => r);
}

// ── 候选生成 ────────────────────────────────────────────────────────────────

const dayDiff = (a: string, b: string): number => {
  const t = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  const d = t(a) - t(b);
  return Number.isFinite(d) ? Math.round(d / 86400000) : Number.NaN;
};

/** 归一化商户名并去掉退款词 —— 「AMAZON REFUND」要能对上「AMAZON MKTPL」。 */
const REFUND_WORDS = /\b(REFUND|RETURN|CREDIT|REVERSAL|CHARGEBACK)\b|退款|退货|冲正/gi;
export function merchantStem(s?: string): string {
  return (s || '').toUpperCase().replace(REFUND_WORDS, ' ').replace(/[^A-Z0-9一-龥]+/g, '');
}

function merchantHit(a?: string, b?: string): boolean {
  const x = merchantStem(a); const y = merchantStem(b);
  if (x.length < 3 || y.length < 3) return false;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  // 短的那个至少要有 3 个字符的前缀落在长的里 —— 不做模糊编辑距离,
  // 那会把 STARBUCKS 和 STAR MARKET 配到一起。
  return long.startsWith(short.slice(0, Math.max(3, Math.min(short.length, 8))));
}

export interface RefundCandidate {
  purchase: RefundCandidateInput;
  /** 退款晚于消费几天。 */
  dayGap: number;
  /** 金额是否完全相等(整笔退) —— 全额退是最可信的一种。 */
  exact: boolean;
  /** 商户名是否对得上。 */
  merchantMatched: boolean;
}

export interface RefundMatchOptions {
  /** 退款最多晚于消费几天。默认 120 —— 多数退货窗口在 30–90 天,留余量。 */
  windowDays?: number;
  rejected?: Set<string>;
  /** 已经被别的退款占用的消费 id(一笔消费可挂多笔部分退款,所以默认不排除)。 */
  taken?: Set<string>;
  max?: number;
}

/**
 * 给一笔退款找原始消费。**保守**:三条判据全过才进候选。
 *
 * 排序:金额完全相等的优先(全额退最可信)→ 商户名对得上的 → 日期最近的。
 * 「日期最近」放最后是有意的:同商户短期内多笔同额消费时,先按金额和商户定性,
 * 再用时间排序,而不是让一笔时间近但商户不同的消费排到前面。
 */
export function refundCandidates(
  refund: RefundCandidateInput,
  purchases: readonly RefundCandidateInput[],
  opts: RefundMatchOptions = {},
): RefundCandidate[] {
  const amt = Math.abs(refund.amount);
  if (!(amt > 0) || !refund.occurredAt) return [];
  const windowDays = opts.windowDays ?? 120;
  const rejected = opts.rejected ?? new Set<string>();
  const taken = opts.taken ?? new Set<string>();

  const out: RefundCandidate[] = [];
  for (const p of purchases) {
    if (p.id === refund.id) continue;
    if (taken.has(p.id)) continue;
    if (rejected.has(refundPairKey(refund.id, p.id))) continue;
    const paid = Math.abs(p.amount);
    // ① 退得比买的多 = 异常,不配。让它以未达账项的身份出现在对账里,
    //    比悄悄配上一笔「负的花费」诚实。
    if (Math.round(amt * 100) > Math.round(paid * 100)) continue;
    // ② 退款不可能发生在购买之前
    const gap = dayDiff(refund.occurredAt, p.occurredAt);
    if (!Number.isFinite(gap) || gap < 0 || gap > windowDays) continue;
    // ③ 商户名要对得上 —— 这是唯一能区分「同额巧合」的判据
    if (!merchantHit(refund.merchant, p.merchant)) continue;
    out.push({
      purchase: p, dayGap: gap,
      exact: Math.round(amt * 100) === Math.round(paid * 100),
      merchantMatched: true,
    });
  }
  return out
    .sort((a, b) => (Number(b.exact) - Number(a.exact)) || (a.dayGap - b.dayGap))
    .slice(0, opts.max ?? 3);
}

/**
 * 再挂一笔退款会不会超过原额。
 *
 * 单笔退款不超原额是候选阶段就挡住的(见 refundCandidates ①),但**多笔累加**
 * 会绕过去:$91.69 的消费挂两笔 $50 的退款,每笔单看都合法,合起来就超了。
 * `netLedgerAmount` 那边会把负的花费钳到 0 —— 那是最后一道保险,不是提示。
 * 靠它兜底的话,人看到的是「这笔花了 $0」,而不是「你可能挂错了一笔」。
 *
 * 所以确认之前先问这里,超了就让 UI 说清楚:多出来的 $X 更可能是另一笔消费的退款。
 */
export function wouldOverRefund(
  purchaseAmount: number,
  existingRefundAmounts: readonly number[],
  incoming: number,
): { over: boolean; excess: number } {
  const paid = Math.round(Math.abs(purchaseAmount) * 100);
  const used = existingRefundAmounts.reduce((a, r) => a + Math.round(Math.abs(r) * 100), 0);
  const next = used + Math.round(Math.abs(incoming) * 100);
  return { over: next > paid, excess: next > paid ? (next - paid) / 100 : 0 };
}

/**
 * 这条建议够不够格**默认选中**。
 *
 * 只有「全额退 + 商户对得上 + 30 天内」才算够硬。其余都摆出来但不预选 ——
 * 部分退款、跨月退款这些形态里,配错的代价是两笔真实的钱互相抵消,
 * 而人一旦看到「已经帮你选好了」就很可能直接确认。
 */
export function refundSuggestionIsStrong(c: RefundCandidate): boolean {
  return c.exact && c.merchantMatched && c.dayGap <= 30;
}
