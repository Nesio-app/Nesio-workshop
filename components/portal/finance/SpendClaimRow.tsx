'use client';

/**
 * SpendClaimRow — 「这笔钱是哪一笔」。
 *
 * 一件东西(一件衣服、一顿饭、一张发票)记了价格之后,这一行去银行流水里找它对应的
 * 那一笔,你点头才算数。
 *
 * ## 为什么是认领,不是记账
 *
 * 刷卡买的话 Plaid 已经有那条流水了。再「顺手记一笔支出」就是**双计** ——
 * 月支出凭空多一份,而且两条记录看起来都对,几乎不可能靠肉眼发现。
 * 所以 `price` 的语义是**去认领那笔流水**,不是新增一笔账。
 *
 * ## 三条硬规矩
 *
 *   1. **一笔流水只能被一件东西认领**。否则同一笔钱同时算成「这件衣服的」和
 *      「那顿饭的」,两边都显示金额,而实际只花了一次。`claimedTxIds()` 挡住。
 *   2. **你点头才生效**。系统只给候选,不自动连 —— 认错了比没认更糟。
 *   3. **「不是这笔」要有记忆**。否决过的一对永不再推荐,否则每次进来都推同一个错的。
 *
 * ## 认领之后金额以银行为准
 *
 * 你填的是回忆(「大概两百吧」),银行是事实。`actualSpend()` 定的这条,这里只显示。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { loadBankTx, type BankTx } from '@/lib/portal/providers/bank-tx';
import { findTxNode } from '@/lib/portal/tx-node';
import {
  claimCandidates, claimSpend, unclaimSpend, rejectClaim, claimedTxIds,
  CLAIM_RELATION, type Claimable,
} from '@/lib/portal/spend-claim';
import { getLifeGraph } from '@/lib/portal/life-graph';

interface Props {
  /** 这件东西在图里的节点 id。没有节点就没法认领(关联写在 relations 上)。 */
  itemNodeId: string;
  item: Claimable;
  dict: string;
  /** 认领状态变了 —— 让父组件重算「实际花了多少」。 */
  onChanged?: () => void;
}

const money = (n: number, cur = 'USD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n); }
  catch { return `${n.toFixed(2)}`; }
};

export default function SpendClaimRow({ itemNodeId, item, dict, onChanged }: Props) {
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { try { setTxs(loadBankTx()); } catch { setTxs([]); } }, []);

  /** 已经认领了哪一笔(从图读 —— 图是事实)。 */
  const claimed = useMemo(() => {
    void tick;
    try {
      const g = getLifeGraph();
      const me = g.find((n) => n.id === itemNodeId);
      const rel = (me?.relations || []).find((r) => r.relation === CLAIM_RELATION);
      if (!rel) return null;
      const node = g.find((n) => n.id === rel.targetId);
      const txId = typeof node?.attributes?.txId === 'string' ? node.attributes.txId : null;
      return { nodeId: rel.targetId, tx: txId ? txs.find((t) => t.id === txId) ?? null : null };
    } catch { return null; }
  }, [itemNodeId, txs, tick]);

  const candidates = useMemo(() => {
    void tick;
    if (claimed) return [];
    try { return claimCandidates(item, txs); } catch { return []; }
  }, [item, txs, claimed, tick]);

  const doClaim = useCallback((tx: BankTx) => {
    setErr(null);
    const node = findTxNode(tx.id);
    if (!node) {
      // 诚实说清楚:不是「失败了」,是这笔流水还没进记忆。下次同步就有了。
      setErr(L(dict, '这笔流水还没同步进记忆,稍等下次同步就能认领了。',
        "This transaction hasn't synced into memory yet — try again after the next sync."));
      return;
    }
    const r = claimSpend(itemNodeId, node.id);
    if (!r.ok) {
      setErr(
        r.reason === 'tx_taken'
          ? L(dict, '这笔钱已经被别的东西认领了 —— 一笔钱只能算一次。',
               'Another item already claimed this transaction — one payment, one owner.')
          : L(dict, '没能连上,再试一次。', "Couldn't link it — try again."),
      );
      return;
    }
    setOpen(false);
    setTick((v) => v + 1);
    onChanged?.();
  }, [itemNodeId, dict, onChanged]);

  const doReject = useCallback((tx: BankTx) => {
    rejectClaim(itemNodeId, tx.id);   // 否决记忆:这一对永不再推荐
    setTick((v) => v + 1);
  }, [itemNodeId]);

  const doUnclaim = useCallback(() => {
    if (!claimed) return;
    unclaimSpend(itemNodeId, claimed.nodeId);
    setTick((v) => v + 1);
    onChanged?.();
  }, [claimed, itemNodeId, onChanged]);

  // 没填价格 / 没日期 → 配不了,不摆一个点了没反应的按钮
  if (!(item.price > 0) || !item.occurredAt) return null;

  if (claimed) {
    return (
      <div className="nesio-claim-row">
        <span className="nesio-claim-done">
          {claimed.tx
            ? L(dict, `实际花了 ${money(Math.abs(claimed.tx.amount), claimed.tx.currency || 'USD')} · ${claimed.tx.name}`,
                 `Actually ${money(Math.abs(claimed.tx.amount), claimed.tx.currency || 'USD')} · ${claimed.tx.name}`)
            : L(dict, '已对上银行的一笔', 'Matched to a transaction')}
        </span>
        <button type="button" className="nesio-fin-flowopt" onClick={doUnclaim}>
          {L(dict, '取消', 'Undo')}
        </button>
      </div>
    );
  }

  if (!candidates.length) {
    // 空态也要诚实:是「没有像的」还是「银行还没连」——两件事,别混成一句。
    const noBank = txs.length === 0;
    return (
      <div className="nesio-claim-row">
        <span className="nesio-claim-hint">
          {noBank
            ? L(dict, '连上银行后可以自动对上这笔钱', 'Connect a bank to match this to a real payment')
            : L(dict, '银行流水里暂时没有像的一笔', 'No matching transaction found yet')}
        </span>
      </div>
    );
  }

  return (
    <div className="nesio-claim-block">
      <button
        type="button"
        className="nesio-fin-flowopt"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {L(dict, `这笔钱是哪一笔？(${candidates.length})`, `Which payment was this? (${candidates.length})`)}
      </button>
      {open && (
        <ul className="nesio-claim-list">
          {candidates.map((tx) => (
            <li key={tx.id} className="nesio-claim-item">
              <div className="nesio-claim-item-main">
                <span className="nesio-claim-item-name">{tx.name}</span>
                <span className="nesio-claim-item-meta">
                  {tx.date} · {money(Math.abs(tx.amount), tx.currency || 'USD')}
                </span>
              </div>
              <div className="nesio-claim-item-acts">
                <button type="button" className="nesio-fin-flowopt is-active" onClick={() => doClaim(tx)}>
                  {L(dict, '就是这笔', "That's it")}
                </button>
                <button type="button" className="nesio-fin-flowopt" onClick={() => doReject(tx)}>
                  {L(dict, '不是', 'Not this')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="nesio-claim-err" role="status">{err}</p>}
    </div>
  );
}

/** 给列表页用:一次算出「哪些东西已经认领过了」,免得每行各扫一次全图。 */
export function useClaimedTxIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { try { setIds(claimedTxIds()); } catch { /* 图读不出来按都没认领走 */ } }, []);
  return ids;
}
