/**
 * receipt-match — 小票 ↔ 银行流水对账(财务大修 P1,一体化的关键)。
 *
 * 美食/物品拍的小票(finance-sources Expense)带金额 → 在银行流水里找同一笔:
 * 金额 ±1% + 日期 ±3 天 + (可选)商户词命中。关联后小票降级为「明细层」,
 * KPI 以银行流水为准(listExpenses financeOnly 排除已关联行,不双计)。
 * 「不是」进否决记忆(负样本,同转账对敲/maybe rejected_transfers 一套思想),永不重复推荐。
 */

import type { BankTx } from './bank-tx';
import { reportStorageDropped } from './storage-health';

export interface ReceiptLike {
  id: string;
  amount: number;      // 正数
  occurredAt: string;  // YYYY-MM-DD
  merchant?: string;
}

const REJECT_KEY = 'nesio-receipt-match-rejected-v1';

export function pairKey(receiptId: string, txId: string): string {
  return `${receiptId}|${txId}`;
}

export function loadRejectedPairs(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(REJECT_KEY) || '[]') as string[]); } catch { return new Set(); }
}

/** 否决一对(幂等)。 */
export function rejectPair(receiptId: string, txId: string): void {
  if (typeof window === 'undefined') return;
  const set = loadRejectedPairs();
  set.add(pairKey(receiptId, txId));
  try { localStorage.setItem(REJECT_KEY, JSON.stringify([...set])); } catch { reportStorageDropped(); }
}

function dayDiff(a: string, b: string): number {
  const ms = Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime());
  return Math.round(ms / 86400000);
}

/**
 * 候选生成(纯函数):金额 |Δ|≤1%(且 ≤$1 下限保小额)+ 日期 ±windowDays + 排除已否决/已被
 * 其他小票占用的交易。按 日期差 ↑ → 商户词命中 ↓ 排序,最多 max 条。
 */
export function receiptMatchCandidates(
  receipt: ReceiptLike,
  txs: readonly BankTx[],
  opts?: { rejected?: Set<string>; taken?: Set<string>; windowDays?: number; max?: number },
): BankTx[] {
  const rejected = opts?.rejected ?? new Set<string>();
  const taken = opts?.taken ?? new Set<string>();
  const windowDays = opts?.windowDays ?? 3;
  const amt = Math.abs(receipt.amount);
  if (!(amt > 0) || !receipt.occurredAt) return [];
  const tol = Math.max(amt * 0.01, 1);
  const merchantTokens = (receipt.merchant || '').toUpperCase().split(/[^A-Z0-9一-鿿]+/).filter((s) => s.length >= 3);
  const scored: Array<{ t: BankTx; dd: number; hit: number }> = [];
  for (const t of txs) {
    if (t.amount <= 0) continue; // 只匹配支出方向
    if (Math.abs(t.amount - amt) > tol) continue;
    const dd = dayDiff(t.date, receipt.occurredAt);
    if (dd > windowDays) continue;
    if (rejected.has(pairKey(receipt.id, t.id)) || taken.has(t.id)) continue;
    const name = (t.name || '').toUpperCase();
    const hit = merchantTokens.some((k) => name.includes(k)) ? 1 : 0;
    scored.push({ t, dd, hit });
  }
  return scored
    .sort((a, b) => (a.dd - b.dd) || (b.hit - a.hit))
    .slice(0, opts?.max ?? 3)
    .map((s) => s.t);
}
