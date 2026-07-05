'use client';

/**
 * SpendingSheet — 支出分析(批次 27,移植 finance repo 的支出分析视图)。
 *
 * 读本机 Plaid 流水(nesio-bank-tx-v1),算本月净支出 / 分类占比 / 商户 Top。
 * 这是「银行连了但记忆里看不到」的答案:给流水一个能看的地方,不往记忆图里灌 1000 条。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadBankTx,
  availableMonths,
  summarizeMonth,
  categoryBreakdown,
  topMerchants,
  formatMoney,
  ymOf,
  type BankTx,
} from '@/lib/portal/bank-tx';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

function monthLabel(ym: string, dict: string): string {
  const [y, m] = ym.split('-');
  return dict === 'en'
    ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : `${y} 年 ${Number(m)} 月`;
}

export default function SpendingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [ym, setYm] = useState<string>(ymOf());

  useEffect(() => {
    if (!open) return;
    const loaded = loadBankTx();
    setTxs(loaded);
    const months = availableMonths(loaded);
    setYm(months[0] || ymOf());
  }, [open]);

  const months = useMemo(() => availableMonths(txs), [txs]);
  const summary = useMemo(() => summarizeMonth(txs, ym), [txs, ym]);
  const cats = useMemo(() => categoryBreakdown(txs, ym), [txs, ym]);
  const merchants = useMemo(() => topMerchants(txs, ym, 5), [txs, ym]);

  if (!open) return null;

  const idx = months.indexOf(ym);
  const canPrev = idx >= 0 && idx < months.length - 1; // months 从新到旧
  const canNext = idx > 0;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '支出分析', 'Spending')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '支出分析', 'Spending')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>

        <div className="nesio-settings-sheet-body">
          {txs.length === 0 ? (
            <p className="nesio-settings-option-hint">
              {L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」。', 'No bank transactions yet. Go to Settings → Data sources → Bank feed · Plaid, connect and tap Sync.')}
            </p>
          ) : (
            <>
              {/* 月份切换 */}
              {months.length > 1 && (
                <div className="nesio-fin-monthbar">
                  <button type="button" className="nesio-fin-monthnav" disabled={!canPrev} onClick={() => canPrev && setYm(months[idx + 1])} aria-label={L(dict, '上一月', 'Previous month')}>‹</button>
                  <span className="nesio-fin-month">{monthLabel(ym, dict)}</span>
                  <button type="button" className="nesio-fin-monthnav" disabled={!canNext} onClick={() => canNext && setYm(months[idx - 1])} aria-label={L(dict, '下一月', 'Next month')}>›</button>
                </div>
              )}

              {/* 净支出卡 */}
              <div className="nesio-fin-net-card">
                <p className="nesio-fin-net-label">{L(dict, '本月净支出', 'Net spend this month')}</p>
                <p className="nesio-fin-net-value">{formatMoney(summary.net, summary.currency)}</p>
                <p className="nesio-fin-net-sub">
                  {L(dict, `毛支出 ${formatMoney(summary.gross, summary.currency)} · 退款 ${formatMoney(summary.refunds, summary.currency)} · ${summary.count} 笔`,
                    `Gross ${formatMoney(summary.gross, summary.currency)} · Refunds ${formatMoney(summary.refunds, summary.currency)} · ${summary.count} tx`)}
                </p>
              </div>

              {/* 分类占比 */}
              {cats.length > 0 && (
                <>
                  <p className="nesio-settings-section-label">{L(dict, '分类占比', 'By category')}</p>
                  <div className="nesio-fin-cats">
                    {cats.map((c) => (
                      <div key={c.category} className="nesio-fin-cat">
                        <div className="nesio-fin-cat-top">
                          <span className="nesio-fin-cat-name">{c.category}</span>
                          <span className="nesio-fin-cat-amt">
                            {formatMoney(c.total, summary.currency)}
                            {c.deltaPct !== null && (
                              <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span>
                            )}
                          </span>
                        </div>
                        <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 商户 Top */}
              {merchants.length > 0 && (
                <>
                  <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '商户 Top', 'Top merchants')}</p>
                  <div className="nesio-fin-merchants">
                    {merchants.map((m) => (
                      <div key={m.name} className="nesio-fin-merchant">
                        <span className="nesio-fin-merchant-name">{m.name}</span>
                        <span className="nesio-fin-merchant-right">
                          <span className="nesio-fin-merchant-amt">{formatMoney(m.total, summary.currency)}</span>
                          <span className="nesio-fin-merchant-cnt">{L(dict, `${m.count} 笔`, `${m.count}×`)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
                {L(dict, '流水明细只存本机 · 正数为支出、负数为退款/进账', 'Details stay on-device · positive = spend, negative = refund/income')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
