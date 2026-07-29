'use client';

/**
 * InvestPane — 投资页(P3 拆分自 FinanceTab;设计=artifact fb540e24 屏 8,收益导向)。
 * 今日变化(快照差,如实标口径)/ 当年股利利息 / 持仓明细 / 组合体检 —— 只陈述事实,不给建议。
 */

import { formatMoney, type BankTx, type Holding } from '@/lib/portal/bank-tx';
import { investIncomeYTD, portfolioCheckup } from '@/lib/portal/finance-features';
import { investDailyChange, type NetWorthSnapshot } from '@/lib/portal/finance-assets';
import { L } from '@/lib/portal/i18n';

export default function InvestPane({ txs, holdings, nwSeries, dict }: {
  txs: BankTx[]; holdings: Holding[]; nwSeries: NetWorthSnapshot[]; dict: string;
}) {
        const daily = investDailyChange(nwSeries);
        const ytd = investIncomeYTD(txs);
        const checkup = portfolioCheckup(holdings, txs);
        const hs = [...holdings].sort((a, b) => b.value - a.value);
        const maxM = Math.max(...ytd.byMonth, 1);
        return (
          <>
            {daily && (
              <p className="nesio-fin-alert-note" style={{ textAlign: 'left', color: daily.delta >= 0 ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                {L(dict, `今天 ${daily.delta >= 0 ? '+' : ''}${formatMoney(Math.abs(daily.delta))} (${daily.pct >= 0 ? '+' : ''}${daily.pct}%) · 与上次同步(${daily.fromDate})比`,
                  `Today ${daily.delta >= 0 ? '+' : ''}${formatMoney(Math.abs(daily.delta))} (${daily.pct}%) · vs last sync (${daily.fromDate})`)}
              </p>
            )}
            {(ytd.dividends > 0 || ytd.interest > 0) && (
              <>
                <p className="nesio-settings-section-label">{L(dict, '今年到现在 · 收益', 'This year · income')}</p>
                <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, `股利 ${formatMoney(ytd.dividends)} · 利息 ${formatMoney(ytd.interest)}`, `Dividends ${formatMoney(ytd.dividends)} · interest ${formatMoney(ytd.interest)}`)}</p>
                <svg viewBox="0 0 280 30" style={{ width: '100%', maxWidth: 320 }} aria-label={L(dict, '股利利息按月', 'Monthly dividends/interest')}>
                  {ytd.byMonth.map((v, i) => (
                    <rect key={i} x={i * 23 + 2} y={28 - (v / maxM) * 26} width={16} height={Math.max(1, (v / maxM) * 26)} rx={2}
                      fill={v > 0 ? 'var(--portal-accent)' : 'var(--portal-line)'} />
                  ))}
                </svg>
              </>
            )}
            {hs.length > 0 && (
              <>
                <p className="nesio-settings-section-label" style={{ marginTop: '0.6rem' }}>{L(dict, `持仓 · ${hs.length} 项`, `Holdings · ${hs.length}`)}</p>
                {hs.slice(0, 8).map((h, i) => {
                  const gain = typeof h.costBasis === 'number' && h.costBasis > 0 ? Math.round(((h.value - h.costBasis) / h.costBasis) * 100) : null;
                  return (
                    <div key={`${h.accountId}-${h.ticker || h.name}-${i}`} className="nesio-fin-acctrow">
                      <div className="nesio-fin-acctrow-body">
                        <span className="nesio-fin-acctrow-name">{h.ticker ? `${h.ticker} · ` : ''}{h.name}</span>
                        <span className="nesio-fin-acctrow-sub">{L(dict, `${h.quantity} 份`, `${h.quantity} sh`)}{typeof h.costBasis === 'number' && h.costBasis > 0 ? L(dict, ` · 成本 ${formatMoney(h.costBasis, h.currency)}`, ` · cost ${formatMoney(h.costBasis, h.currency)}`) : ''}</span>
                      </div>
                      <span className="nesio-fin-acctrow-bal">{formatMoney(h.value, h.currency)}{gain != null && <span style={{ display: 'block', fontSize: '0.65rem', color: gain >= 0 ? 'var(--status-go)' : 'var(--status-gentle)', textAlign: 'right' }}>{gain >= 0 ? '+' : ''}{gain}%</span>}</span>
                    </div>
                  );
                })}
              </>
            )}
            {checkup && (
              <>
                <p className="nesio-settings-section-label" style={{ marginTop: '0.6rem' }}>{L(dict, '组合体检 · 本地确定性计算', 'Portfolio checkup · local & deterministic')}</p>
                <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
                  {L(dict,
                    `集中度:${checkup.topName} 占 ${checkup.topPct}% · 前三占 ${checkup.top3Pct}%。配置:${checkup.allocation.slice(0, 3).map((x) => `${x.type} ${x.pct}%`).join(' · ')}。今年买 ${checkup.buys} 次 · 卖 ${checkup.sells} 次。`,
                    `Concentration: ${checkup.topName} ${checkup.topPct}% · top-3 ${checkup.top3Pct}%. Mix: ${checkup.allocation.slice(0, 3).map((x) => `${x.type} ${x.pct}%`).join(' · ')}. ${checkup.buys} buys · ${checkup.sells} sells this year.`)}
                </p>
              </>
            )}
            <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '价格是上次同步的快照,不是实时行情;只陈述事实,不给买卖建议。', 'Prices are last-sync snapshots, not live quotes; facts only, no advice.')}</p>
          </>
        );
}
