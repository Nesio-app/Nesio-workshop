'use client';

/**
 * RefundPairs — 退款配对的「建议 + 确认」(L4)。
 *
 * 交易页里,给每一笔还没配上的退款找它的原始消费,给出建议,由你点头。
 * 可折叠;基金符号(FDRXX 等)/基金买卖不进候选;确认一笔后同类自动归类。
 */

import { useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  refundCandidates, refundSuggestionIsStrong, loadRefundLinks, loadRejectedRefundPairs,
  linkRefund, rejectRefundPair, refundsOf, wouldOverRefund,
} from '@/lib/portal/ledger-refund';
import { formatMoney } from '@/lib/portal/bank-tx';
import { shouldSkipRefundMatch } from '@/lib/portal/finance-classify';
import { setTxCategory, setTxFlow } from '@/lib/portal/tx-annotations';
import type { BankTx } from '@/lib/portal/bank-tx';

const MAX_SHOWN = 5;
const FOLD_KEY = 'nesio-fin-refund-pairs-open-v1';

function similarName(a: string, b: string): boolean {
  const na = (a || '').toLowerCase().replace(/[^a-z0-9一-龥]+/g, ' ').trim();
  const nb = (b || '').toLowerCase().replace(/[^a-z0-9一-龥]+/g, ' ').trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(' ').filter((w) => w.length >= 3));
  const tb = nb.split(' ').filter((w) => w.length >= 3);
  if (!ta.size || !tb.length) return false;
  const hit = tb.filter((w) => ta.has(w)).length;
  return hit >= Math.min(2, ta.size, tb.length);
}

export default function RefundPairs({ txs, currency, onChanged }: {
  txs: readonly BankTx[]; currency?: string; onChanged: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(FOLD_KEY) !== '0'; } catch { return true; }
  });

  const pending = useMemo(() => {
    const links = loadRefundLinks();
    const rejected = loadRejectedRefundPairs();
    // 进账(负)且未配对;基金符号 / 基金买卖 / 分红利息等不进退款候选
    const refunds = txs.filter((x) => x.amount < 0 && !links[x.id] && !shouldSkipRefundMatch(x.name || ''));
    const purchases = txs.filter((x) => x.amount > 0 && !shouldSkipRefundMatch(x.name || ''));
    const out: Array<{ refund: BankTx; best: ReturnType<typeof refundCandidates>[number]; strong: boolean; over: number }> = [];
    for (const r of refunds) {
      const cands = refundCandidates(
        { id: r.id, occurredAt: r.date, amount: Math.abs(r.amount), merchant: r.name },
        purchases.map((p) => ({ id: p.id, occurredAt: p.date, amount: p.amount, merchant: p.name })),
        { rejected },
      );
      if (!cands.length) continue;
      const best = cands[0];
      const already = refundsOf(best.purchase.id, links)
        .map((id) => Math.abs(txs.find((x) => x.id === id)?.amount ?? 0));
      const { over, excess } = wouldOverRefund(best.purchase.amount, already, Math.abs(r.amount));
      out.push({ refund: r, best, strong: refundSuggestionIsStrong(best) && !over, over: over ? excess : 0 });
      if (out.length >= MAX_SHOWN) break;
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs, rev]);

  if (!pending.length) return null;

  const bump = () => { setRev((r) => r + 1); onChanged(); };

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(FOLD_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  /** 确认一对后:同名未配对进账自动记为收入/contribution,不再反复弹配对。 */
  function autoClassifySimilar(seed: BankTx) {
    const links = loadRefundLinks();
    for (const x of txs) {
      if (x.id === seed.id) continue;
      if (x.amount >= 0) continue;
      if (links[x.id]) continue;
      if (shouldSkipRefundMatch(x.name || '')) continue;
      if (!similarName(seed.name || '', x.name || '')) continue;
      setTxCategory(x.id, 'INCOME', 'INCOME_INVEST_CONTRIB');
      setTxFlow(x.id, 'income');
    }
  }

  function confirm(refundId: string, purchaseId: string) {
    setErr('');
    if (!linkRefund(refundId, purchaseId)) {
      setErr(t('没存上 —— 本机存储写不进去,这条关联没生效。', 'Could not save — local storage refused the write; this link did not take effect.'));
      return;
    }
    const seed = txs.find((x) => x.id === refundId);
    // 记为收入/contribution(用户口径:这类进账不是「退货」)
    setTxCategory(refundId, 'INCOME', 'INCOME_INVEST_CONTRIB');
    setTxFlow(refundId, 'income');
    if (seed) autoClassifySimilar(seed);
    bump();
  }
  function deny(refundId: string, purchaseId: string) {
    setErr('');
    rejectRefundPair(refundId, purchaseId);
    bump();
  }

  const card: React.CSSProperties = {
    border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)', marginBottom: 'var(--space-2)',
    display: 'flex', flexDirection: 'column', gap: 6,
  };
  const btn: React.CSSProperties = {
    flex: 1, border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)',
    padding: '8px', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)',
    cursor: 'pointer', background: 'transparent', color: 'var(--portal-accent)',
  };

  return (
    <div>
      <button type="button" className="nesio-settings-section-label" onClick={toggleOpen}
        style={{ marginTop: 0, display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
        aria-expanded={open}>
        <span>{`${t('退款待配对 ·', 'Refunds to pair ·')} ${pending.length}`}</span>
        <span aria-hidden style={{ color: 'var(--portal-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          {err && <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-risk)', margin: '0 0 6px', lineHeight: 1.6 }}>{err}</p>}
          {pending.map(({ refund, best, strong, over }) => (
            <div key={refund.id} style={card}>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-ink)', lineHeight: 1.6 }}>
                {`${refund.date?.slice(5).replace('-', '/')} ${refund.name || t('退款', 'Refund')} +${formatMoney(Math.abs(refund.amount), currency)}`}
              </p>
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
                {`${t('可能是这笔的退款:', 'Likely a refund for:')} ${best.purchase.occurredAt?.slice(5).replace('-', '/')} ${best.purchase.merchant || ''} -${formatMoney(Math.abs(best.purchase.amount), currency)}`}
                {best.exact ? ` · ${t('全额退', 'full refund')}` : ` · ${t('部分退', 'partial')}`}
                {` · ${t('相隔', '')}${best.dayGap}${t(' 天', 'd apart')}`}
              </p>
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.6, color: over ? 'var(--status-gentle)' : strong ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                {over
                  ? `${t('这笔消费名下的退款加起来会超出原额', 'Refunds on that purchase would exceed it by')} ${formatMoney(over, currency)} —— ${t('多出来的更可能是另一笔消费的退款。', 'the excess is more likely a refund for a different purchase.')}`
                  : strong
                    ? t('金额、商户、时间都对得上。确认后记为收入,同类会自动归类。', 'Amount, merchant and timing line up. Confirm to mark as income; similar ones auto-classify.')
                    : !best.exact
                      ? t('金额是部分退 —— 核对是不是同一笔消费拆着退的。', 'Partial amount — check whether this is a split refund for that purchase.')
                      : best.dayGap > 14
                        ? `${t('相隔', '')}${best.dayGap}${t(' 天 —— 也可能是同商户另一笔消费的退款。', 'd apart — could also be a refund for a different charge at the same merchant.')}`
                        : t('对得上但不完全确定 —— 差在金额或间隔,核对后再确认。', 'Close but not certain — amount or timing is off; confirm after a look.')}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={strong ? { ...btn, background: 'var(--portal-accent-soft-md)' } : btn}
                  onClick={() => confirm(refund.id, best.purchase.id)}>
                  {t('就是它', "That's the one")}
                </button>
                <button type="button" style={btn} onClick={() => deny(refund.id, best.purchase.id)}>
                  {t('不是', 'Not it')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
