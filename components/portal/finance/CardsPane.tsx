'use client';

/**
 * CardsPane — 账户页(P3 拆分自 FinanceTab):Plaid 账户分组 + 资产小结 + 持仓
 * + 手动资产(锚点估值 / 折旧 / 持有成本,与自动账户同页同列)。纯展示,数据经 props。
 */

import {
  accountMonth, accountTypeLabel, assetSummary, formatMoney, removeBankAccount,
  type BankTx, type BankAccount, type Holding,
} from '@/lib/portal/bank-tx';
import { incomeBreakdown, portfolioSummary } from '@/lib/portal/finance-features';
import {
  assetCurrentValue, assetDepreciation, assetHoldingCosts, channelBalance, removeManualAsset, recordNetWorthSnapshot,
  type ManualAsset,
} from '@/lib/portal/finance-assets';
import { loadDomainExpenses } from '@/lib/portal/finance-sources';
import { L } from '@/lib/portal/i18n';
import AcctLogo from './AcctLogo';

export default function CardsPane({ txs, accounts, holdings, manualAssets, ym, currency, dict, onQuickAddAsset, onChanged }: {
  txs: BankTx[]; accounts: BankAccount[]; holdings: Holding[]; manualAssets: ManualAsset[];
  ym: string; currency: string; dict: string; onQuickAddAsset: (assetId?: string) => void; onChanged: () => void;
}) {
  const portfolio = portfolioSummary(holdings);
  // 卡片页分组:存款 / 负债(信用卡+贷款);投资走 portfolio。P0 审计修过的口径:brokerage 也算投资。
  const isLiabAcct = (a: BankAccount) => ['credit', 'loan'].includes((a.type || '').toLowerCase());
  const isInvestAcct = (a: BankAccount) => ['investment', 'brokerage'].includes((a.type || '').toLowerCase());
  const depositAccts = accounts.filter((a) => !isLiabAcct(a) && !isInvestAcct(a));
  const liabAccts = accounts.filter(isLiabAcct);
  const monthLabel = (m: string) => (dict === 'en'
    ? new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`);
  return (
    <>
      {(
        accounts.length === 0 ? (
          <p className="nesio-insights-option-hint nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没有账户信息。到「设置 → 数据接入」点银行「同步」一次,就会拉到你的卡/账户(余额、消费、退款分卡显示)。', 'No account info yet. Tap Sync on the bank connector once (Settings → Data sources) to pull your cards/accounts (per-card balance, spend, refunds).')}</p>
        ) : (() => {
          const s = assetSummary(accounts);
          const fmtGain = (g: number) => (g >= 0 ? `+${formatMoney(g)}` : `-${formatMoney(-g)}`);
          const gainColor = (g: number) => (g >= 0 ? 'var(--status-go)' : 'var(--status-gentle)');
          const invIncome = incomeBreakdown(txs, ym).filter((x) => x.detail === 'INCOME_DIVIDENDS' || x.detail === 'INCOME_INTEREST_EARNED');
          const invIncomeTotal = invIncome.reduce((n, x) => n + x.total, 0);
          // 一行账户:logo + 名字 + 类型/本月消费(负债:类型/额度利用)+ 余额 + 移除
          const acctRow = (a: BankAccount, liability: boolean) => {
            const m = accountMonth(txs, a.id, ym);
            const tl = accountTypeLabel(a);
            const isCredit = (a.type || '').toLowerCase() === 'credit';
            const util = isCredit && a.balance != null && (a.limit ?? 0) > 0 ? `${Math.round((Math.max(0, a.balance) / (a.limit as number)) * 100)}%` : '';
            const sub = liability
              ? [L(dict, tl[0], tl[1]), util ? L(dict, `已用 ${util}`, `${util} used`) : ''].filter(Boolean).join(' · ')
              : [L(dict, tl[0], tl[1]), m.count > 0 ? L(dict, `本月 -${formatMoney(m.spend, a.currency)}`, `this mo -${formatMoney(m.spend, a.currency)}`) : ''].filter(Boolean).join(' · ');
            const bal = a.balance != null ? (liability ? `-${formatMoney(a.balance, a.currency)}` : formatMoney(a.balance, a.currency)) : '';
            return (
              <div key={a.id} className="nesio-fin-acctrow">
                <AcctLogo a={a} size={20} />
                <div className="nesio-fin-acctrow-body">
                  <span className="nesio-fin-acctrow-name">{a.name}{a.mask ? ` ····${a.mask}` : ''}</span>
                  {sub && <span className="nesio-fin-acctrow-sub">{sub}</span>}
                </div>
                <span className={`nesio-fin-acctrow-bal${liability ? ' is-neg' : ''}`}>{bal}</span>
                <button type="button" className="nesio-fin-rule-x" onClick={() => { removeBankAccount(a.id); onChanged(); }} aria-label={L(dict, '移除此账户(重复或失效副本;仍连接的账户同步时会回来)', 'Remove this account (duplicates/stale; still-linked accounts return on sync)')}>✕</button>
              </div>
            );
          };
          return (
            <>
              {/* 净资产 hero(黑卡)*/}
              {!(s.deposits === 0 && s.investments === 0 && s.creditOwed === 0 && s.loanOwed === 0) && (
                <div className="nesio-fin-networth">
                  <span className="nesio-fin-networth-l">{L(dict, '净资产', 'Net worth')}</span>
                  <span className="nesio-fin-networth-v">{s.net < 0 ? `-${formatMoney(-s.net)}` : formatMoney(s.net)}</span>
                  <span className="nesio-fin-networth-sub">{L(dict, `存款 ${formatMoney(s.deposits)}`, `Cash ${formatMoney(s.deposits)}`)}{s.investments > 0 ? ` · ${L(dict, `投资 ${formatMoney(s.investments)}`, `Investments ${formatMoney(s.investments)}`)}` : ''}</span>
                </div>
              )}

              {/* 存款 */}
              {depositAccts.length > 0 && (<>
                <p className="nesio-fin-group-h">{L(dict, '存款', 'Cash')}</p>
                <div className="nesio-fin-acctgroup">{depositAccts.map((a) => acctRow(a, false))}</div>
              </>)}

              {/* 投资(portfolio)*/}
              {portfolio && (<>
                <p className="nesio-fin-group-h">{L(dict, '投资', 'Investing')}</p>
                <div className="nesio-fin-assets">
                  <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '总市值', 'Market value')}</span>{formatMoney(portfolio.totalValue)}</span>
                  {portfolio.gain !== null && (
                    <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '浮动盈亏', 'Unrealized')}</span><span style={{ color: gainColor(portfolio.gain) }}>{fmtGain(portfolio.gain)}{portfolio.gainPct !== null ? ` (${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}</span></span>
                  )}
                  <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '持仓', 'Positions')}</span>{portfolio.positions.length}</span>
                </div>
                {(() => {
                  // 现金观察(用户定持仓透视三件套之三;纯统计,只观察不建议):
                  // 现金 = 存款账户正余额 + 组合内现金类;资产 = 现金 + 非现金持仓市值。
                  const depositCash = depositAccts.reduce((sum, a) => sum + (typeof a.balance === 'number' && a.balance > 0 ? a.balance : 0), 0);
                  const portfolioCash = portfolio.byType.filter((x) => x.label === '现金').reduce((sum, x) => sum + x.value, 0);
                  const cash = depositCash + portfolioCash;
                  const assets = cash + (portfolio.totalValue - portfolioCash);
                  if (!(assets > 0) || cash <= 0) return null;
                  const pct = Math.round((cash / assets) * 100);
                  return (
                    <p className="nesio-fin-score-hint" style={{ marginTop: '0.6rem' }}>
                      {L(dict,
                        `现金 ${formatMoney(cash)},占可见资产的 ${pct}%。${pct >= 35 ? '如果这是刻意留的安全垫,很好;如果只是没顾上,它正在被通胀慢慢磨。' : ''}`,
                        `Cash ${formatMoney(cash)} — ${pct}% of visible assets.${pct >= 35 ? " If it's a deliberate cushion, great; if it just piled up, inflation is quietly grinding it." : ''}`)}
                    </p>
                  );
                })()}
                {portfolio.concentrated && (
                  <p className="nesio-fin-score-hint" style={{ marginTop: '0.6rem' }}>{L(dict,
                    `${portfolio.concentrated.ticker || portfolio.concentrated.name} 占了组合的 ${portfolio.concentrated.pct}% —— 集中不是错,只是波动会更贴着这一只走;有空可以想想要不要分散一点。`,
                    `${portfolio.concentrated.ticker || portfolio.concentrated.name} is ${portfolio.concentrated.pct}% of the portfolio — concentration isn't wrong, but volatility will track this one closely; worth thinking about when you have a moment.`)}</p>
                )}
                <p className="nesio-settings-section-label" style={{ marginTop: '0.8rem' }}>{L(dict, '组合结构', 'Allocation')}</p>
                <div className="nesio-fin-cats">
                  {portfolio.byType.map((x) => (
                    <div key={x.label} className="nesio-fin-cat">
                      <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{x.label}</span><span className="nesio-fin-cat-amt">{formatMoney(x.value)} · {x.pct}%</span></div>
                      <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.min(100, x.pct)}%` }} /></div>
                    </div>
                  ))}
                </div>
                <div className="nesio-fin-recurlist" style={{ marginTop: '0.6rem' }}>
                  {portfolio.positions.map((p) => (
                    <div key={`${p.ticker || p.name}`} className="nesio-fin-recur">
                      <div className="nesio-fin-recur-main">
                        <span className="nesio-fin-recur-name">{p.ticker ? `${p.ticker} · ` : ''}{p.name}</span>
                        <span className="nesio-fin-recur-meta">{p.typeLabel} · {L(dict, `${p.quantity} 份`, `${p.quantity} sh`)} · {p.pct}%</span>
                      </div>
                      <span className="nesio-fin-recur-amt" style={{ textAlign: 'right' }}>{formatMoney(p.value)}{p.gain !== null && <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: gainColor(p.gain) }}>{fmtGain(p.gain)}</span>}</span>
                    </div>
                  ))}
                </div>
                {invIncomeTotal > 0 && (
                  <p className="nesio-fin-score-hint" style={{ marginTop: '0.6rem' }}>{L(dict,
                    `${monthLabel(ym)} 投资收益 ${formatMoney(invIncomeTotal)}`,
                    `${monthLabel(ym)} investment income ${formatMoney(invIncomeTotal)}`)}</p>
                )}
              </>)}

              {/* 负债 */}
              {liabAccts.length > 0 && (<>
                <p className="nesio-fin-group-h">{L(dict, '负债', 'Liabilities')}</p>
                <div className="nesio-fin-acctgroup">{liabAccts.map((a) => acctRow(a, true))}</div>
              </>)}

              <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '重复 / 失效副本可移除;移除后其本机交易也会在下次同步时清掉(仍连接的账户会连数据一起回来)。', 'Duplicate / stale copies can be removed; their local transactions are also cleared on next sync (still-linked accounts return with data).')}</p>
            </>
          );
        })()
      )}
      {/* P1:手动资产(与 Plaid 账户同页同列,不设独立手动账本)—— 锚点估值,「+」也能进 */}
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '手动资产 · 锚点估值', 'Manual assets · anchored values')}</p>
          {manualAssets.length === 0
            ? <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '房、车、现金、加密…银行拍不到的,点「+ 记一笔 → 资产·估值」记进来,一起进净值。', 'Home, car, cash, crypto — add via “+ Add → Asset” and they join your net worth.')}</p>
            : (() => {
              const allExpenses = loadDomainExpenses(); // P2 持有成本归集(税金/维修,当年)
              // 渠道余额按记账推算(锚点=盘点复位点);仍为 0 且无历史的渠道不占行
              const shown = manualAssets.filter((a) => !a.isChannel || channelBalance(a, allExpenses) !== 0 || a.anchors.length > 1);
              return shown.map((a: ManualAsset) => {
              const latest = a.anchors[0];
              const staleDays = latest ? Math.floor((Date.now() - new Date(`${latest.date}T00:00:00`).getTime()) / 86400000) : 0;
              const dep = assetDepreciation(a);
              const costs = assetHoldingCosts(a.id, allExpenses);
              const costBits = [
                dep > 0 ? L(dict, `折旧 -${formatMoney(dep, currency)}`, `depr. -${formatMoney(dep, currency)}`) : '',
                costs.total > 0 ? L(dict, `今年持有 ${formatMoney(costs.total, currency)}(税金 ${formatMoney(costs.tax, currency)} · 维修 ${formatMoney(costs.repair, currency)})`, `holding ${formatMoney(costs.total, currency)} YTD (tax ${formatMoney(costs.tax, currency)} · repair ${formatMoney(costs.repair, currency)})`) : '',
              ].filter(Boolean).join(' · ');
              return (
                <div key={a.id} className="nesio-fin-acctrow">
                  <div className="nesio-fin-acctrow-body">
                    <span className="nesio-fin-acctrow-name">{a.name}</span>
                    <span className="nesio-fin-acctrow-sub">
                      {latest ? L(dict, `锚点 ${latest.date}${latest.note ? ` · ${latest.note}` : ''}`, `anchor ${latest.date}${latest.note ? ` · ${latest.note}` : ''}`) : ''}
                      {staleDays > 90 ? L(dict, ' · 该盘点了', ' · time to recount') : ''}
                    </span>
                    {costBits && <span className="nesio-fin-acctrow-sub">{costBits}</span>}
                  </div>
                  <span className={`nesio-fin-acctrow-bal${a.classification === 'liability' ? ' is-neg' : ''}`}>
                    {a.classification === 'liability' ? '-' : ''}{formatMoney(a.isChannel ? channelBalance(a, allExpenses) : assetCurrentValue(a), currency)}
                  </span>
                  <button type="button" className="nesio-fin-monthnav" style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-accent)' }}
                    onClick={() => onQuickAddAsset(a.id)}>{L(dict, '更新', 'Update')}</button>
                  <button type="button" className="nesio-fin-rule-x" aria-label={L(dict, '移除此资产(锚点历史一并删除)', 'Remove this asset (anchors deleted too)')}
                    onClick={() => { removeManualAsset(a.id); recordNetWorthSnapshot(); onChanged(); }}>✕</button>
                </div>
              );
              });
            })()}
        </>
    </>
  );
}
