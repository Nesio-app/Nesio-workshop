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
  loadBankSyncedAt, excludedTxCount, internalAdjustmentIds, accountTypeLabel, assetSummary, expenseMerchants,
  loadHoldings,
  type BankTx, type BankAccount, type TxFlow, type Holding,
} from '@/lib/portal/bank-tx';
// 风险预警与 Today/问一问 同读一份判定(financeFindings,Layer1 漂移收口)——此前 bank-tx 里
// 另有一套 alerts 判定(函数级双实现),两个输出面据同一份流水各说各话,已删并由契约钉死不回潮。
import { financeFindings } from '@/lib/portal/finance-insight';
import { computeFinanceScores } from '@/lib/portal/finance-risk';
import { incomeBreakdown, detectIncome, portfolioSummary } from '@/lib/portal/finance-features';
import { removeBankAccount } from '@/lib/portal/bank-tx';
import { loadBudget, saveBudget, hasBudget, suggestBudget, budgetProgress, type BudgetConfig } from '@/lib/portal/finance-budget';
import { buildMonthlyReport, persistReportToMemory, autoPersistLastMonthReport } from '@/lib/portal/finance-report';
import { reportRichHtml } from '@/lib/portal/finance-report-visual';
import { categoryLabel, categoryDetailLabel, COMMON_EXPENSE_CATEGORIES } from '@/lib/portal/tx-category';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'overview' | 'spending' | 'budget' | 'tx' | 'recurring' | 'invest' | 'cards';

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

/** 财务⑩:机构 logo(Plaid base64;缺失用机构/账户名首字母色块,底色用机构主色)。 */
function AcctLogo({ a, size = 22 }: { a: BankAccount; size?: number }) {
  if (a.logo) {
    const src = a.logo.startsWith('data:') ? a.logo : `data:image/png;base64,${a.logo}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="nesio-fin-acct-logo" src={src} alt="" width={size} height={size} />;
  }
  const ch = (a.institution || a.name || '?').trim().charAt(0).toUpperCase();
  return (
    <span
      className="nesio-fin-acct-badge"
      style={{ width: size, height: size, fontSize: size * 0.55, background: a.color || 'var(--portal-accent-soft)', color: a.color ? '#fff' : 'var(--portal-accent)' }}
      aria-hidden
    >{ch}</span>
  );
}

/** 财务⑲:商户 logo(Plaid 富化 URL;缺失由调用方不渲染,不占位)。 */
function MLogo({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="nesio-fin-mlogo" src={src} alt="" width={16} height={16} loading="lazy" />;
}

export default function FinanceTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
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
      setHoldings(loadHoldings());
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
  // 财务⑰:定期页含「待确认」早识别(2 笔规律 / 知名品牌 1 笔);统计消费面仍只用成熟流
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recurring = useMemo(() => detectRecurring(txs, { includePredicted: true }), [txs, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => upcomingRecurring(txs, 7), [txs, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learnedRules = useMemo(() => ({ merchant: loadMerchantRules(), flow: loadFlowRules() }), [rev]);
  // 财务⑪:退款证据 —— 交易行的类型标签与月度统计同口径(没买过的商户进账不是退款)。
  // ⚠️ hooks 必须全部在下面的空态早退**之前**(hook 数量随渲染变化会让 React 整页抛错)。
  const refundEvidence = useMemo(() => expenseMerchants(txs), [txs]);
  // 财务⑮:L3 财务体检(应急金/储蓄率/订阅负担,分项带出处;数据不齐的项不出)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scores = useMemo(() => computeFinanceScores(txs, accounts), [txs, accounts, rev]);
  // 财务㉒:预算(总额 + 分类;「按习惯生成」用近 6 月基线起草)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const budget = useMemo(() => loadBudget(), [rev]);
  const bp = useMemo(() => budgetProgress(txs, ym, budget), [txs, ym, budget]);
  // 财务㉗:投资组合(持仓聚合;⚠️ 同样必须在空态早退之前)
  const portfolio = useMemo(() => portfolioSummary(holdings), [holdings]);
  const [budgetNote, setBudgetNote] = useState('');
  const [reportMsg, setReportMsg] = useState(''); // 财务㉓:月报动作反馈(可见状态,不静默)
  // 财务㉔:月初自动补生成上月月报并存记忆(每设备每月一次,幂等,localStorage 标记)
  useEffect(() => {
    if (!txs.length) return;
    try {
      const outcome = autoPersistLastMonthReport(txs, accounts, new Date(), dict);
      if (outcome === 'created') setReportMsg(L(dict, `已自动生成 ${prevYm(ymOf())} 月报并存入记忆`, `Auto-saved the ${prevYm(ymOf())} report to memory`));
    } catch { /* 自动补失败静默,手动入口仍在 */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs, accounts]);

  if (txs.length === 0) {
    return <p className="nesio-insights-empty">{L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」。', 'No bank transactions yet. Go to Settings → Data sources → Bank feed · Plaid, connect and Sync.')}</p>;
  }

  const signed = (a: number) => (a >= 0 ? `-${formatMoney(a, summary.currency)}` : `+${formatMoney(-a, summary.currency)}`);
  // 财务④:上月净支出不足 $50 时环比是小基数噪音(+786% 之类),不出百分比
  const netDelta = prevSummary.net >= 50 ? Math.round(((summary.net - prevSummary.net) / prevSummary.net) * 100) : null;
  const idx = months.indexOf(ym);
  const SUBS: Array<[Sub, string, string]> = [['overview', '总览', 'Overview'], ['budget', '预算', 'Budget'], ['tx', '交易', 'Transactions'], ['recurring', '定期', 'Recurring'], ['invest', '投资', 'Investing'], ['cards', '账户', 'Accounts']];
  function markNotRecurring(name: string) { setRecurRule(name, 'no'); setRev((r) => r + 1); }
  function removeMerchantRule(name: string) { setMerchantRule(name, ''); setRev((r) => r + 1); }
  function removeFlowRule(name: string) { setFlowRule(name, ''); setRev((r) => r + 1); }
  // 财务⑪:筛选全集 —— 本月分类按金额靠前,其余全量数据里出现过的分类跟在后面
  // (此前只给本月 Top6,想筛「银行费用」但本月没有就选不了)。
  const filterCats = (() => {
    const monthOrder = cats.map((c) => c.category);
    const rest = new Set<string>();
    for (const t of txs) {
      const c = effectiveCategory(t);
      if (c && !monthOrder.includes(c)) rest.add(c);
    }
    return ['all', ...monthOrder, ...[...rest].sort()];
  })();
  // 财务③:同日同额正负、名字带调整词的内部调整对(净额为零)折叠出列表,带可见说明
  const adjIds = internalAdjustmentIds(monthTx);
  const shownTx = monthTx
    .filter((t) => !adjIds.has(t.id))
    .filter((t) => filter === 'all' || effectiveCategory(t) === filter)
    .filter((t) => acctFilter === 'all' || t.accountId === acctFilter);
  // 批次 40 → 财务⑩:交易行显示账户归属(accountId → 完整账户,logo/类型/后四位)
  const acctById = new Map(accounts.map((a) => [a.id, a]));

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
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '退款/返还', 'Refunds & credits')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.refunds, summary.currency)}</span></div>
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '收入', 'Income')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.income, summary.currency)}</span></div>
          </div>
          {/* 财务⑯:收入构成(工资/利息/分红/退税…按 Plaid 细分类分桶) */}
          {summary.income > 0 && (() => {
            const ib = incomeBreakdown(txs, ym);
            if (!ib.length) return null;
            const parts = ib.slice(0, 4).map((s) => `${categoryDetailLabel(s.detail, dict) || L(dict, '其他收入', 'Other income')} ${formatMoney(s.total, summary.currency)}`);
            return <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.5rem', marginBottom: '0.5rem' }}>{L(dict, `收入构成:${parts.join(' · ')}`, `Income mix: ${parts.join(' · ')}`)}</p>;
          })()}
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>{L(dict, '收入 / 转账 / 信用卡还款 不计入收支;分错了到「交易」点类型改。', 'Income / transfers / card payments are excluded; fix any mislabels under Transactions.')}</p>

          {/* 批次 40:分类支出环形图 */}
          {cats.length > 0 && (
            <div className="nesio-fin-donut-wrap">
              <FinanceDonut slices={cats} centerTop={L(dict, '本月支出', 'This month')} centerVal={formatMoney(cats.reduce((s, c) => s + c.total, 0), summary.currency)} />
              <div className="nesio-fin-donut-legend">
                {cats.filter((c) => c.pct >= 1).slice(0, 6).map((c, i) => (
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
          {/* 财务⑮:财务体检 —— L3 分项评分,每项带通行标准出处;红只给真实风险 */}
          {scores.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '财务体检', 'Financial checkup')}</p>
              <div className="nesio-fin-scores">
                {scores.map((s) => (
                  <div key={s.id} className="nesio-fin-score">
                    <div className="nesio-fin-score-top">
                      <span>{L(dict, s.label[0], s.label[1])}</span>
                      <span className={`nesio-fin-score-val is-${s.category}`}>{s.value}</span>
                    </div>
                    <p className="nesio-fin-score-hint">{L(dict, s.detail[0], s.detail[1])} · {L(dict, `依据 ${s.source}`, `per ${s.source}`)}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '全部分类', 'All categories')}</p>
          <div className="nesio-fin-cats">
            {cats.map((c) => (
              <div key={c.category} className="nesio-fin-cat">
                <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{categoryLabel(c.category, dict)}</span><span className="nesio-fin-cat-amt">{formatMoney(c.total, summary.currency)} <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}>{c.pct}%</span>{c.deltaPct !== null ? <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span> : c.isNew ? <span className="nesio-fin-delta is-new">{L(dict, '新增', 'new')}</span> : null}</span></div>
                <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
              </div>
            ))}
          </div>
          {/* 财务㉓:月报 —— 报告级 Markdown,可下载 / 存入记忆(问一问可检索) */}
          <div className="nesio-fin-budget-add" style={{ marginTop: '1.25rem' }}>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              try {
                const r = buildMonthlyReport(txs, accounts, ym, dict);
                const blob = new Blob([r.markdown], { type: 'text/markdown;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `finance-report-${r.ym}.md`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                setReportMsg(L(dict, `已生成 ${r.ym} 月报并下载(.md)`, `Report for ${r.ym} downloaded (.md)`));
              } catch { setReportMsg(L(dict, '月报生成失败,请重试', 'Report failed — try again')); }
            }}>{L(dict, '下载本月财务月报', 'Download monthly report')}</button>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              try {
                const r = buildMonthlyReport(txs, accounts, ym, dict);
                const outcome = persistReportToMemory(r);
                setReportMsg(outcome === 'created'
                  ? L(dict, `已把 ${r.ym} 月报存入记忆,「问一问」可检索`, `Report ${r.ym} saved to memory — Ask can cite it`)
                  : L(dict, `已更新记忆里的 ${r.ym} 月报`, `Updated the ${r.ym} report in memory`));
              } catch { setReportMsg(L(dict, '存入记忆失败,请重试', 'Save to memory failed — try again')); }
            }}>{L(dict, '存入记忆', 'Save to memory')}</button>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              try {
                const w = window.open('', '_blank');
                if (!w) { setReportMsg(L(dict, '弹窗被拦截,请允许弹窗后重试', 'Popup blocked — allow popups and retry')); return; }
                // 财务㉘:彩色图文版(KPI/环形图/趋势图/进度条,自包含 HTML)
                w.document.write(reportRichHtml(txs, accounts, ym, dict));
                w.document.close();
                setTimeout(() => { try { w.focus(); w.print(); } catch { /* 用户手动打印 */ } }, 350);
                setReportMsg(L(dict, '已打开打印视图(打印 → 存为 PDF)', 'Print view opened (Print → Save as PDF)'));
              } catch { setReportMsg(L(dict, '打印视图打开失败,请重试', 'Print view failed — try again')); }
            }}>{L(dict, '打印 / 存 PDF', 'Print / PDF')}</button>
          </div>
          {reportMsg && <p className="nesio-settings-option-hint">{reportMsg}</p>}

          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '商户 Top', 'Top merchants')}</p>
          <div className="nesio-fin-merchants">
            {merchants.map((m) => (
              <div key={m.name} className="nesio-fin-merchant"><span className="nesio-fin-merchant-name">{m.logo && <MLogo src={m.logo} />}{m.name}</span><span className="nesio-fin-merchant-right"><span className="nesio-fin-merchant-amt">{formatMoney(m.total, summary.currency)}</span><span className="nesio-fin-merchant-cnt">{L(dict, `${m.count} 笔`, `${m.count}×`)}</span></span></div>
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
              const f = txFlow(t, undefined, refundEvidence);
              return (
                <div key={t.id}>
                  <div className="nesio-fin-txrow">
                    <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
                    <div className="nesio-fin-txmid">
                      <span className="nesio-fin-txname">{t.merchantLogo && <MLogo src={t.merchantLogo} />}{t.name || L(dict, '未知商户', 'Unknown')}</span>
                      <button type="button" className={`nesio-fin-txflow nesio-fin-txflow--${f}`} onClick={() => setFlowEditId((id) => (id === t.id ? null : t.id))}>
                        <span className="nesio-fin-txflow-l">{L(dict, TX_FLOW_LABELS[f][0], TX_FLOW_LABELS[f][1])}</span>
                        {f === 'expense' && (() => {
                          // 财务⑨:primary 友好名后接 detailed 细分类(咖啡/加油…);*_OTHER_* 无增量不显示
                          const primary = categoryLabel(effectiveCategory(t), dict) || L(dict, '待归类', 'Uncategorized');
                          const detail = categoryDetailLabel(t.categoryDetail || '', dict);
                          return <span className="nesio-fin-txcat"> · {primary}{detail && detail !== primary ? ` · ${detail}` : ''}</span>;
                        })()}
                        {f === 'income' && (() => {
                          // 财务⑯:收入也显示细分(工资/利息收入/分红/退税)
                          const detail = categoryDetailLabel(t.categoryDetail || '', dict);
                          return detail ? <span className="nesio-fin-txcat"> · {detail}</span> : null;
                        })()}
                      </button>
                      {/* 财务⑩:账户归属行 —— 机构 logo + 机构名 + 账户类型 + 卡后4位 */}
                      {(() => {
                        const a = t.accountId ? acctById.get(t.accountId) : undefined;
                        if (!a) return null;
                        const tl = accountTypeLabel(a);
                        return (
                          <span className="nesio-fin-txacct">
                            <AcctLogo a={a} size={13} />
                            {a.institution || a.name}{a.mask ? ` ····${a.mask}` : ''} · {L(dict, tl[0], tl[1])}
                          </span>
                        );
                      })()}
                    </div>
                    <span className={`nesio-fin-txamt${t.amount < 0 ? ' is-refund' : ''}`}>{signed(t.amount)}</span>
                  </div>
                  {flowEditId === t.id && (
                    <div className="nesio-fin-flowpick">
                      {(['expense', 'refund', 'rebate', 'income', 'transfer'] as TxFlow[]).map((opt) => (
                        <button key={opt} type="button" className={`nesio-fin-flowopt${f === opt ? ' is-active' : ''}`} onClick={() => applyFlow(t.name, opt)}>{L(dict, TX_FLOW_LABELS[opt][0], TX_FLOW_LABELS[opt][1])}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {adjIds.size > 0 && (
            <p className="nesio-settings-option-hint" style={{ marginTop: '0.35rem' }}>
              {L(dict, `已折叠 ${adjIds.size / 2} 组银行内部调整(同日同额一正一负,净额为零)`, `${adjIds.size / 2} internal bank adjustment pair(s) collapsed (same-day offsetting, net zero)`)}
            </p>
          )}

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
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没识别到定期账单 —— 同一商户 2 笔规律扣款(或知名订阅品牌 1 笔)就会以「待确认」出现,3 笔转正。新连接的银行,完整历史会在几天内陆续回填,期间隔天点一次「同步」即可。', 'No recurring bills yet — 2 regular charges per merchant (or 1 from a known subscription brand) show as "unconfirmed", confirming at 3. Newly linked banks backfill history over a few days; sync again occasionally.')}</p>
          ) : (
            <div className="nesio-fin-recurlist">
              {recurring.map((r) => (
                <div key={r.name} className="nesio-fin-recur">
                  <div className="nesio-fin-recur-main">
                    <span className="nesio-fin-recur-name">{r.logo && <MLogo src={r.logo} />}{r.name}{r.status === 'predicted' && <span className="nesio-fin-recur-badge">{L(dict, '待确认', 'unconfirmed')}</span>}</span>
                    <span className="nesio-fin-recur-meta">{L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {categoryLabel(r.category, dict)} · {L(dict, `下次约 ${r.nextEstimate.slice(5).replace('-', '/')}`, `next ~${r.nextEstimate.slice(5).replace('-', '/')}`)} · {L(dict, `${r.count} 笔`, `${r.count}×`)}{r.status === 'predicted' ? L(dict, ' · 再出现 1 期自动转正', ' · confirms after next cycle') : ''}</span>
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

      {/* ── 财务㉒:预算 ── */}
      {sub === 'budget' && (() => {
        const patchBudget = (next: BudgetConfig) => { saveBudget(next); setRev((r) => r + 1); };
        if (!hasBudget(budget)) {
          return (
            <>
              <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '预算把「这个月还能花多少」变成一个数。可以按你近 6 个月的真实习惯一键起草,再逐类微调。', 'A budget turns "how much is left this month" into one number. Draft it from your last 6 months, then fine-tune per category.')}</p>
              <button type="button" className="nesio-fin-review-accept" onClick={() => {
                const s = suggestBudget(txs);
                if (s) { patchBudget(s); setBudgetNote(''); }
                else setBudgetNote(L(dict, '历史还不足 3 个完整月,基线起草不了——先从下面手动加一个分类预算。', 'Less than 3 full months of history — add a category budget manually below.'));
              }}>{L(dict, '按我的习惯生成预算', 'Draft from my habits')}</button>
              {budgetNote && <p className="nesio-settings-option-hint">{budgetNote}</p>}
              <div className="nesio-fin-budget-add">
                <select className="nesio-fin-select" value="" aria-label={L(dict, '添加分类预算', 'Add category budget')} onChange={(e) => { if (e.target.value) patchBudget({ ...budget, categories: { ...budget.categories, [e.target.value]: 100 } }); }}>
                  <option value="">{L(dict, '+ 手动添加分类预算', '+ Add category budget')}</option>
                  {COMMON_EXPENSE_CATEGORIES.filter((c) => !budget.categories[c]).map((c) => (
                    <option key={c} value={c}>{categoryLabel(c, dict)}</option>
                  ))}
                </select>
              </div>
            </>
          );
        }
        const { total, perCategory } = bp;
        // 财务㉖:每日可花 / 本月账单待付 / 收入 vs 预期(仅当前月才有"剩余天数"语义)
        const nowD = new Date();
        const isCurrentMonth = ym === ymOf(nowD);
        const daysLeft = isCurrentMonth ? Math.max(1, new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate() - nowD.getDate() + 1) : 0;
        const perDay = total && isCurrentMonth && total.left > 0 ? total.left / daysLeft : null;
        const monthBills = isCurrentMonth ? upcomingRecurring(txs, daysLeft) : { items: [], total: 0 };
        const incomeDet = isCurrentMonth ? detectIncome(txs) : null;
        return (
          <>
            {total && (
              <div className="nesio-fin-budget-hero">
                <span className="nesio-fin-budget-hero-l">{L(dict, `${monthLabel(ym, dict)} · 还可以花`, `${monthLabel(ym, dict)} · left for spending`)}</span>
                <span className={`nesio-fin-budget-left${total.left < 0 ? ' is-over' : ''}`}>{total.left < 0 ? `-${formatMoney(-total.left)}` : formatMoney(total.left)}</span>
                <div className="nesio-fin-bar"><div className={`nesio-fin-bar-fill${total.ratio > 1 ? ' is-over' : ''}`} style={{ width: `${Math.min(100, Math.round(total.ratio * 100))}%` }} /></div>
                <span className="nesio-fin-budget-hero-sub">{L(dict, `已用 ${formatMoney(total.spent)} / 预算 ${formatMoney(total.budget)}`, `${formatMoney(total.spent)} of ${formatMoney(total.budget)}`)}{perDay != null ? L(dict, ` · 每天约 ${formatMoney(perDay)} × ${daysLeft} 天`, ` · ~${formatMoney(perDay)}/day for ${daysLeft}d`) : ''}{total.left < 0 ? L(dict, ' · 超一点没关系,月中调整来得及', ' · a little over is okay — adjust mid-month') : ''}</span>
                <label className="nesio-fin-budget-rowedit">
                  {L(dict, '月总预算', 'Monthly total')}
                  <input type="number" inputMode="decimal" min={0} className="nesio-fin-budget-input" value={budget.total ?? total.budget} onChange={(e) => patchBudget({ ...budget, total: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
              </div>
            )}
            {isCurrentMonth && (
              <div className="nesio-fin-kpis" style={{ marginTop: '0.6rem', marginBottom: 0, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="nesio-fin-kpi">
                  <span className="nesio-fin-kpi-l">{L(dict, '本月账单待付', 'Bills left to pay')}</span>
                  <span className="nesio-fin-kpi-v">{formatMoney(monthBills.total)}</span>
                  <span className="nesio-fin-budget-hero-sub">{L(dict, `${monthBills.items.length} 笔已识别定期`, `${monthBills.items.length} recurring`)}</span>
                </div>
                <div className="nesio-fin-kpi">
                  <span className="nesio-fin-kpi-l">{L(dict, '收入', 'Earnings')}</span>
                  <span className="nesio-fin-kpi-v">{formatMoney(summary.income, summary.currency)}</span>
                  {incomeDet && <span className="nesio-fin-budget-hero-sub">{L(dict, `预期约 ${formatMoney(incomeDet.monthlyIncome)}/月`, `expect ~${formatMoney(incomeDet.monthlyIncome)}/mo`)}</span>}
                </div>
              </div>
            )}
            <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '分类预算', 'Category budgets')}</p>
            <div className="nesio-fin-cats">
              {perCategory.map((c) => (
                <div key={c.category} className="nesio-fin-cat">
                  <div className="nesio-fin-cat-top">
                    <span className="nesio-fin-cat-name">{categoryLabel(c.category, dict)}</span>
                    <span className="nesio-fin-cat-amt">
                      {formatMoney(c.spent)} <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}>/</span>{' '}
                      <input type="number" inputMode="decimal" min={0} className="nesio-fin-budget-input" value={c.budget} onChange={(e) => patchBudget({ ...budget, categories: { ...budget.categories, [c.category]: Math.max(0, Number(e.target.value) || 0) } })} />
                      <button type="button" className="nesio-fin-rule-x" onClick={() => { const next = { ...budget.categories }; delete next[c.category]; patchBudget({ ...budget, categories: next }); }} aria-label={L(dict, '移除此分类预算', 'Remove this category budget')}>✕</button>
                    </span>
                  </div>
                  <div className="nesio-fin-bar"><div className={`nesio-fin-bar-fill${c.ratio > 1 ? ' is-over' : ''}`} style={{ width: `${Math.min(100, Math.round(c.ratio * 100))}%` }} /></div>
                </div>
              ))}
            </div>
            {bp.otherSpent > 0 && (
              <div className="nesio-fin-cat" style={{ marginTop: '0.9rem' }}>
                <div className="nesio-fin-cat-top">
                  <span className="nesio-fin-cat-name">{L(dict, '其他(未设预算)', 'Everything else')}</span>
                  <span className="nesio-fin-cat-amt">{formatMoney(bp.otherSpent)}</span>
                </div>
                <p className="nesio-fin-score-hint" style={{ marginTop: 0 }}>{L(dict, '这些分类还没设预算 —— 超支常藏在这里,可用下方「+ 添加分类预算」纳入。', "No budget on these categories yet — overspend often hides here; add one below.")}</p>
              </div>
            )}
            <div className="nesio-fin-budget-add">
              <select className="nesio-fin-select" value="" aria-label={L(dict, '添加分类预算', 'Add category budget')} onChange={(e) => { if (e.target.value) patchBudget({ ...budget, categories: { ...budget.categories, [e.target.value]: 100 } }); }}>
                <option value="">{L(dict, '+ 添加分类预算', '+ Add category budget')}</option>
                {COMMON_EXPENSE_CATEGORIES.filter((c) => !budget.categories[c]).map((c) => (
                  <option key={c} value={c}>{categoryLabel(c, dict)}</option>
                ))}
              </select>
              <button type="button" className="nesio-fin-flowopt" onClick={() => {
                const s = suggestBudget(txs);
                if (s) { patchBudget(s); setBudgetNote(''); } else setBudgetNote(L(dict, '历史不足 3 个完整月,暂无法按基线重置。', 'Less than 3 full months of history.'));
              }}>{L(dict, '按习惯重置', 'Reset from habits')}</button>
            </div>
            {budgetNote && <p className="nesio-settings-option-hint">{budgetNote}</p>}
            <p className="nesio-fin-alert-note">{L(dict, '预算只存本机;总口径 = 本月净支出(与总览一致),分类口径 = 该类支出合计。', 'Budgets stay on-device; total = monthly net spend (matches Overview), categories = category spend.')}</p>
          </>
        );
      })()}

      {/* ── 财务㉗:投资(持仓明细 + 组合结构 + 集中度) ── */}
      {sub === 'invest' && (() => {
        const hasInvestAcct = accounts.some((a) => (a.type || '').toLowerCase() === 'investment');
        if (!portfolio) {
          return (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{hasInvestAcct
              ? L(dict, '已看到投资账户,但还没拉到持仓明细 —— 到「设置 → 数据接入」再点一次「同步」,持仓(股票/基金/现金仓位)会跟着回来。', 'Investment accounts found, but no holdings yet — tap Sync once more (Settings → Data sources) to pull positions (stocks/funds/cash).')
              : L(dict, '还没有投资账户。连接券商/退休金账户(Fidelity、Robinhood 等)后,这里会展示持仓明细、组合结构和浮动盈亏。', 'No investment accounts yet. Connect a brokerage/retirement account (Fidelity, Robinhood, …) to see positions, allocation and unrealized gains here.')}</p>
          );
        }
        const fmtGain = (g: number) => (g >= 0 ? `+${formatMoney(g)}` : `-${formatMoney(-g)}`);
        const gainColor = (g: number) => (g >= 0 ? 'var(--status-go)' : 'var(--status-gentle)');
        // 本月投资收益(分红/利息)——与收入细分同一口径
        const invIncome = incomeBreakdown(txs, ym).filter((s) => s.detail === 'INCOME_DIVIDENDS' || s.detail === 'INCOME_INTEREST_EARNED');
        const invIncomeTotal = invIncome.reduce((s, x) => s + x.total, 0);
        return (
          <>
            <div className="nesio-fin-assets">
              <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '总市值', 'Market value')}</span>{formatMoney(portfolio.totalValue)}</span>
              {portfolio.gain !== null && (
                <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '浮动盈亏', 'Unrealized')}</span><span style={{ color: gainColor(portfolio.gain) }}>{fmtGain(portfolio.gain)}{portfolio.gainPct !== null ? ` (${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}</span></span>
              )}
              <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '持仓', 'Positions')}</span>{portfolio.positions.length}</span>
            </div>
            {portfolio.concentrated && (
              <p className="nesio-fin-score-hint" style={{ marginTop: '0.6rem' }}>{L(dict,
                `${portfolio.concentrated.ticker || portfolio.concentrated.name} 占了组合的 ${portfolio.concentrated.pct}% —— 集中不是错,只是波动会更贴着这一只走;有空可以想想要不要分散一点。`,
                `${portfolio.concentrated.ticker || portfolio.concentrated.name} is ${portfolio.concentrated.pct}% of the portfolio — concentration isn't wrong, but volatility will track this one closely; worth a think when you have a moment.`)}</p>
            )}
            <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '组合结构', 'Allocation')}</p>
            <div className="nesio-fin-cats">
              {portfolio.byType.map((s) => (
                <div key={s.label} className="nesio-fin-cat">
                  <div className="nesio-fin-cat-top">
                    <span className="nesio-fin-cat-name">{s.label}</span>
                    <span className="nesio-fin-cat-amt">{formatMoney(s.value)} · {s.pct}%</span>
                  </div>
                  <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.min(100, s.pct)}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>{L(dict, '持仓明细', 'Positions')}</p>
            <div className="nesio-fin-recurlist">
              {portfolio.positions.map((p) => (
                <div key={`${p.ticker || p.name}`} className="nesio-fin-recur">
                  <div className="nesio-fin-recur-main">
                    <span className="nesio-fin-recur-name">{p.ticker ? `${p.ticker} · ` : ''}{p.name}</span>
                    <span className="nesio-fin-recur-meta">{p.typeLabel} · {L(dict, `${p.quantity} 份`, `${p.quantity} sh`)} · {p.pct}%</span>
                  </div>
                  <span className="nesio-fin-recur-amt" style={{ textAlign: 'right' }}>
                    {formatMoney(p.value)}
                    {p.gain !== null && <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: gainColor(p.gain) }}>{fmtGain(p.gain)}</span>}
                  </span>
                </div>
              ))}
            </div>
            {invIncomeTotal > 0 && (
              <p className="nesio-fin-score-hint" style={{ marginTop: '0.8rem' }}>{L(dict,
                `${monthLabel(ym, dict)} 投资收益 ${formatMoney(invIncomeTotal)}(${invIncome.map((s) => `${categoryDetailLabel(s.detail, dict)} ${formatMoney(s.total)}`).join(' · ')})`,
                `${monthLabel(ym, dict)} investment income ${formatMoney(invIncomeTotal)} (${invIncome.map((s) => `${categoryDetailLabel(s.detail, dict)} ${formatMoney(s.total)}`).join(' · ')})`)}</p>
            )}
            <p className="nesio-fin-alert-note">{L(dict, '持仓与成本来自券商快照,盈亏为未实现浮动值;缺成本数据的持仓不显示盈亏。以上不构成投资建议。', 'Positions & cost basis come from broker snapshots; gains are unrealized. Positions missing cost basis show no gain. Not investment advice.')}</p>
          </>
        );
      })()}

      {/* ── 卡片:分卡 ── */}
      {sub === 'cards' && (
        accounts.length === 0 ? (
          <p className="nesio-insights-option-hint nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没有账户信息。到「设置 → 数据接入」点银行「同步」一次,就会拉到你的卡/账户(余额、消费、退款分卡显示)。', 'No account info yet. Tap Sync on the bank connector once (Settings → Data sources) to pull your cards/accounts (per-card balance, spend, refunds).')}</p>
        ) : (
          <>
            {/* 财务⑩:资产小结 —— 存款 + 投资 − 信用卡欠款 = 净资产(USD 口径) */}
            {(() => {
              const s = assetSummary(accounts);
              if (s.deposits === 0 && s.investments === 0 && s.creditOwed === 0) return null;
              return (
                <div className="nesio-fin-assets">
                  <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '存款', 'Cash')}</span>{formatMoney(s.deposits)}</span>
                  {s.investments > 0 && <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '投资', 'Investments')}</span>{formatMoney(s.investments)}</span>}
                  <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '信用卡欠款', 'Card debt')}</span>{formatMoney(s.creditOwed)}</span>
                  <span className="nesio-fin-asset"><span className="nesio-fin-asset-l">{L(dict, '净资产', 'Net worth')}</span>{s.net < 0 ? `-${formatMoney(-s.net)}` : formatMoney(s.net)}</span>
                </div>
              );
            })()}
            {accounts.map((a) => {
              const m = accountMonth(txs, a.id, ym);
              const tl = accountTypeLabel(a);
              return (
                <div key={a.id} className="nesio-fin-card">
                  <div className="nesio-fin-card-top">
                    <span className="nesio-fin-card-name"><AcctLogo a={a} /><span className="nesio-fin-card-name-t">{a.name}{a.mask ? ` ····${a.mask}` : ''}</span></span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      {a.balance != null && <span className="nesio-fin-card-bal">{(a.type || '').toLowerCase() === 'credit' ? L(dict, `欠款 ${formatMoney(a.balance, a.currency)}`, `owes ${formatMoney(a.balance, a.currency)}`) : formatMoney(a.balance, a.currency)}</span>}
                      {/* 财务⑯:重复/失效副本手动移除兜底(仍在连接中的账户下次同步会回来) */}
                      <button type="button" className="nesio-fin-rule-x" onClick={() => { removeBankAccount(a.id); setRev((r) => r + 1); }} aria-label={L(dict, '移除此账户(重复或失效副本;仍连接的账户同步时会回来)', 'Remove this account (duplicates/stale; still-linked accounts return on sync)')} title={L(dict, '移除(重复/失效副本用;仍连接的账户同步会回来)', 'Remove (for duplicates; returns on sync if still linked)')}>✕</button>
                    </span>
                  </div>
                  <p className="nesio-fin-card-sub">{[a.institution, L(dict, tl[0], tl[1]), a.mask ? `····${a.mask}` : ''].filter(Boolean).join(' · ')}</p>
                  <p className="nesio-fin-card-meta">{m.count === 0
                    ? L(dict, '该月此账户暂无交易', 'No transactions this month for this account')
                    : L(dict, `本月 消费 ${formatMoney(m.spend, a.currency)} · 退款/返还 ${formatMoney(m.refund, a.currency)} · ${m.count} 笔`, `This month · spend ${formatMoney(m.spend, a.currency)} · refunds/credits ${formatMoney(m.refund, a.currency)} · ${m.count} tx`)}</p>
                </div>
              );
            })}
          </>
        )
      )}

      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>{L(dict, '流水明细只存本机', 'Details stay on-device')}</p>
    </div>
  );
}
