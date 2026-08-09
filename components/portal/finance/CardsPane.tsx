'use client';

/**
 * CardsPane — 账户页(P3 拆分自 FinanceTab):Plaid 账户分组 + 手动资产。
 * bug2 批:净资产 hero / 投资小结 / 组合结构 / 持仓明细移出本页(总览 & 投资页);
 * 账户行支持自定义名称、去掉行尾 ✕、点一下进入账户详情页(改名 / 本月明细 / 移除);
 * fidelity 等投资账户也显示在资产卡列表(属于资产);底部说明文字删除。
 */

import { useState } from 'react';
import {
  accountMonth, accountTypeLabel, formatMoney, removeBankAccount,
  loadAccountNames, setAccountName, displayAccountName,
  txFlow, TX_FLOW_LABELS, effectiveCategory, addManualBankAccount, isManualBankAccount,
  type BankTx, type BankAccount, type Holding,
} from '@/lib/portal/bank-tx';
import { categoryLabel, categoryDetailLabel } from '@/lib/portal/tx-category';
import {
  assetCurrentValue, assetDepreciation, assetHoldingCosts, channelBalance, removeManualAsset, recordNetWorthSnapshot,
  type ManualAsset,
} from '@/lib/portal/finance-assets';
import { loadDomainExpenses } from '@/lib/portal/finance-sources';
import { L } from '@/lib/portal/i18n';
import AcctLogo from './AcctLogo';
import { IconCheck } from '../icons';
import NesioSheet from '../ui/NesioSheet';

export default function CardsPane({ txs, accounts, holdings, manualAssets, ym, currency, dict, onQuickAddAsset, onChanged }: {
  txs: BankTx[]; accounts: BankAccount[]; holdings: Holding[]; manualAssets: ManualAsset[];
  ym: string; currency: string; dict: string; onQuickAddAsset: (assetId?: string) => void; onChanged: () => void;
}) {
  // 账户详情页(点行进入):改名 / 本月消费明细 / 移除
  const [detailId, setDetailId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  // bug3:「点击动作完成后页面没有消失,也看不出来是否成功,其实成功了」——
  // 保存后给一句明确回执(2 秒后自己消失),按钮本身改成对勾图标。
  const [nameSaved, setNameSaved] = useState(false);
  // 手工添加账户(记一笔可挂到此户并进交易页)
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<'depository' | 'credit' | 'loan' | 'investment' | 'other'>('depository');
  const [addMask, setAddMask] = useState('');
  const [addErr, setAddErr] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const names = loadAccountNames();
  const isLiabAcct = (a: BankAccount) => ['credit', 'loan'].includes((a.type || '').toLowerCase());
  const isInvestAcct = (a: BankAccount) => ['investment', 'brokerage'].includes((a.type || '').toLowerCase());
  const depositAccts = accounts.filter((a) => !isLiabAcct(a) && !isInvestAcct(a));
  const investAccts = accounts.filter(isInvestAcct);
  const liabAccts = accounts.filter(isLiabAcct);
  // 投资账户无 balance 时用该账户持仓市值兜底
  const investBal = (a: BankAccount) => (a.balance != null ? a.balance : holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.value, 0));

  // 一行账户:logo + 自定义名 + 类型/本月消费(负债:额度利用)+ 余额;点行进详情(bug2:去 ✕)
  const acctRow = (a: BankAccount, group: 'deposit' | 'invest' | 'liability') => {
    const m = accountMonth(txs, a.id, ym);
    const tl = accountTypeLabel(a);
    const isCredit = (a.type || '').toLowerCase() === 'credit';
    const util = isCredit && a.balance != null && (a.limit ?? 0) > 0 ? `${Math.round((Math.max(0, a.balance) / (a.limit as number)) * 100)}%` : '';
    const sub = group === 'liability'
      ? [L(dict, tl[0], tl[1]), util ? L(dict, `已用 ${util}`, `${util} used`) : ''].filter(Boolean).join(' · ')
      : [L(dict, tl[0], tl[1]), m.count > 0 ? L(dict, `本月 -${formatMoney(m.spend, a.currency)}`, `this mo -${formatMoney(m.spend, a.currency)}`) : ''].filter(Boolean).join(' · ');
    const rawBal = group === 'invest' ? investBal(a) : a.balance;
    const bal = rawBal != null ? (group === 'liability' ? `-${formatMoney(rawBal, a.currency)}` : formatMoney(rawBal, a.currency)) : '';
    return (
      <button key={a.id} type="button" className="nesio-fin-acctrow"
        style={{ border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent', fontFamily: 'var(--font-sans)' }}
        onClick={() => { setDetailId(a.id); setNameDraft(names[a.id] || ''); }}>
        <AcctLogo a={a} size={20} />
        <div className="nesio-fin-acctrow-body">
          <span className="nesio-fin-acctrow-name">{displayAccountName(a, names)}{a.mask ? ` ····${a.mask}` : ''}</span>
          {sub && <span className="nesio-fin-acctrow-sub">{sub}</span>}
        </div>
        <span className={`nesio-fin-acctrow-bal${group === 'liability' ? ' is-neg' : ''}`}>{bal}</span>
        <span aria-hidden style={{ color: 'var(--portal-muted)', marginLeft: 4 }}>›</span>
      </button>
    );
  };

  const detailAcct = detailId ? accounts.find((a) => a.id === detailId) || null : null;
  const detailTxs = detailAcct
    ? txs.filter((t) => t.accountId === detailAcct.id && (t.date || '').slice(0, 7) === ym).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)
    : [];

  const submitManual = () => {
    setAddErr('');
    setAddBusy(true);
    try {
      const a = addManualBankAccount({ name: addName, type: addType, ...(addMask.trim() ? { mask: addMask } : {}) });
      if (!a) { setAddErr(L(dict, '给账户起个名字。', 'Name the account first.')); return; }
      setAddName(''); setAddMask(''); setAddOpen(false); onChanged();
    } finally { setAddBusy(false); }
  };

  return (
    <>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className="nesio-fin-review-accept" onClick={() => { setAddOpen((v) => !v); setAddErr(''); }}>
          {L(dict, '＋ 手工添加账户', '+ Add account manually')}
        </button>
        {addOpen && (
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 8, padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
              {L(dict, '记一笔时可选这个账户,流水会出现在交易页(与银行同步账户分开存,不会被同步抹掉)。', 'Pick this account in Quick Add — entries show on Transactions and survive bank sync.')}
            </p>
            <input value={addName} onChange={(e) => setAddName(e.target.value)}
              placeholder={L(dict, '账户名(例:现金钱包)', 'Name (e.g. Cash wallet)')}
              style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--text-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }} />
            <select className="nesio-fin-select" value={addType} onChange={(e) => setAddType(e.target.value as typeof addType)} aria-label={L(dict, '账户类型', 'Account type')}>
              <option value="depository">{L(dict, '存款 / 现金', 'Cash / deposit')}</option>
              <option value="credit">{L(dict, '信用卡', 'Credit card')}</option>
              <option value="loan">{L(dict, '贷款', 'Loan')}</option>
              <option value="investment">{L(dict, '投资', 'Investment')}</option>
              <option value="other">{L(dict, '其他', 'Other')}</option>
            </select>
            <input value={addMask} onChange={(e) => setAddMask(e.target.value)}
              placeholder={L(dict, '尾号(可空)', 'Last 4 (optional)')}
              inputMode="numeric" maxLength={4}
              style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--text-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }} />
            {addErr && <p role="alert" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--status-risk)' }}>{addErr}</p>}
            <button type="button" className="nesio-fin-review-accept" disabled={addBusy} onClick={submitManual}>
              {addBusy ? L(dict, '保存中…', 'Saving…') : L(dict, '保存账户', 'Save account')}
            </button>
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <p className="nesio-insights-option-hint nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没有银行账户。可先手工添加,或到「设置 → 数据接入」点银行「同步」。', 'No bank accounts yet. Add one manually above, or sync the bank connector (Settings → Data sources).')}</p>
      ) : (
        <>
          {depositAccts.length > 0 && (<>
            <p className="nesio-fin-group-h">{L(dict, '存款', 'Cash')}</p>
            <div className="nesio-fin-acctgroup">{depositAccts.map((a) => acctRow(a, 'deposit'))}</div>
          </>)}

          {/* bug2:投资账户(fidelity 等)也属于资产,进资产卡列表;明细在「投资」页 */}
          {investAccts.length > 0 && (<>
            <p className="nesio-fin-group-h">{L(dict, '投资', 'Investing')}</p>
            <div className="nesio-fin-acctgroup">{investAccts.map((a) => acctRow(a, 'invest'))}</div>
          </>)}

          {liabAccts.length > 0 && (<>
            <p className="nesio-fin-group-h">{L(dict, '负债', 'Liabilities')}</p>
            <div className="nesio-fin-acctgroup">{liabAccts.map((a) => acctRow(a, 'liability'))}</div>
          </>)}
        </>
      )}

      {/* 手动资产(与 Plaid 账户同页同列;bug2:说明文字删除,只留数据行) */}
      {manualAssets.length > 0 && (() => {
        const allExpenses = loadDomainExpenses(); // P2 持有成本归集(税金/维修,当年)
        const shown = manualAssets.filter((a) => !a.isChannel || channelBalance(a, allExpenses) !== 0 || a.anchors.length > 1);
        if (!shown.length) return null;
        return (
          <div style={{ marginTop: 'var(--space-4)' }}>
            {shown.map((a: ManualAsset) => {
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
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 账户详情页:自定义名称 / 本月明细 / 移除 */}
      <NesioSheet variant="bottom" open={detailAcct != null} onOpenChange={(o) => { if (!o) setDetailId(null); }} ariaLabel={L(dict, '账户详情', 'Account detail')}>
        {detailAcct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-h3)', fontWeight: 700 }}>
              <AcctLogo a={detailAcct} size={22} />
              {displayAccountName(detailAcct, names)}{detailAcct.mask ? ` ····${detailAcct.mask}` : ''}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
              {detailAcct.institution ? `${detailAcct.institution} · ` : ''}{L(dict, accountTypeLabel(detailAcct)[0], accountTypeLabel(detailAcct)[1])}
              {detailAcct.balance != null ? ` · ${formatMoney(detailAcct.balance, detailAcct.currency)}` : ''}
            </p>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '自定义名称', 'Custom name')}</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={nameDraft} onChange={(e) => { setNameDraft(e.target.value); setNameSaved(false); }} placeholder={detailAcct.name}
                  style={{ flex: 1, border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--text-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }} />
                {/* bug3:「保存」两个字换成对勾 */}
                <button type="button" className="nesio-fin-review-accept" aria-label={L(dict, '保存名称', 'Save name')}
                  onClick={() => { setAccountName(detailAcct.id, nameDraft); setNameSaved(true); onChanged(); window.setTimeout(() => setNameSaved(false), 2000); }}>
                  <IconCheck size={15} />
                </button>
              </div>
              {nameSaved && (
                <p role="status" style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>
                  {L(dict, '✓ 改好了', '✓ Saved')}
                </p>
              )}
            </div>
            {detailTxs.length > 0 && (
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '本月明细', 'This month')}</p>
                <div className="nesio-fin-txlist" style={{ maxHeight: '38vh', overflowY: 'auto' }}>
                  {detailTxs.map((t) => {
                    const f = txFlow(t);
                    const primary = categoryLabel(effectiveCategory(t), dict) || L(dict, '待归类', 'Uncategorized');
                    const detail = categoryDetailLabel(t.categoryDetail || '', dict);
                    return (
                    <div key={t.id} className="nesio-fin-txrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
                        <span className={`nesio-fin-txflow nesio-fin-txflow--${f}`}>
                          <span className="nesio-fin-txflow-l">{L(dict, TX_FLOW_LABELS[f][0], TX_FLOW_LABELS[f][1])}</span>
                          {f === 'expense' && detail && detail !== primary && (
                            <span className="nesio-fin-txcat"> · {primary} · {detail}</span>
                          )}
                          {f === 'expense' && (!detail || detail === primary) && (
                            <span className="nesio-fin-txcat"> · {primary}</span>
                          )}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="nesio-fin-txname" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                        <span className={`nesio-fin-txamt${t.amount < 0 ? ' is-refund' : ''}`}>{t.amount >= 0 ? `-${formatMoney(t.amount, t.currency)}` : `+${formatMoney(-t.amount, t.currency)}`}</span>
                      </div>
                      {t.city && (
                        <span className="nesio-fin-txfoot" style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t.city}</span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* bug3:底部这行字改红色 —— 它是破坏性动作,不该和普通选项一个颜色 */}
            <button type="button" className="nesio-fin-flowopt" style={{ color: 'var(--status-risk)' }}
              onClick={() => { removeBankAccount(detailAcct.id); setDetailId(null); onChanged(); }}>
              {isManualBankAccount(detailAcct)
                ? L(dict, '删除此手工账户', 'Delete this manual account')
                : L(dict, '移除此账户(仍连接的账户同步时会回来)', 'Remove account (returns on next sync if still linked)')}
            </button>
          </div>
        )}
      </NesioSheet>
    </>
  );
}
