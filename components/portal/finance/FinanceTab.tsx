'use client';

/**
 * FinanceTab — 财务(批次 29,批次 31 增强)。洞察里「财务」tab。
 * 子分类:总览(KPI + 风险预警 + 月度趋势)/ 支出(分类+商户)/ 交易(筛选+规则审核)/ 卡片(分卡)。
 * 读本机 Plaid 流水(nesio-bank-tx-v1)+ 账户(nesio-bank-accounts-v1)。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadBankTx, loadBankAccounts, availableMonths, summarizeMonth, categoryBreakdown, topMerchants,
  monthlyTrend, needsReview, suggestCategory, setMerchantRule, effectiveCategory,
  accountMonth, formatMoney, ymOf, prevYm, txFlow, setFlowRule, TX_FLOW_LABELS,
  detectRecurring, upcomingRecurring, loadMerchantRules, loadFlowRules, setRecurRule,
  loadBankSyncedAt, excludedTxCount,
  type BankTx, type BankAccount, type TxFlow,
} from '@/lib/portal/bank-tx';
// 风险预警与 Today/问一问 同读一份判定(financeFindings,Layer1 漂移收口)——此前 bank-tx 里
// 另有一套 alerts 判定(函数级双实现),两个输出面据同一份流水各说各话,已删并由契约钉死不回潮。
import { financeFindings } from '@/lib/portal/finance-insight';
import { categoryLabel, COMMON_EXPENSE_CATEGORIES } from '@/lib/portal/tx-category';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'overview' | 'spending' | 'tx' | 'recurring' | 'cards';

function monthLabel(ym: string, dict: string): string {
  const [y, m] = ym.split('-');
  return dict === 'en'
    ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : `${y} 年 ${Number(m)} 月`;
}

// 批次 40:分类支出环形图(纯 SVG,无依赖)
const DONUT_COLORS = ['#588ce3', '#e0954a', '#3d9f6e', '#c98a2d', '#7c6ee6', '#c25d7a', '#2f9d8f', '#9aa7b8'];
function FinanceDonut({ slices, centerTop, centerVal }: { slices: Array<{ category: string; pct: number }>; centerTop: string; centerVal: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" width="132" height="132" style={{ display: 'block', margin: '0 auto' }}>
      <g transform="translate(70,70) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--portal-line)" strokeWidth="14" />
        {slices.slice(0, 8).map((s, i) => {
          const len = (s.pct / 100) * C;
          const seg = <circle key={s.category} r={R} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth="14" strokeLinecap="butt" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
          acc += len;
          return seg;
        })}
      </g>
      <text x="70" y="65" textAnchor="middle" fontSize="8.5" fill="var(--portal-muted)">{centerTop}</text>
      <text x="70" y="82" textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--portal-ink)">{centerVal}</text>
    </svg>
  );
}

export default function FinanceTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [ym, setYm] = useState<string>(ymOf());
  const [sub, setSub] = useState<Sub>('overview');
  const [filter, setFilter] = useState<string>('all');
  const [acctFilter, setAcctFilter] = useState<string>('all'); // 批次 40:按卡筛选
  const [rev, setRev] = useState(0); // 规则改动后强制重算
  const [flowEditId, setFlowEditId] = useState<string | null>(null);

  useEffect(() => {
    const reload = () => {
      const loaded = loadBankTx();
      setTxs(loaded);
      setAccounts(loadBankAccounts());
      const av = availableMonths(loaded);
      if (av.length) setYm((cur) => (av.includes(cur) ? cur : av[0])); // 不覆盖用户已选月份
    };
    reload();
    // 数据搬 IDB 后:水合完成/同步后派发 nesio-bank-updated → 重读(冷启动空窗自愈)。
    window.addEventListener('nesio-bank-updated', reload);
    return () => window.removeEventListener('nesio-bank-updated', reload);
  }, []);

  const months = useMemo(() => availableMonths(txs), [txs]);
  const summary = useMemo(() => summarizeMonth(txs, ym), [txs, ym]);
  const prevSummary = useMemo(() => summarizeMonth(txs, prevYm(ym)), [txs, ym]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cats = useMemo(() => categoryBreakdown(txs, ym), [txs, ym, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const merchants = useMemo(() => topMerchants(txs, ym, 6), [txs, ym, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const findings = useMemo(() => financeFindings(txs, accounts, ym), [txs, accounts, ym, rev]);
  const trend = useMemo(() => monthlyTrend(txs, 6), [txs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const review = useMemo(() => needsReview(txs, ym), [txs, ym, rev]);
  const monthTx = useMemo(() => txs.filter((t) => (t.date || '').slice(0, 7) === ym).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [txs, ym]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recurring = useMemo(() => detectRecurring(txs), [txs, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => upcomingRecurring(txs, 7), [txs, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learnedRules = useMemo(() => ({ merchant: loadMerchantRules(), flow: loadFlowRules() }), [rev]);

  if (txs.length === 0) {
    return <p className="nesio-insights-empty">{L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」。', 'No bank transactions yet. Go to Settings → Data sources → Bank feed · Plaid, connect and Sync.')}</p>;
  }

  const signed = (a: number) => (a >= 0 ? `-${formatMoney(a, summary.currency)}` : `+${formatMoney(-a, summary.currency)}`);
  const netDelta = prevSummary.net > 0 ? Math.round(((summary.net - prevSummary.net) / prevSummary.net) * 100) : null;
  const idx = months.indexOf(ym);
  const SUBS: Array<[Sub, string, string]> = [['overview', '总览', 'Overview'], ['tx', '交易', 'Transactions'], ['recurring', '定期', 'Recurring'], ['cards', '账户', 'Accounts']];
  function markNotRecurring(name: string) { setRecurRule(name, 'no'); setRev((r) => r + 1); }
  function removeMerchantRule(name: string) { setMerchantRule(name, ''); setRev((r) => r + 1); }
  function removeFlowRule(name: string) { setFlowRule(name, ''); setRev((r) => r + 1); }
  const filterCats = ['all', ...cats.slice(0, 6).map((c) => c.category)];
  const shownTx = monthTx
    .filter((t) => filter === 'all' || effectiveCategory(t) === filter)
    .filter((t) => acctFilter === 'all' || t.accountId === acctFilter);
  // 批次 40:交易行显示卡后四位(accountId → account.mask)
  const acctMask = new Map(accounts.map((a) => [a.id, a.mask]));

  function resolveReview(name: string, category: string) { setMerchantRule(name, category); setRev((r) => r + 1); }
  function applyFlow(name: string, flow: TxFlow) { setFlowRule(name, flow); setFlowEditId(null); setRev((r) => r + 1); }

  return (
    <div className="nesio-analytics-tab">
      {months.length > 1 && (
        <div className="nesio-fin-monthbar">
          <button type="button" className="nesio-fin-monthnav" disabled={idx >= months.length - 1} onClick={() => setYm(months[idx + 1])} aria-label={L(dict, '上一月', 'Previous month')}>‹</button>
          <span className="nesio-fin-month">{monthLabel(ym, dict)}</span>
          <button type="button" className="nesio-fin-monthnav" disabled={idx <= 0} onClick={() => setYm(months[idx - 1])} aria-label={L(dict, '下一月', 'Next month')}>›</button>
        </div>
      )}

      <div className="nesio-fin-subtabs">
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>

      {/* ── 总览 ── */}
      {sub === 'overview' && (
        <>
          {/* 数据新鲜度 + 被排除的其他币种笔数(如实告知,不假装是最新完整月/全部交易) */}
          {(() => {
            const syncedAt = loadBankSyncedAt();
            const excluded = excludedTxCount(txs, ym);
            if (!syncedAt && !excluded) return null;
            const dateStr = syncedAt ? new Date(syncedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : '';
            return (
              <p className="nesio-fin-datanote" style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', margin: '0 0 0.5rem' }}>
                {syncedAt && L(dict, `数据截至 ${dateStr}`, `As of ${dateStr}`)}
                {excluded > 0 && `${syncedAt ? ' · ' : ''}${L(dict, `另有 ${excluded} 笔其他币种未计入`, `${excluded} txn(s) in other currencies excluded`)}`}
              </p>
            );
          })()}
          <div className="nesio-fin-kpis">
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '净支出', 'Net spend')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.net, summary.currency)}</span>{netDelta !== null && <span className={`nesio-fin-delta${netDelta > 0 ? ' up' : ' down'}`}>{netDelta > 0 ? '+' : ''}{netDelta}%</span>}</div>
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '退款', 'Refunds')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.refunds, summary.currency)}</span></div>
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '收入', 'Income')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.income, summary.currency)}</span></div>
          </div>
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>{L(dict, '收入 / 转账 / 信用卡还款 不计入收支;分错了到「交易」点类型改。', 'Income / transfers / card payments are excluded; fix any mislabels under Transactions.')}</p>

          {/* 批次 40:分类支出环形图 */}
          {cats.length > 0 && (
            <div className="nesio-fin-donut-wrap">
              <FinanceDonut slices={cats} centerTop={L(dict, '本月支出', 'This month')} centerVal={formatMoney(cats.reduce((s, c) => s + c.total, 0), summary.currency)} />
              <div className="nesio-fin-donut-legend">
                {cats.slice(0, 6).map((c, i) => (
                  <div key={c.category} className="nesio-fin-donut-leg">
                    <span className="nesio-fin-donut-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="nesio-fin-donut-cat">{categoryLabel(c.category, dict)}</span>
                    <span className="nesio-fin-donut-pct">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(findings.length > 0 || review.length > 0) && (
            <>
              <p className="nesio-settings-section-label">{L(dict, '风险预警', 'Risk alerts')}</p>
              <div className="nesio-fin-alerts">
                {/* 统一判定(financeFindings):flag=真实风险 → risk 红;attention=可关注 → warn 琥珀 */}
                {findings.map((f) => (
                  <div key={f.id} className={`nesio-fin-alert nesio-fin-alert--${f.severity === 'flag' ? 'risk' : 'warn'}`}>
                    <p className="nesio-fin-alert-title">{L(dict, f.title[0], f.title[1])}</p>
                    <p className="nesio-fin-alert-body">{L(dict, f.detail[0], f.detail[1])}</p>
                  </div>
                ))}
                {/* 待归类是页面工作流提示(不是域判定),不进统一层,单独保留 */}
                {review.length > 0 && (
                  <div className="nesio-fin-alert nesio-fin-alert--info">
                    <p className="nesio-fin-alert-title">{L(dict, `${review.length} 笔交易待归类`, `${review.length} transaction(s) to categorize`)}</p>
                    <p className="nesio-fin-alert-body">{L(dict, '未匹配到分类的交易在「交易 → 规则审核」等你处理', 'Uncategorized transactions are waiting under Transactions → Review')}</p>
                  </div>
                )}
              </div>
              <p className="nesio-fin-alert-note">{L(dict, '预警按规则算(非 LLM):与 Today / 问一问 同一套判定', 'Rule-based (not LLM) — the same findings Today and Ask read')}</p>
            </>
          )}

          {trend.length > 1 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '月度趋势 · 净支出', 'Monthly trend · net spend')}</p>
              <div className="nesio-fin-trend">
                {trend.map((t) => {
                  const max = Math.max(...trend.map((x) => x.net), 1);
                  return (
                    <div key={t.ym} className="nesio-fin-trend-col">
                      <span className="nesio-fin-trend-val">{formatMoney(t.net, summary.currency)}</span>
                      <div className="nesio-fin-trend-bar-wrap"><div className={`nesio-fin-trend-bar${t.ym === ym ? ' is-cur' : ''}`} style={{ height: `${Math.max(4, Math.round((t.net / max) * 100))}%` }} /></div>
                      <span className="nesio-fin-trend-lbl">{t.ym.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 批次 39:原「支出」tab 内容(分类聚合 + 商户 Top)并入总览 —— 它本就是聚合分析 */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '全部分类', 'All categories')}</p>
          <div className="nesio-fin-cats">
            {cats.map((c) => (
              <div key={c.category} className="nesio-fin-cat">
                <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{categoryLabel(c.category, dict)}</span><span className="nesio-fin-cat-amt">{formatMoney(c.total, summary.currency)} <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}>{c.pct}%</span>{c.deltaPct !== null && <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span>}</span></div>
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

      {/* ── 交易:规则审核 + 筛选 + 明细 ── */}
      {sub === 'tx' && (
        <>
          {review.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, `规则审核 · ${review.length} 笔待归类`, `Review · ${review.length} to categorize`)}</p>
              {review.slice(0, 1).map((t) => {
                const sug = suggestCategory(t.name);
                return (
                  <div key={t.id} className="nesio-fin-review">
                    <p className="nesio-fin-review-title">{t.name} · {formatMoney(t.amount, summary.currency)}</p>
                    {/* 规则命中的置信度是写死的常数(0.72/0.4),与证据量无关,不该以百分比精度冒充"可信度";改定性措辞。 */}
                    <p className="nesio-fin-review-sug">{L(dict, `建议分类:${categoryLabel(sug.category, 'zh')}${sug.confidence >= 0.6 ? '(关键词匹配)' : '(默认猜测)'}`, `Suggested: ${categoryLabel(sug.category, 'en')}${sug.confidence >= 0.6 ? ' (keyword match)' : ' (default guess)'}`)}</p>
                    <div className="nesio-fin-review-btns">
                      <button type="button" className="nesio-fin-review-accept" onClick={() => resolveReview(t.name, sug.category)}>{L(dict, '接受', 'Accept')}</button>
                      {COMMON_EXPENSE_CATEGORIES.filter((c) => c !== sug.category).slice(0, 2).map((c) => (
                        <button key={c} type="button" className="nesio-fin-review-alt" onClick={() => resolveReview(t.name, c)}>{categoryLabel(c, dict)}</button>
                      ))}
                      <button type="button" className="nesio-fin-review-skip" onClick={() => resolveReview(t.name, 'OTHER')}>{L(dict, '排除', 'Exclude')}</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* 批次 40:筛选改成下拉菜单(账户 + 分类) */}
          <div className="nesio-fin-filterbar" style={{ marginTop: review.length ? '1rem' : 0 }}>
            {accounts.length > 1 && (
              <select className="nesio-fin-select" value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)} aria-label={L(dict, '按账户筛选', 'Filter by account')}>
                <option value="all">{L(dict, '所有账户', 'All accounts')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ····${a.mask}` : ''}</option>
                ))}
              </select>
            )}
            <select className="nesio-fin-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={L(dict, '按分类筛选', 'Filter by category')}>
              <option value="all">{L(dict, '全部分类', 'All categories')}</option>
              {filterCats.filter((c) => c !== 'all').map((c) => (
                <option key={c} value={c}>{categoryLabel(c, dict)}</option>
              ))}
            </select>
          </div>

          <div className="nesio-fin-txlist">
            {shownTx.map((t) => {
              const f = txFlow(t);
              return (
                <div key={t.id}>
                  <div className="nesio-fin-txrow">
                    <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
                    <div className="nesio-fin-txmid">
                      <span className="nesio-fin-txname">{t.name || L(dict, '未知商户', 'Unknown')}{t.accountId && acctMask.get(t.accountId) ? <span className="nesio-fin-txmask"> ····{acctMask.get(t.accountId)}</span> : null}</span>
                      <button type="button" className={`nesio-fin-txflow nesio-fin-txflow--${f}`} onClick={() => setFlowEditId((id) => (id === t.id ? null : t.id))}>
                        {L(dict, TX_FLOW_LABELS[f][0], TX_FLOW_LABELS[f][1])}
                        {f === 'expense' && <span className="nesio-fin-txcat"> · {categoryLabel(effectiveCategory(t), dict) || L(dict, '待归类', 'Uncategorized')}</span>}
                      </button>
                    </div>
                    <span className={`nesio-fin-txamt${t.amount < 0 ? ' is-refund' : ''}`}>{signed(t.amount)}</span>
                  </div>
                  {flowEditId === t.id && (
                    <div className="nesio-fin-flowpick">
                      {(['expense', 'refund', 'income', 'transfer'] as TxFlow[]).map((opt) => (
                        <button key={opt} type="button" className={`nesio-fin-flowopt${f === opt ? ' is-active' : ''}`} onClick={() => applyFlow(t.name, opt)}>{L(dict, TX_FLOW_LABELS[opt][0], TX_FLOW_LABELS[opt][1])}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 批次 39:已学规则管理页 —— 你纠正过的分类/类型都在这,可删 */}
          {(Object.keys(learnedRules.merchant).length > 0 || Object.keys(learnedRules.flow).length > 0) && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, `已学规则 · ${Object.keys(learnedRules.merchant).length + Object.keys(learnedRules.flow).length} 条`, `Learned rules · ${Object.keys(learnedRules.merchant).length + Object.keys(learnedRules.flow).length}`)}</p>
              <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '你纠正过的商户分类和交易类型会记住,自动套用到同名交易。点 ✕ 删除。', 'Your category & flow corrections are remembered and auto-applied to same-name transactions. Tap ✕ to remove.')}</p>
              <div className="nesio-fin-rules">
                {Object.entries(learnedRules.merchant).map(([name, cat]) => (
                  <div key={`m-${name}`} className="nesio-fin-rule">
                    <span className="nesio-fin-rule-txt">{name} <span className="nesio-fin-rule-arrow">→</span> {categoryLabel(cat, dict)}</span>
                    <button type="button" className="nesio-fin-rule-x" onClick={() => removeMerchantRule(name)} aria-label={L(dict, '删除规则', 'Remove rule')}>✕</button>
                  </div>
                ))}
                {Object.entries(learnedRules.flow).map(([name, flow]) => (
                  <div key={`f-${name}`} className="nesio-fin-rule">
                    <span className="nesio-fin-rule-txt">{name} <span className="nesio-fin-rule-arrow">→</span> {L(dict, TX_FLOW_LABELS[flow][0], TX_FLOW_LABELS[flow][1])}</span>
                    <button type="button" className="nesio-fin-rule-x" onClick={() => removeFlowRule(name)} aria-label={L(dict, '删除规则', 'Remove rule')}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── 定期:账单识别(批次 39)── */}
      {sub === 'recurring' && (
        <>
          {upcoming.items.length > 0 && (
            <div className="nesio-fin-recur-hero">
              <span className="nesio-fin-recur-hero-l">{L(dict, `未来 7 天 · ${upcoming.items.length} 笔定期扣款`, `Next 7 days · ${upcoming.items.length} recurring`)}</span>
              <span className="nesio-fin-recur-hero-v">{formatMoney(upcoming.total, summary.currency)}</span>
            </div>
          )}
          <p className="nesio-settings-section-label" style={{ marginTop: upcoming.items.length ? '1rem' : 0 }}>{L(dict, '识别到的定期账单', 'Detected recurring bills')}</p>
          {recurring.length === 0 ? (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没识别到定期账单 —— 需要同一商户至少 3 笔规律扣款。多同步几个月的流水会更准。', 'No recurring bills yet — needs 3+ regular charges from one merchant. Sync more months for accuracy.')}</p>
          ) : (
            <div className="nesio-fin-recurlist">
              {recurring.map((r) => (
                <div key={r.name} className="nesio-fin-recur">
                  <div className="nesio-fin-recur-main">
                    <span className="nesio-fin-recur-name">{r.name}</span>
                    <span className="nesio-fin-recur-meta">{L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {categoryLabel(r.category, dict)} · {L(dict, `下次约 ${r.nextEstimate.slice(5).replace('-', '/')}`, `next ~${r.nextEstimate.slice(5).replace('-', '/')}`)} · {L(dict, `${r.count} 笔`, `${r.count}×`)}</span>
                  </div>
                  <span className="nesio-fin-recur-amt">{formatMoney(r.avgAmount, r.currency)}</span>
                  <button type="button" className="nesio-fin-rule-x" onClick={() => markNotRecurring(r.name)} aria-label={L(dict, '不是定期', 'Not recurring')} title={L(dict, '标为「不是定期」', 'Mark not recurring')}>✕</button>
                </div>
              ))}
            </div>
          )}
          <p className="nesio-fin-alert-note">{L(dict, '按流水周期规则识别(非 LLM),下次日期与金额为估算', 'Rule-based from transaction cadence (not LLM); next date & amount are estimates')}</p>
        </>
      )}

      {/* ── 卡片:分卡 ── */}
      {sub === 'cards' && (
        accounts.length === 0 ? (
          <p className="nesio-insights-option-hint nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没有账户信息。到「设置 → 数据接入」点银行「同步」一次,就会拉到你的卡/账户(余额、消费、退款分卡显示)。', 'No account info yet. Tap Sync on the bank connector once (Settings → Data sources) to pull your cards/accounts (per-card balance, spend, refunds).')}</p>
        ) : (
          accounts.map((a) => {
            const m = accountMonth(txs, a.id, ym);
            return (
              <div key={a.id} className="nesio-fin-card">
                <div className="nesio-fin-card-top">
                  <span className="nesio-fin-card-name">{a.name}{a.mask ? ` ····${a.mask}` : ''}</span>
                  {a.balance != null && <span className="nesio-fin-card-bal">{formatMoney(a.balance, a.currency)}</span>}
                </div>
                <p className="nesio-fin-card-sub">{[a.type, a.subtype].filter(Boolean).join(' · ') || L(dict, '账户', 'Account')}</p>
                <p className="nesio-fin-card-meta">{L(dict, `本月 消费 ${formatMoney(m.spend, a.currency)} · 退款 ${formatMoney(m.refund, a.currency)} · ${m.count} 笔`, `This month · spend ${formatMoney(m.spend, a.currency)} · refunds ${formatMoney(m.refund, a.currency)} · ${m.count} tx`)}</p>
              </div>
            );
          })
        )
      )}

      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>{L(dict, '流水明细只存本机', 'Details stay on-device')}</p>
    </div>
  );
}
