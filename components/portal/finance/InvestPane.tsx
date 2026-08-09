'use client';

/**
 * InvestPane — 投资页(P3 拆分自 FinanceTab)。
 * bug2 批:收益柱状图删除(投资图不需要);持仓按账户分组显示(多一层账户分类);
 * 不显示份数。只陈述事实,不给建议。
 */

import { formatMoney, investmentAccountIds, displayAccountName, loadAccountNames, holdingId, type BankTx, type BankAccount, type Holding } from '@/lib/portal/bank-tx';
import { investIncomeYTD, portfolioCheckup } from '@/lib/portal/finance-features';
import { investDailyChange, type NetWorthSnapshot } from '@/lib/portal/finance-assets';
import { L } from '@/lib/portal/i18n';
import { investEmptyReason } from '@/lib/portal/invest-empty';

export default function InvestPane({ txs, holdings, accounts, nwSeries, currency, dict }: {
  txs: BankTx[]; holdings: Holding[]; accounts: BankAccount[]; nwSeries: NetWorthSnapshot[]; currency: string; dict: string;
}) {
  const daily = investDailyChange(nwSeries);
  const ytd = investIncomeYTD(txs, undefined, investmentAccountIds());
  const checkup = portfolioCheckup(holdings, txs);
  const names = loadAccountNames();
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  /**
   * 空态(2026-08-01,用户实测:这一页只剩一句免责声明,一片白)。
   *
   * 「一片白 + 一句『价格是上次同步的快照』」是这一屏最糟的一种状态:
   * 它既没说**为什么空**,也没说**下一步做什么**,用户唯一能得出的结论是
   * 「这个功能坏了」。而空的原因有三种,三个完全不同的下一步:
   *   · 压根没连投资账户  → 去连
   *   · 连了但这次没同步到持仓 → 去同步(或者券商那边确实没给)
   *   · 连了、也同步了,账户里就是没有持仓 → 什么都不用做
   * 把它们说成同一句「暂无数据」,等于让用户自己去猜是哪一种。
   */
  const investIds = investmentAccountIds(accounts);
  const investAccounts = accounts.filter((a) => investIds.has(a.id));
  const emptyReason = investEmptyReason({
    holdingCount: holdings.length,
    investAccountCount: investAccounts.length,
  });
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
      {/* bug3:顶上那行「今年到现在:股利 … · 利息 …」灰字按标注删掉 */}

      {emptyReason === 'no-account' && (
        <div className="nesio-fin-empty">
          <p className="nesio-fin-empty-title">{L(dict, '还没有连投资账户', 'No investment account connected yet')}</p>
          <p className="nesio-fin-empty-body">
            {L(dict, '到设置 → 数据接入里连一个券商(Fidelity / Schwab / Robinhood 这类),持仓和成本就会出现在这里。',
              'Connect a brokerage in Settings → Data sources (Fidelity, Schwab, Robinhood…) and your holdings will show up here.')}
          </p>
        </div>
      )}

      {emptyReason === 'no-holdings' && (
        <div className="nesio-fin-empty">
          <p className="nesio-fin-empty-title">
            {L(dict, `连着 ${investAccounts.length} 个投资账户,但这次没取到持仓`,
              `${investAccounts.length} investment ${investAccounts.length === 1 ? 'account' : 'accounts'} connected, but no holdings came back`)}
          </p>
          <p className="nesio-fin-empty-body">
            {/* **不下结论说账户是空的** —— 「没同步到」和「账户里真的没有」是两回事,
                而我们这边分不出来。分不出来就如实说分不出来,不替券商断言。 */}
            {L(dict, '到设置 → 数据接入里同步一次财务。同步过还是空的话,就是券商那边这个账户确实没有持仓(现金账户常常是这样)。',
              'Run a finance sync in Settings → Data sources. If it is still empty after that, the account genuinely holds no positions — cash accounts often look like this.')}
          </p>
          <p className="nesio-fin-empty-body">
            {investAccounts.map((a) => `${displayAccountName(a, names)}${a.mask ? ` ····${a.mask}` : ''}`).join(' · ')}
          </p>
        </div>
      )}
      {groups.map((g) => {
        const a = acctById.get(g.accountId);
        const label = a ? `${displayAccountName(a, names)}${a.mask ? ` ····${a.mask}` : ''}` : L(dict, '其他账户', 'Other account');
        return (
          <div key={g.accountId} style={{ marginTop: 'var(--space-3)' }}>
            {/* bug3:账户名用正文黑体 —— nesio-fin-group-h 是小型大写 + 字距,英文账户名读起来像标签 */}
            <p className="nesio-fin-group-h nesio-fin-group-h--plain">{label} · {formatMoney(g.total, currency)}</p>
            {g.list.map((h) => {
              const gain = typeof h.costBasis === 'number' && h.costBasis > 0 ? Math.round(((h.value - h.costBasis) / h.costBasis) * 100) : null;
              const rowKey = h.id || holdingId(h);
              return (
                <div key={rowKey} className="nesio-fin-acctrow">
                  <div className="nesio-fin-acctrow-body">
                    {/* bug3:不显示基金的文字名称(「Fidelity Concord…」占满一行还被截断),
                        只留 ticker;没有 ticker 的才退回名字。持仓字重按系统正文,不加粗。 */}
                    <span className="nesio-fin-acctrow-name" style={{ fontWeight: 'var(--weight-regular)' }}>{h.ticker || h.name}</span>
                    {typeof h.costBasis === 'number' && h.costBasis > 0 && (
                      <span className="nesio-fin-acctrow-sub">{L(dict, `成本 ${formatMoney(h.costBasis, h.currency)}`, `cost ${formatMoney(h.costBasis, h.currency)}`)}</span>
                    )}
                  </div>
                  {/* bug3:「绿色收益是指什么时间段」—— 它是持有至今(相对成本价)的累计收益,
                      不是今日/今年。把口径写在数字旁边,别让人猜。 */}
                  <span className="nesio-fin-acctrow-bal">{formatMoney(h.value, h.currency)}{gain != null && (
                    <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: gain >= 0 ? 'var(--status-go)' : 'var(--status-gentle)', textAlign: 'right' }}>
                      {gain >= 0 ? '+' : ''}{gain}% <span style={{ color: 'var(--portal-muted)' }}>{L(dict, '持有至今', 'since buy')}</span>
                    </span>
                  )}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {checkup && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-2)' }}>{L(dict, '组合体检 · 本地确定性计算', 'Portfolio checkup · local & deterministic')}</p>
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
            {L(dict,
              `集中度:${checkup.topName} 占 ${checkup.topPct}% · 前三占 ${checkup.top3Pct}%。配置:${checkup.allocation.slice(0, 3).map((x) => `${x.type} ${x.pct}%`).join(' · ')}。今年买 ${checkup.buys} 次 · 卖 ${checkup.sells} 次。`,
              `Concentration: ${checkup.topName} ${checkup.topPct}% · top-3 ${checkup.top3Pct}%. Mix: ${checkup.allocation.slice(0, 3).map((x) => `${x.type} ${x.pct}%`).join(' · ')}. ${checkup.buys} buys · ${checkup.sells} sells this year.`)}
          </p>
        </>
      )}
      {/* 这句只在**真有持仓**时说。一屏什么都没有、底下孤零零一句
          「价格是上次同步的快照」—— 那正是用户实测时看到的整个页面。
          没有价格的时候谈价格的口径,是噪音,不是诚实。 */}
      {emptyReason === 'none' && (
        <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '价格是上次同步的快照,不是实时行情;只陈述事实,不给买卖建议。', 'Prices are last-sync snapshots, not live quotes; facts only, no advice.')}</p>
      )}
    </>
  );
}
