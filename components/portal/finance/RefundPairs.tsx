'use client';

/**
 * RefundPairs — 退款配对的「建议 + 确认」(L4)。
 *
 * 交易页里,给每一笔还没配上的退款找它的原始消费,给出建议,由你点头。
 *
 * **为什么不自动配**:退款关系会改变月度数字。自动认了就是「财务数据自己变了」
 * 那一类病(QA #21)。而且配错的代价特别隐蔽 —— 两笔真实的钱互相抵消,
 * 两条记录都还在、都对,只是关系连错了,靠肉眼几乎发现不了。
 *
 * **为什么部分退款不默认勾**:人看到「已经帮你选好了」多半直接确认。
 * 只有「全额退 + 同商户 + 30 天内」才够硬(refundSuggestionIsStrong)。
 *
 * 算的部分全在 lib/portal/ledger-refund.ts(纯函数 + 契约)。这里只显示和收确认。
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
import type { BankTx } from '@/lib/portal/bank-tx';

/** 一次最多摆几笔待配对 —— 一屏摆几十条只会让人全部跳过。 */
const MAX_SHOWN = 5;

export default function RefundPairs({ txs, currency, onChanged }: {
  txs: readonly BankTx[]; currency?: string; onChanged: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState('');

  const pending = useMemo(() => {
    const links = loadRefundLinks();
    const rejected = loadRejectedRefundPairs();
    // BankTx 的约定是**支出为正**,所以退款(进账)是负数。
    // 这里只看金额为负、且还没配上的那些。
    const refunds = txs.filter((x) => x.amount < 0 && !links[x.id]);
    const purchases = txs.filter((x) => x.amount > 0);
    const out: Array<{ refund: BankTx; best: ReturnType<typeof refundCandidates>[number]; strong: boolean; over: number }> = [];
    for (const r of refunds) {
      const cands = refundCandidates(
        { id: r.id, occurredAt: r.date, amount: Math.abs(r.amount), merchant: r.name },
        purchases.map((p) => ({ id: p.id, occurredAt: p.date, amount: p.amount, merchant: p.name })),
        { rejected },
      );
      if (!cands.length) continue;
      const best = cands[0];
      // 这笔消费名下已有的退款,拿来判「再挂一笔会不会超过原额」
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

  function confirm(refundId: string, purchaseId: string) {
    setErr('');
    // 红线:存储写失败必须说出来 —— 静默的话人看到「我明明关联了,月支出怎么没变」
    if (!linkRefund(refundId, purchaseId)) {
      setErr(t('没存上 —— 本机存储写不进去,这条关联没生效。', 'Could not save — local storage refused the write; this link did not take effect.'));
      return;
    }
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
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
        {`${t('退款待配对 ·', 'Refunds to pair ·')} ${pending.length}`}
      </p>
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
          {/* 够硬 / 不够硬要说出来 —— 人得知道这条建议有多可信才好决定 */}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.6, color: over ? 'var(--status-gentle)' : strong ? 'var(--status-go)' : 'var(--portal-muted)' }}>
            {over
              ? `${t('这笔消费名下的退款加起来会超出原额', 'Refunds on that purchase would exceed it by')} ${formatMoney(over, currency)} —— ${t('多出来的更可能是另一笔消费的退款。', 'the excess is more likely a refund for a different purchase.')}`
              : strong
                ? t('金额、商户、时间都对得上。', 'Amount, merchant and timing all line up.')
                : t('对得上但不完全确定 —— 看一眼再决定。', 'Plausible but not certain — take a look before deciding.')}
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
    </div>
  );
}
