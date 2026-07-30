/**
 * spend-claim — 「这件东西花的钱是哪一笔」(R2 优先级 #3 的地基)。
 *
 * 衣橱和一餐加了 `price` 之后,一个新问题立刻出现:**这笔钱要不要记进账?**
 *
 * **不要。** 在外面吃饭、买衣服基本都是刷卡的 —— Plaid 已经有那条流水了。
 * 再记一笔手动支出就是**双计**:月支出凭空多一份,而两条记录看起来都对。
 * 这正是 `linkExpenseToBankTx`(小票关联后降级为明细层)要解决的同一个问题。
 *
 * 所以 `price` 的用途不是记账,是**认领**:
 *
 *   衣服/一餐(带 price)  ──认领──▶  已有的银行流水
 *
 * 认领之后:
 *   · 「这件衣服花了多少」有答案了 —— 而且是**银行说的**那个数,不是你回忆的;
 *   · 从那笔流水点进去,能看到买的是哪件衣服 / 哪一顿饭(双向);
 *   · 月支出**一分不变** —— 认领只是给已有的那笔钱贴个标签。
 *
 * 只有**确实没有银行流水**(现金、别人代付后还给你)时,才该另记一笔手动支出。
 * 那条路走 `addManualEntry`,不在这里。
 *
 * 配对判据直接复用 `receipt-match.ts`(金额 ±1%、日期 ±windowDays、商户词、否决记忆)——
 * 那套判据已经在小票上跑了很久,没必要为衣服和饭另发明一套。
 */

import type { BankTx } from './bank-tx';
import { receiptMatchCandidates, rejectPair, loadRejectedPairs, pairKey } from './receipt-match';
import { linkNodes, unlinkNodes, getLifeGraph } from './life-graph';

/** 能去认领银行流水的东西:带金额、带日期的任何 LifeNode(衣服 / 一餐 / 物品…)。 */
export interface Claimable {
  /** LifeNode id —— 认领关系写在图上,所以必须是真节点 id。 */
  id: string;
  name: string;
  /** 正数。 */
  price: number;
  /** YYYY-MM-DD。没有日期就只能靠金额配,配错概率大得多 —— 所以这里要求必填。 */
  occurredAt: string;
  /** 商户线索(店名 / 品牌);可空,有的话配得更准。 */
  merchant?: string;
}

/** 认领关系的关系名。双向:东西 ↔ 流水。 */
export const CLAIM_RELATION = 'paid_by_tx';

/**
 * 给一件东西找它对应的那笔银行流水。
 *
 * 窗口默认 7 天(比小票的 3 天宽):衣服和饭常常是「那天买的、过两天才想起来记」,
 * 而小票是当场拍的。放宽是有代价的 —— 所以金额仍然卡 ±1%,商户名仍然参与排序。
 */
export function claimCandidates(
  item: Claimable,
  txs: readonly BankTx[],
  opts: { windowDays?: number; max?: number } = {},
): BankTx[] {
  if (!(item.price > 0) || !item.occurredAt) return [];
  return receiptMatchCandidates(
    { id: item.id, amount: item.price, occurredAt: item.occurredAt, ...(item.merchant ? { merchant: item.merchant } : {}) },
    txs,
    {
      rejected: loadRejectedPairs(),
      taken: claimedTxIds(),
      windowDays: opts.windowDays ?? 7,
      max: opts.max ?? 3,
    },
  );
}

/**
 * 已经被别的东西认领掉的流水 id。
 *
 * 一笔流水只能被一件东西认领 —— 否则同一笔钱会同时算成「这件衣服的」和「那顿饭的」,
 * 两边都显示一个金额,而实际只花了一次。
 * (这和 `linkExpenseToBankTx` 里「同一笔银行流水只能挂一张小票」是同一条约束。)
 */
export function claimedTxIds(): Set<string> {
  const out = new Set<string>();
  try {
    for (const n of getLifeGraph()) {
      for (const r of n.relations || []) {
        if (r.relation === CLAIM_RELATION) out.add(r.targetId);
      }
    }
  } catch { /* 图读不出来时按「都没被认领」走,不挡住配对 */ }
  return out;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'tx_taken' | 'no_tx_node' | 'link_failed' };

/**
 * 确认认领。**要求那笔流水在图里有节点** —— 关联写在 `relations` 上,
 * 而 `linkNodes` 只收真节点 id(R1 定的规矩:targetId 不许是业务键)。
 *
 * 每一笔流水在图里都有一个轻量节点(`tx-node.ts`,同步时建、一视同仁),
 * 所以调用方拿 `findTxNode(tx.id)` 就能拿到 id。
 * 拿不到时(节点还没同步过来)诚实返回 `no_tx_node`,不假装成功。
 */
export function claimSpend(itemNodeId: string, txNodeId: string): ClaimResult {
  if (!txNodeId) return { ok: false, reason: 'no_tx_node' };
  if (claimedTxIds().has(txNodeId)) return { ok: false, reason: 'tx_taken' };
  const r = linkNodes(itemNodeId, txNodeId, CLAIM_RELATION);
  return r.ok ? { ok: true } : { ok: false, reason: 'link_failed' };
}

/** 取消认领。 */
export function unclaimSpend(itemNodeId: string, txNodeId: string): boolean {
  return unlinkNodes(itemNodeId, txNodeId, CLAIM_RELATION);
}

/** 「不是这笔」——进否决记忆,同一对永不重复推荐(复用小票那套负样本)。 */
export function rejectClaim(itemNodeId: string, txId: string): void {
  rejectPair(itemNodeId, txId);
}

/** 这一对是否已被否决(给 UI 判断要不要还显示)。 */
export function claimRejected(itemNodeId: string, txId: string, rejected = loadRejectedPairs()): boolean {
  return rejected.has(pairKey(itemNodeId, txId));
}

/**
 * 一件东西**实际花了多少**:认领了就用银行的数,没认领就用你填的数。
 *
 * 为什么优先银行:你填的是回忆(「大概两百吧」),银行是事实。
 * 两个都没有就返回 null —— **不要返回 0**,那会让「没记价格」和「免费」长得一样。
 */
export function actualSpend(
  item: { price?: number | null },
  claimedTx?: { amount: number } | null,
): number | null {
  if (claimedTx && Number.isFinite(claimedTx.amount)) return Math.abs(claimedTx.amount);
  if (typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0) return item.price;
  return null;
}
