'use client';

/**
 * InvestPane — 投资页(P3 拆分自 FinanceTab)。
 * bug2 批:收益柱状图删除(投资图不需要);持仓按账户分组显示(多一层账户分类);
 * 不显示份数。只陈述事实,不给建议。
 */

import { formatMoney, investmentAccountIds, displayAccountName, loadAccountNames, type BankTx, type BankAccount, type Holding } from '@/lib/portal/bank-tx';
import { investIncomeYTD, portfolioCheckup } from '@/lib/portal/finance-features';
import { investDailyChange, type NetWorthSnapshot } from '@/lib/portal/finance-assets';
import { L } from '@/lib/portal/i18n';

export default function InvestPane({ txs, holdings, accounts, nwSeries, currency, dict }: {
  txs: BankTx[]; holdings: Holding[]; accounts: BankAccount[]; nwSeries: NetWorthSnapshot[]; currency: string; dict: string;
}) {
  const daily = investDailyChange(nwSeries);
  const ytd = investIncomeYTD(txs, undefined, investmentAccountIds());
  const checkup = portfolioCheckup(holdings, txs);
  const names = loadAccountNames();
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  // bug2:持仓按账户分组(组内按市值降序,组按合计降序)
  const groups = (() => {
    const m = new Map<string, Holding[]>();
    for (const h of holdings) { const list = m.get(h.accountId) || []; list.push(h); m.set(h.accountId, list); }
    return [...m.entries()]
      .map(([accountId, list]) => ({ accountId, list: [...list].sort((a, b) => b.value - a.value), total: list.reduce((s, h) => s + h.value, 0) }))
      .sort((a, b) => b.total - a.total);
  })();
  return (
    <>
      {daily && (
        <p className="nesio-fin-alert-note" style={{ textAlign: 'left', color: daily.delta >= 0 ? 'var(--status-go)' : 'var(--portal-muted)' }}>
          {L(dict, `今天 ${daily.delta >= 0 ? '+' : ''}${formatMoney(Math.abs(daily.delta), currency)} (${daily.pct >= 0 ? '+' : ''}${daily.pct}%) · 与上次同步(${daily.fromDate})比`,
            `Today ${daily.delta >= 0 ? '+' : ''}${formatMoney(Math.abs(daily.delta), currency)} (${daily.pct >= 0 ? '+' : ''}${daily.pct}%) · vs last sync (${daily.fromDate})`)}
        </p>
      )}
      {(ytd.dividends > 0 || ytd.interest > 0) && (
        <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, `今年到现在:股利 ${formatMoney(ytd.dividends, currency)} · 利息 ${formatMoney(ytd.interest, currency)}`, `YTD: dividends ${formatMoney(ytd.dividends, currency)} · interest ${formatMoney(ytd.interest, currency)}`)}</p>
      )}
      {groups.map((g) => {
        const a = acctById.get(g.accountId);
        const label = a ? `${displayAccountName(a, names)}${a.mask ? ` ····${a.mask}` : ''}` : L(dict, '其他账户', 'Other account');
        return (
          <div key={g.accountId} style={{ marginTop: 'var(--space-3)' }}>
            <p className="nesio-fin-group-h">{label} · {formatMoney(g.total, currency)}</p>
            {g.list.map((h, i) => {
              const gain = typeof h.costBasis === 'number' && h.costBasis > 0 ? Math.round(((h.value - h.costBasis) / h.costBasis) * 100) : null;
              return (
                <div key={`${h.accountId}-${h.ticker || h.name}-${i}`} className="nesio-fin-acctrow">
                  <div className="nesio-fin-acctrow-body">
                    <span className="nesio-fin-acctrow-name">{h.ticker ? `${h.ticker} · ` : ''}{h.name}</span>
                    {typeof h.costBasis === 'number' && h.costBasis > 0 && (
                      <span className="nesio-fin-acctrow-sub">{L(dict, `成本 ${formatMoney(h.costBasis, h.currency)}`, `cost ${formatMoney(h.costBasis, h.currency)}`)}</span>
                    )}
                  </div>
                  <span className="nesio-fin-acctrow-bal">{formatMoney(h.value, h.currency)}{gain != null && <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: gain >= 0 ? 'var(--status-go)' : 'var(--status-gentle)', textAlign: 'right' }}>{gain >= 0 ? '+' : ''}{gain}%</span>}</span>
                </div>
              );
            })}
          </div>
        );
      })}
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
