'use client';

/**
 * RecurringPane — 订阅 · 定期监控页(P3 拆分自 FinanceTab;设计=artifact fb540e24 屏 7)。
 * 三层:将至(别忘账单)→ 变化置顶(涨价/新增/疑似停了)→ 稳定收起;
 * 尾部「Plaid 识别的补充」= 官方定期流并集(本地为准)。纯展示,数据经 props 传入。
 */

import { formatMoney, loadPlaidRecurring, plaidOnlyRecurring, upcomingRecurring, type BankTx, type RecurringCharge } from '@/lib/portal/bank-tx';
import { detectIncome, recurringChanges, subscriptionLoad } from '@/lib/portal/finance-features';
import { L } from '@/lib/portal/i18n';

export default function RecurringPane({ txs, recurring, currency, dict }: {
  txs: BankTx[]; recurring: RecurringCharge[]; currency: string; dict: string;
}) {
  const upcoming = upcomingRecurring(txs, 7);
  if (!recurring.length) {
    return <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '还没识别到定期扣款。多同步几个月流水,订阅 / 账单会自动出现在这里。', 'No recurring charges detected yet — sync a few more months and subscriptions will appear here.')}</p>;
  }
        const mature = recurring.filter((r) => r.status === 'mature');
        const load = subscriptionLoad(txs, mature); // 与页内列表同一份数据(口径统一)
        const inc = detectIncome(txs);
        const loadPct = inc && inc.monthlyIncome > 0 ? Math.round((load.monthly / inc.monthlyIncome) * 100) : null;
        const up = upcoming; // 7 天;下方分组覆盖更远
        const ch = recurringChanges(recurring);
        const row = (r: (typeof recurring)[number], pill: string, pillCls: string) => (
          <div key={r.key} className="nesio-fin-acctrow">
            <div className="nesio-fin-acctrow-body">
              <span className="nesio-fin-acctrow-name">{r.name}</span>
              <span className="nesio-fin-acctrow-sub">{L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {L(dict, `下次约 ${r.nextEstimate}`, `next ~${r.nextEstimate}`)}{r.status === 'predicted' ? L(dict, ' · 待确认', ' · unconfirmed') : ''}</span>
            </div>
            <span className="nesio-fin-acctrow-bal">{formatMoney(r.latestAmount || r.avgAmount, r.currency)}</span>
            <span className={`nesio-fin-delta ${pillCls}`}>{pill}</span>
          </div>
        );
        return (
          <>
            <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
              {L(dict, `每月约 ${formatMoney(load.monthly, currency)} · ${mature.length} 项已成熟${loadPct != null ? ` · 占收入 ${loadPct}%` : ''}${recurring.length > mature.length ? ` · 另 ${recurring.length - mature.length} 项待确认` : ''}`,
                `~${formatMoney(load.monthly, currency)}/mo · ${mature.length} confirmed${loadPct != null ? ` · ${loadPct}% of income` : ''}${recurring.length > mature.length ? ` · ${recurring.length - mature.length} unconfirmed` : ''}`)}
            </p>
            {up.items.length > 0 && (
              <>
                <p className="nesio-settings-section-label">{L(dict, '接下来 7 天', 'Next 7 days')}</p>
                {up.items.map((r) => row(r, L(dict, '快到了', 'due soon'), 'up'))}
              </>
            )}
            {(ch.hiked.length > 0 || ch.fresh.length > 0 || ch.stalled.length > 0) && (
              <>
                <p className="nesio-settings-section-label" style={{ marginTop: '0.8rem' }}>{L(dict, '变化了的 · 先看这几个', 'Changed — look here first')}</p>
                {ch.hiked.map((r) => row(r, L(dict, `涨了`, 'up'), 'up'))}
                {ch.fresh.map((r) => row(r, L(dict, '新增', 'new'), 'up'))}
                {ch.stalled.map((r) => row(r, L(dict, '疑似停了', 'maybe ended'), 'down'))}
              </>
            )}
            <p className="nesio-settings-section-label" style={{ marginTop: '0.8rem' }}>{L(dict, `稳定的 · ${ch.steady.length} 项`, `Steady · ${ch.steady.length}`)}</p>
            {ch.steady.slice(0, 8).map((r) => row(r, L(dict, '稳定', 'steady'), 'down'))}
            {(() => {
              // P2 尾巴:Plaid 官方定期流并集 —— 本地没识别到的补充展示(覆盖广度归 Plaid)
              const extra = plaidOnlyRecurring(loadPlaidRecurring(), recurring);
              if (!extra.length) return null;
              return (
                <>
                  <p className="nesio-settings-section-label" style={{ marginTop: '0.8rem' }}>{L(dict, `Plaid 识别的补充 · ${extra.length} 项`, `From Plaid · ${extra.length}`)}</p>
                  {extra.slice(0, 6).map((s) => (
                    <div key={`plaid-${s.name}-${s.lastDate}`} className="nesio-fin-acctrow">
                      <div className="nesio-fin-acctrow-body">
                        <span className="nesio-fin-acctrow-name">{s.name}</span>
                        <span className="nesio-fin-acctrow-sub">{s.frequency.toLowerCase()}{s.nextDate ? L(dict, ` · 下次约 ${s.nextDate}`, ` · next ~${s.nextDate}`) : ''}</span>
                      </div>
                      <span className="nesio-fin-acctrow-bal">{formatMoney(s.amount, s.currency)}</span>
                      <span className="nesio-fin-delta down">Plaid</span>
                    </div>
                  ))}
                </>
              );
            })()}
            <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '「疑似停了」= 已两个周期没扣款 —— 可能是省钱好事,确认一下就行。快到期的会出现在 Today。', '“Maybe ended” = two cycles missed — possibly good news. Due-soon items surface in Today.')}</p>
          </>
        );
}
