'use client';

/**
 * FinanceTab — 财务(批次 29)。洞察里独立 tab,放「时间线」后面。
 * 4 个子分类:总览 / 支出 / 交易 / 卡片。读本机 Plaid 流水(nesio-bank-tx-v1)。
 * 替代原来设置里的 SpendingSheet —— 用户要把支出分析放进洞察。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadBankTx, availableMonths, summarizeMonth, categoryBreakdown, topMerchants,
  formatMoney, ymOf, type BankTx,
} from '@/lib/portal/bank-tx';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'overview' | 'spending' | 'tx' | 'cards';

function monthLabel(ym: string, dict: string): string {
  const [y, m] = ym.split('-');
  return dict === 'en'
    ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : `${y} 年 ${Number(m)} 月`;
}

export default function FinanceTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [ym, setYm] = useState<string>(ymOf());
  const [sub, setSub] = useState<Sub>('overview');

  useEffect(() => {
    const loaded = loadBankTx();
    setTxs(loaded);
    const months = availableMonths(loaded);
    setYm(months[0] || ymOf());
  }, []);

  const months = useMemo(() => availableMonths(txs), [txs]);
  const summary = useMemo(() => summarizeMonth(txs, ym), [txs, ym]);
  const cats = useMemo(() => categoryBreakdown(txs, ym), [txs, ym]);
  const merchants = useMemo(() => topMerchants(txs, ym, 6), [txs, ym]);
  const monthTx = useMemo(() => txs.filter((t) => (t.date || '').slice(0, 7) === ym).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [txs, ym]);

  if (txs.length === 0) {
    return (
      <p className="nesio-insights-empty">
        {L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」。', 'No bank transactions yet. Go to Settings → Data sources → Bank feed · Plaid, connect and tap Sync.')}
      </p>
    );
  }

  // ±:正数=支出显示 -$,负数=退款/进账显示 +$(贴近银行账单读感)
  const signed = (amount: number) => (amount >= 0 ? `-${formatMoney(amount, summary.currency)}` : `+${formatMoney(-amount, summary.currency)}`);

  const idx = months.indexOf(ym);
  const SUBS: Array<[Sub, string, string]> = [['overview', '总览', 'Overview'], ['spending', '支出', 'Spending'], ['tx', '交易', 'Transactions'], ['cards', '卡片', 'Cards']];

  return (
    <div className="nesio-analytics-tab">
      {/* 月份切换 */}
      {months.length > 1 && (
        <div className="nesio-fin-monthbar">
          <button type="button" className="nesio-fin-monthnav" disabled={idx >= months.length - 1} onClick={() => setYm(months[idx + 1])} aria-label={L(dict, '上一月', 'Previous month')}>‹</button>
          <span className="nesio-fin-month">{monthLabel(ym, dict)}</span>
          <button type="button" className="nesio-fin-monthnav" disabled={idx <= 0} onClick={() => setYm(months[idx - 1])} aria-label={L(dict, '下一月', 'Next month')}>›</button>
        </div>
      )}

      {/* 子分类 */}
      <div className="nesio-fin-subtabs">
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>

      {/* 总览 */}
      {sub === 'overview' && (
        <>
          <div className="nesio-fin-net-card">
            <p className="nesio-fin-net-label">{L(dict, '本月净支出', 'Net spend this month')}</p>
            <p className="nesio-fin-net-value">{formatMoney(summary.net, summary.currency)}</p>
            <p className="nesio-fin-net-sub">{L(dict, `毛支出 ${formatMoney(summary.gross, summary.currency)} · 退款 ${formatMoney(summary.refunds, summary.currency)} · ${summary.count} 笔`, `Gross ${formatMoney(summary.gross, summary.currency)} · Refunds ${formatMoney(summary.refunds, summary.currency)} · ${summary.count} tx`)}</p>
          </div>
          {cats.length > 0 && (
            <>
              <p className="nesio-settings-section-label">{L(dict, '分类占比', 'By category')}</p>
              <div className="nesio-fin-cats">
                {cats.slice(0, 4).map((c) => (
                  <div key={c.category} className="nesio-fin-cat">
                    <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{c.category}</span><span className="nesio-fin-cat-amt">{formatMoney(c.total, summary.currency)}{c.deltaPct !== null && <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span>}</span></div>
                    <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
                  </div>
                ))}
              </div>
            </>
          )}
          {merchants.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '商户 Top', 'Top merchants')}</p>
              <div className="nesio-fin-merchants">
                {merchants.slice(0, 3).map((m) => (
                  <div key={m.name} className="nesio-fin-merchant"><span className="nesio-fin-merchant-name">{m.name}</span><span className="nesio-fin-merchant-right"><span className="nesio-fin-merchant-amt">{formatMoney(m.total, summary.currency)}</span><span className="nesio-fin-merchant-cnt">{L(dict, `${m.count} 笔`, `${m.count}×`)}</span></span></div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 支出:全部分类 + 商户 */}
      {sub === 'spending' && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '全部分类', 'All categories')}</p>
          <div className="nesio-fin-cats">
            {cats.map((c) => (
              <div key={c.category} className="nesio-fin-cat">
                <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{c.category}</span><span className="nesio-fin-cat-amt">{formatMoney(c.total, summary.currency)} <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}>{c.pct}%</span>{c.deltaPct !== null && <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span>}</span></div>
                <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '商户 Top', 'Top merchants')}</p>
          <div className="nesio-fin-merchants">
            {merchants.map((m) => (
              <div key={m.name} className="nesio-fin-merchant"><span className="nesio-fin-merchant-name">{m.name}</span><span className="nesio-fin-merchant-right"><span className="nesio-fin-merchant-amt">{formatMoney(m.total, summary.currency)}</span><span className="nesio-fin-merchant-cnt">{L(dict, `${m.count} 笔`, `${m.count}×`)}</span></span></div>
            ))}
          </div>
        </>
      )}

      {/* 交易:本月明细 */}
      {sub === 'tx' && (
        <div className="nesio-fin-txlist">
          {monthTx.map((t) => (
            <div key={t.id} className="nesio-fin-txrow">
              <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
              <div className="nesio-fin-txmid">
                <span className="nesio-fin-txname">{t.name || L(dict, '未知商户', 'Unknown')}</span>
                <span className="nesio-fin-txcat">{t.category || L(dict, '未分类', 'Uncategorized')}</span>
              </div>
              <span className={`nesio-fin-txamt${t.amount < 0 ? ' is-refund' : ''}`}>{signed(t.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 卡片:连接与账户概况(逐卡明细需 Plaid 账户数据,尚未同步) */}
      {sub === 'cards' && (
        <>
          <div className="nesio-fin-net-card">
            <p className="nesio-fin-net-label">{L(dict, '已连接银行', 'Connected bank')}</p>
            <p className="nesio-fin-net-value" style={{ fontSize: '1.3rem' }}>{L(dict, 'Plaid · 已连接', 'Plaid · Connected')}</p>
            <p className="nesio-fin-net-sub">{L(dict, `本机共 ${txs.length} 笔流水 · 币种 ${Array.from(new Set(txs.map((t) => (t.currency || 'USD').toUpperCase()))).join('/')}`, `${txs.length} tx on-device · ${Array.from(new Set(txs.map((t) => (t.currency || 'USD').toUpperCase()))).join('/')}`)}</p>
          </div>
          <p className="nesio-settings-option-hint">{L(dict, '逐张卡/账户的明细需要 Plaid 账户数据(目前只同步了交易流水)。到「设置 → 数据接入」点「+ 银行」可再连一家。', 'Per-card/account breakdown needs Plaid account data (only transactions are synced today). Use Settings → Data sources → “+ Bank” to link another.')}</p>
        </>
      )}

      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>{L(dict, '流水明细只存本机', 'Details stay on-device')}</p>
    </div>
  );
}
