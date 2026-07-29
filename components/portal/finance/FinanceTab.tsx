'use client';

/**
 * FinanceTab — 财务(批次 29,批次 31 增强)。洞察里「财务」tab。
 * 子分类:总览(KPI + 风险预警 + 月度趋势)/ 支出(分类+商户)/ 交易(筛选+规则审核)/ 卡片(分卡)。
 * 读本机 Plaid 流水(nesio-bank-tx-v1)+ 账户(nesio-bank-accounts-v1)。
 */

import { useEffect, useMemo, useState } from 'react';
import FamilyDataCard from '../relationships/FamilyDataCard';
import {
  availableMonths, categoryBreakdown, topMerchants,
  needsReview, suggestCategory, setMerchantRule, effectiveCategory,
  formatMoney, ymOf, prevYm, txFlow, setFlowRule, TX_FLOW_LABELS,
  detectRecurring, upcomingRecurring, loadMerchantRules, loadFlowRules, setRecurRule,
  loadBankSyncedAt, excludedTxCount, internalAdjustmentIds, accountTypeLabel, assetSummaryWithHoldings, expenseMerchants,
  loadHoldings, setMerchantRuleFor, setFlowRuleFor, loadRuleLabels,
  bankDataReady, loadBankSyncStatus,
  type BankTx, type BankAccount, type TxFlow, type Holding,
} from '@/lib/portal/bank-tx';
// 风险预警与 Today/问一问 同读一份判定(financeFindings,Layer1 漂移收口)——此前 bank-tx 里
// 另有一套 alerts 判定(函数级双实现),两个输出面据同一份流水各说各话,已删并由契约钉死不回潮。
import { financeFindings } from '@/lib/portal/finance-insight';
import { computeFinanceScores } from '@/lib/portal/finance-risk';
import { incomeBreakdown, detectIncome, portfolioSummary, recurringPriceHikes } from '@/lib/portal/finance-features';
import { loadCombinedFinanceTx, loadCombinedFinanceAccounts } from '@/lib/portal/tesla-finance';
import QuickAddSheet from './QuickAddSheet';
import RecurringPane from './RecurringPane';
import CardsPane from './CardsPane';
import AcctLogo from './AcctLogo';
import InvestPane from './InvestPane';
import { listManualAssets, manualNetWorth, loadNetWorthSeries, finAssetsReady, FIN_ASSETS_EVENT } from '@/lib/portal/finance-assets';
import { receiptMatchCandidates, rejectPair, loadRejectedPairs } from '@/lib/portal/receipt-match';
import { linkExpenseToBankTx, loadDomainExpenses } from '@/lib/portal/finance-sources';
import { domainExpenseTotal, listExpenses, EXPENSES_EVENT, type Expense } from '@/lib/portal/finance-sources';
import { financeMonthAggregate } from '@/lib/portal/finance-aggregate';
import { loadBudget, saveBudget, hasBudget, suggestBudget, budgetProgress, type BudgetConfig } from '@/lib/portal/finance-budget';
import { buildMonthlyReport, persistReportToMemory, autoPersistLastMonthReport } from '@/lib/portal/finance-report';
import { reportRichHtml } from '@/lib/portal/finance-report-visual';
import { categoryLabel, categoryDetailLabel, COMMON_EXPENSE_CATEGORIES } from '@/lib/portal/tx-category';
import { loadAllPersonRecords } from '@/lib/portal/person-records';
import { IconLock, IconSnowflake } from '../icons';
import { isFreezeLaunched } from '@/lib/portal/entitlement';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'overview' | 'spending' | 'tx' | 'recurring' | 'invest' | 'cards'; // 'budget' 死枚举已删(预算在总览渲染)

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
  // P3 图表统一:与月报(finance-report-visual)同口径 —— 前 6 类 + 其余合并「其他」,
  // 修「屏幕版第 9 类以后直接消失、环上出现空缺」的双口径。
  const top = slices.slice(0, 6);
  const restPct = slices.slice(6).reduce((s, x) => s + x.pct, 0);
  const shown = restPct > 0 ? [...top, { category: 'OTHER_REST', pct: restPct }] : top;
  return (
    <svg viewBox="0 0 140 140" width="132" height="132" style={{ display: 'block', margin: '0 auto' }}>
      <g transform="translate(70,70) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--portal-line)" strokeWidth="14" />
        {shown.map((s, i) => {
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
  // 三态,不是两态。原来是 hydrated: boolean,而 bankDataReady() 的 catch 里直接
  // setHydrated(true) —— 也就是**把「读不出来」当成「没有数据」**:IDB 打不开的那一次,
  // 界面就说「还没有银行流水,去连接 Plaid」,而流水其实好端端躺在本机。
  // 用户实测到的正是这个:同一个财务页在「有完整数据」和「完全空白」之间跳变。
  // (CLAUDE.md 红线:失败必须看得见,不许伪装成空。)
  const [hydrateState, setHydrateState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [quickAdd, setQuickAdd] = useState<null | { seg: 'expense' | 'income' | 'asset'; assetId?: string }>(null); // P1:全局「+」(带资产上下文)

  useEffect(() => {
    const reload = () => {
      // P0:统一数据集单一读口(银行 ∪ Tesla)—— financeMonthAggregate / domain-insights 同源,
      // 修「总览两个 KPI 跑在两个数据集上」。
      const loaded = loadCombinedFinanceTx();
      setTxs(loaded);
      setAccounts(loadCombinedFinanceAccounts());
      setHoldings(loadHoldings());
      const av = availableMonths(loaded);
      if (av.length) setYm((cur) => (av.includes(cur) ? cur : av[0])); // 不覆盖用户已选月份
    };
    reload();
    // P0:冷启动区分「加载中/真没数据」—— IDB 水合完成前不给假空态。
    bankDataReady().then(() => { setHydrateState('ready'); reload(); }).catch(() => setHydrateState('error'));
    // P1 竞态修复:手动资产/快照 store 水合完成的 emit 可能早于监听挂载 —— ready 后强刷一次
    finAssetsReady().then(() => setRev((r) => r + 1)).catch(() => { /* 水合失败按空处理 */ });
    // 数据搬 IDB 后:水合完成/同步后派发 nesio-bank-updated → 重读(冷启动空窗自愈)。
    window.addEventListener('nesio-bank-updated', reload);
    // Tesla 同步后派发 nesio-connectors-refreshed → 新充电花费即时进财务。
    window.addEventListener('nesio-connectors-refreshed', reload);
    window.addEventListener(EXPENSES_EVENT, reload);
    // P1:手动资产/锚点变动 → 净值 hero 与账户页即时刷新
    const onAssets = () => setRev((r) => r + 1);
    window.addEventListener(FIN_ASSETS_EVENT, onAssets);
    return () => {
      window.removeEventListener('nesio-bank-updated', reload);
      window.removeEventListener('nesio-connectors-refreshed', reload);
      window.removeEventListener(EXPENSES_EVENT, reload);
      window.removeEventListener(FIN_ASSETS_EVENT, onAssets);
    };
  }, []);

  const months = useMemo(() => availableMonths(txs), [txs]);
  // P0·同进度对比:当前月是残月,环比基准取上月「同进度」(截至今天同一日),否则假省钱/假超支。
  const isCurMonth = ym === ymOf();
  const todayDay = new Date().getDate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = useMemo(() => financeMonthAggregate(ym, { txs }), [txs, ym, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevSummary = useMemo(
    () => financeMonthAggregate(prevYm(ym), { txs, ...(isCurMonth ? { throughDay: todayDay } : {}) }),
    [txs, ym, rev, isCurMonth, todayDay],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cats = useMemo(() => categoryBreakdown(txs, ym), [txs, ym, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const merchants = useMemo(() => topMerchants(txs, ym, 6), [txs, ym, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const findings = useMemo(
    () => financeFindings(txs, accounts, ym, { domainNet: summary.domainNet, prevDomainNet: prevSummary.domainNet }),
    [txs, accounts, ym, rev, summary.domainNet, prevSummary.domainNet],
  );
  // 口径统一:趋势柱与 KPI 同含域内支出(此前同屏两个「净支出」差一个小票的量)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trend = useMemo(
    () => availableMonths(txs).slice(0, 6).reverse().map((m) => ({ ym: m, net: financeMonthAggregate(m, { txs }).net })),
    [txs, rev],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const review = useMemo(() => needsReview(txs, ym), [txs, ym, rev]);
  const monthTx = useMemo(() => txs.filter((t) => (t.date || '').slice(0, 7) === ym).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [txs, ym]);
  // 财务⑰:定期页含「待确认」早识别(2 笔规律 / 知名品牌 1 笔);统计消费面仍只用成熟流
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recurring = useMemo(() => detectRecurring(txs, { includePredicted: true }), [txs, rev]);
  // 免费最大化·Plaid C:订阅涨价(key → 涨幅),标在对应订阅行
  const hikeByKey = useMemo(() => new Map(recurringPriceHikes(recurring).map((h) => [h.key, h])), [recurring]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => upcomingRecurring(txs, 7), [txs, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learnedRules = useMemo(() => ({ merchant: loadMerchantRules(), flow: loadFlowRules(), labels: loadRuleLabels() }), [rev]);
  // 财务⑪:退款证据 —— 交易行的类型标签与月度统计同口径(没买过的商户进账不是退款)。
  // ⚠️ hooks 必须全部在下面的空态早退**之前**(hook 数量随渲染变化会让 React 整页抛错)。
  const refundEvidence = useMemo(() => expenseMerchants(txs), [txs]);
  // P1:手动资产 + 净值(Plaid∪手动,币种按拍板简单相加)+ 快照序列(净值 hero 小曲线)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const manualAssets = useMemo(() => listManualAssets(), [rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nwSeries = useMemo(() => loadNetWorthSeries(), [rev, txs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rejectedPairs = useMemo(() => loadRejectedPairs(), [rev]);
  // 财务⑮:L3 财务体检(应急金/储蓄率/订阅负担,分项带出处;数据不齐的项不出)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scores = useMemo(() => computeFinanceScores(txs, accounts), [txs, accounts, rev]);
  // 财务㉒:预算(总额 + 分类;「按习惯生成」用近 6 月基线起草)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const budget = useMemo(() => loadBudget(), [rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bp = useMemo(() => budgetProgress(txs, ym, budget, { domainNet: summary.domainNet }), [txs, ym, budget, summary.domainNet]);
  // 跨域小票/旅行支出(不写 bank-tx,旁条展示)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domainSpend = useMemo(() => domainExpenseTotal(ym), [ym, rev, txs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domainRows = useMemo(
    () => listExpenses(ym, { includeBank: false, includeDomain: true, financeOnly: true }) as Expense[],
    [ym, rev, txs],
  );
  // 财务㉗:投资组合(持仓聚合;⚠️ 同样必须在空态早退之前)
  const [budgetNote, setBudgetNote] = useState('');
  const [reportMsg, setReportMsg] = useState(''); // 财务㉓:月报动作反馈(可见状态,不静默)
  // 财务㉔:月初自动补生成上月月报并存记忆(每设备每月一次,幂等,localStorage 标记)
  useEffect(() => {
    if (!txs.length) return;
    try {
      const lastYm = prevYm(ymOf());
      const outcome = autoPersistLastMonthReport(txs, accounts, new Date(), dict, {
        domainNet: financeMonthAggregate(lastYm, { txs }).domainNet,
        prevDomainNet: financeMonthAggregate(prevYm(lastYm), { txs }).domainNet,
      });
      if (outcome === 'created') setReportMsg(L(dict, `已自动生成 ${prevYm(ymOf())} 月报并存入记忆`, `Auto-saved the ${prevYm(ymOf())} report to memory`));
    } catch { setReportMsg(L(dict, '上月月报自动生成没成功 —— 「下载彩色月报」按钮仍可手动生成。', 'Auto report failed — the manual report button still works.')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs, accounts]);

  if (txs.length === 0) {
    // P0:水合未完成 = 加载中,不是没数据 —— 此前已连接用户每次冷启动都先看到「去连接」闪屏。
    if (hydrateState === 'loading') {
      return (
        <div className="nesio-analytics-tab">
          <p className="nesio-insights-empty">{L(dict, '正在读取本机流水…', 'Loading local transactions…')}</p>
        </div>
      );
    }
    if (hydrateState === 'error') {
      // 读不出来 ≠ 没有。说清楚是哪种,并给一条出路 —— 否则用户会以为数据没了。
      return (
        <div className="nesio-analytics-tab">
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
            {L(dict, '本机流水这次没读出来(浏览器存储没打开成功),数据还在,不是丢了。', "Couldn't open local transaction storage this time — your data is still there.")}
          </p>
          <button type="button" className="nesio-fin-review-accept" style={{ marginTop: '0.5rem' }}
            onClick={() => { setHydrateState('loading'); bankDataReady().then(() => { setHydrateState('ready'); setRev((r) => r + 1); }).catch(() => setHydrateState('error')); }}>
            {L(dict, '重试', 'Retry')}
          </button>
        </div>
      );
    }
    const st = loadBankSyncStatus();
    return (
      <div className="nesio-analytics-tab">
        {st && !st.ok && (
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
            {st.error === 'relink_required'
              ? L(dict, '银行授权已过期 —— 到「设置 → 数据接入」点「修复」重新授权。', 'Bank authorization expired — go to Settings → Data sources and tap Repair.')
              : L(dict, `上次同步没成功(${st.error || 'unknown'}),稍后再试或到「设置 → 数据接入」看看。`, `Last sync failed (${st.error || 'unknown'}) — retry later or check Settings → Data sources.`)}
          </p>
        )}
        <p className="nesio-insights-empty">{L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」;现金账也可以直接手动记。', 'No bank transactions yet. Connect via Settings → Data sources → Plaid, or just add cash entries by hand.')}</p>
        {/* UI 审计 P0-1:此前「+」只在主分支渲染,没连银行的用户永远点不到 —— 死锁解除 */}
        <button type="button" className="nesio-fin-review-accept" style={{ marginTop: '0.5rem' }}
          onClick={() => setQuickAdd({ seg: 'expense' })}>{L(dict, '＋ 记一笔(现金 / 红包 / 资产)', '＋ Add entry (cash / income / asset)')}</button>
        <QuickAddSheet open={quickAdd != null} initialSeg={quickAdd?.seg} initialAssetId={quickAdd?.assetId}
          onClose={() => setQuickAdd(null)} onSaved={() => setRev((r) => r + 1)} />
        {domainSpend.count > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="nesio-settings-section-label">{L(dict, '本月小票 / 旅行', 'Receipts / travel this month')}</p>
            <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
              {L(dict, `${domainSpend.count} 笔 · 合计约 ${domainSpend.total.toFixed(0)}(未并入银行 KPI)`, `${domainSpend.count} · ~${domainSpend.total.toFixed(0)} (not in bank KPIs)`)}
            </p>
            {domainRows.slice(0, 6).map((e) => (
              <div key={e.id} className="nesio-fin-person-row" style={{ marginTop: '0.35rem' }}>
                <span className="nesio-fin-person-name">{e.merchant || e.note || e.source}</span>
                <span className="nesio-fin-person-amt">{e.currency}{e.amount}</span>
              </div>
            ))}
          </div>
        )}
        <FamilyDataCard kind="spend" />
      </div>
    );
  }

  const signed = (a: number) => (a >= 0 ? `-${formatMoney(a, summary.currency)}` : `+${formatMoney(-a, summary.currency)}`);
  // 财务④:上月净支出不足 $50 时环比是小基数噪音(+786% 之类),不出百分比
  const netDelta = prevSummary.net >= 50 ? Math.round(((summary.net - prevSummary.net) / prevSummary.net) * 100) : null;
  const idx = months.indexOf(ym);

  // 设计:总览顶部补 —— 本月支出(毛)+ 环比、念念一句话小结、消费×人(真数据)
  const grossSpend = cats.reduce((s, c) => s + c.total, 0) + (summary.domainNet || 0);
  // P0:当前月环比基准 = 上月同进度(prevSummary 已按 throughDay 截断,分类同口径)
  const prevGross = categoryBreakdown(txs, prevYm(ym), isCurMonth ? { throughDay: todayDay } : undefined).reduce((s, c) => s + c.total, 0) + (prevSummary.domainNet || 0);
  const spendDelta = prevGross >= 50 ? Math.round(((grossSpend - prevGross) / prevGross) * 100) : null;
  const vsLabel = isCurMonth ? L(dict, '与上月同进度相比', 'vs same point last month') : L(dict, '环比上月', 'vs last month');
  // 念念一句话:省/多花 + 本周待付账单(都来自真数据,不编)
  const nessaSummary = (() => {
    const parts: string[] = [];
    if (spendDelta !== null && spendDelta !== 0) {
      const topCat = cats[0] ? categoryLabel(cats[0].category, dict) : '';
      const vsZh = isCurMonth ? '比上月同期' : '比上月';
      const vsEn = isCurMonth ? 'vs same point last month' : 'vs last month';
      parts.push(spendDelta < 0
        ? L(dict, `这月${vsZh}省了 ${-spendDelta}%${topCat ? `,${topCat} 花得最多` : ''}。`, `Down ${-spendDelta}% ${vsEn}${topCat ? `; ${topCat} led spending` : ''}.`)
        : L(dict, `这月${vsZh}多花了 ${spendDelta}%${topCat ? `,主要在${topCat}` : ''}。`, `Up ${spendDelta}% ${vsEn}${topCat ? `, mostly ${topCat}` : ''}.`));
    }
    if (upcoming.items.length > 0) parts.push(L(dict, `还有 ${upcoming.items.length} 笔账单这周要付。`, `${upcoming.items.length} bill(s) due this week.`));
    return parts.join('');
  })();
  // 消费×人:person-records 里 spending 类(本月),按人聚合
  const personSpend = (() => {
    const recs = loadAllPersonRecords().filter((r) => r.category === 'spending' && typeof r.amount === 'number' && (r.date || r.createdAt).slice(0, 7) === ym);
    const byKey = new Map<string, { total: number; titles: string[] }>();
    for (const r of recs) { const e = byKey.get(r.personKey) || { total: 0, titles: [] }; e.total += r.amount as number; if (r.title) e.titles.push(r.title); byKey.set(r.personKey, e); }
    const pretty = (k: string) => /[a-z]/i.test(k) ? k.replace(/\b\w/g, (m) => m.toUpperCase()) : k;
    return [...byKey.entries()].map(([k, v]) => ({ key: k, name: pretty(k), total: v.total, title: v.titles.length === 1 ? v.titles[0] : '' })).sort((a, b) => b.total - a.total).slice(0, 5);
  })();
  // 设计:4 个子页 —— 总览 / 支出 / 交易 / 卡片。预算并入总览,定期并入交易,投资并入卡片。
  // P2:订阅/投资从死枚举变真页面(订阅监控 = 变化置顶+14 天账单;投资 = 收益导向)
  const SUBS: Array<[Sub, string, string]> = [['overview', '总览', 'Overview'], ['spending', '支出', 'Spending'], ['tx', '交易', 'Tx'], ['recurring', '订阅', 'Recurring'], ['invest', '投资', 'Invest'], ['cards', '卡片', 'Cards']];
  function markNotRecurring(key: string) { setRecurRule(key, 'no'); setRev((r) => r + 1); } // 财务㉚:传流的 merchantKey,改名不丢
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

  function resolveReview(t: BankTx, category: string) { setMerchantRuleFor(t, category); setRev((r) => r + 1); } // 财务㉚:写 merchantKey
  function applyFlow(t: BankTx, flow: TxFlow) { setFlowRuleFor(t, flow); setFlowEditId(null); setRev((r) => r + 1); } // 财务㉚:写 merchantKey

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
        {/* P1 全局「+」记一笔:放行首(子 tab 行横向可滚,行尾在小屏会被挤出视口) */}
        <button type="button" className="nesio-fin-subtab" style={{ fontWeight: 700, color: 'var(--portal-accent)' }}
          onClick={() => setQuickAdd({ seg: 'expense' })} aria-label={L(dict, '记一笔(支出 / 收入 / 资产估值)', 'Quick add (expense / income / asset)')}>
          {L(dict, '＋记', '＋Add')}
        </button>
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>
      <QuickAddSheet open={quickAdd != null} initialSeg={quickAdd?.seg} initialAssetId={quickAdd?.assetId}
        currency={summary.currency || undefined} onClose={() => setQuickAdd(null)} onSaved={() => setRev((r) => r + 1)} />

      {/* ── 总览 ── */}
      {sub === 'overview' && (
        <>
          <div className="nesio-fin-plaidchip"><IconLock size={12} /> {L(dict, 'Plaid 流水 · 只存本机', 'Plaid feed · on-device only')}</div>
          {/* 冷冻仓入口:未上线时不渲染(免费/Pro 都不上);点击统一走 Portal 的 nesio-open-freeze 门 */}
          {isFreezeLaunched() && (
            <button type="button" className="nesio-fin-freeze-entry" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-freeze'))}>
              <IconSnowflake size={14} />
              <span>{L(dict, '想冲动买的,先冻起来 · 冷静期', 'Freeze an impulse buy · cool-off')}</span>
              <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--portal-muted)' }}>›</span>
            </button>
          )}
          <FamilyDataCard kind="spend" />
          {/* 数据新鲜度 + 被排除的其他币种笔数(如实告知,不假装是最新完整月/全部交易) */}
          {(() => {
            const syncedAt = loadBankSyncedAt();
            const excluded = excludedTxCount(txs, ym);
            if (!syncedAt && !excluded) return null;
            const dateStr = syncedAt ? new Date(syncedAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : '';
            return (
              <p className="nesio-fin-datanote" style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', margin: '0 0 0.5rem' }}>
                {syncedAt && L(dict, `数据截至 ${dateStr}`, `As of ${dateStr}`)}{netDelta !== null || spendDelta !== null ? ` · ${vsLabel}` : ''}
                {excluded > 0 && `${syncedAt ? ' · ' : ''}${L(dict, `另有 ${excluded} 笔其他币种未计入`, `${excluded} txn(s) in other currencies excluded`)}`}
              </p>
            );
          })()}
          {nessaSummary && (
            <div className="nesio-fin-nessa">
              <span className="nesio-fin-nessa-kicker" aria-hidden>{L(dict, '念', 'N')}</span>
              <span>{nessaSummary}</span>
            </div>
          )}
          {/* P1 净值 hero:Plaid + 手动资产(锚点),快照曲线(同步时落点,LOCF 语义,只回看) */}
          {(() => {
            const s = assetSummaryWithHoldings(accounts, holdings); // 投资账户无 balance 时用持仓市值兜底
            const manualNet = manualNetWorth(manualAssets);
            if (s.net === 0 && manualNet === 0) return null;
            const total = Math.round((s.net + manualNet) * 100) / 100;
            const pts = [...nwSeries].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60);
            const vals = pts.map((p) => p.plaidNet + p.manualNet);
            const min = Math.min(...vals), max = Math.max(...vals);
            const span = max - min || 1;
            const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(1, vals.length - 1)) * 300},${34 - ((v - min) / span) * 28}`).join(' ');
            return (
              <div className="nesio-fin-assets" style={{ marginBottom: '0.6rem' }}>
                <span className="nesio-fin-asset-l">{L(dict, '净资产 · 含手动资产', 'Net worth · incl. manual assets')}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: 'var(--text-h2)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total < 0 ? '-' : ''}{formatMoney(Math.abs(total), summary.currency)}</span>
                  {manualNet !== 0 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, `含手动 ${formatMoney(Math.abs(manualNet), summary.currency)}`, `manual ${formatMoney(Math.abs(manualNet), summary.currency)}`)}</span>}
                </div>
                {vals.length >= 2 && (
                  <svg viewBox="0 0 300 36" style={{ width: '100%', height: 36 }} aria-hidden>
                    <path d={path} fill="none" stroke="var(--portal-accent)" strokeWidth="2" />
                    <circle cx="300" cy={34 - ((vals[vals.length - 1] - min) / span) * 28} r="3" fill="var(--portal-accent)" />
                  </svg>
                )}
                {vals.length < 2 && <span className="nesio-fin-score-hint">{L(dict, '多同步几天,这里会长出净值曲线(每次同步记一个点)。', 'Sync a few more days and a net-worth curve grows here (one point per sync).')}</span>}
              </div>
            );
          })()}
          <div className="nesio-fin-kpis">
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '本月支出', 'This month')}</span><span className="nesio-fin-kpi-v">{formatMoney(grossSpend, summary.currency)}</span>{spendDelta !== null && <span className={`nesio-fin-delta${spendDelta > 0 ? ' up' : ' down'}`}>{spendDelta > 0 ? '+' : ''}{spendDelta}%</span>}</div>
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '净支出', 'Net spend')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.net, summary.currency)}</span>{netDelta !== null && <span className={`nesio-fin-delta${netDelta > 0 ? ' up' : ' down'}`}>{netDelta > 0 ? '+' : ''}{netDelta}%</span>}</div>
            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '收入', 'Income')}</span><span className="nesio-fin-kpi-v">{formatMoney(summary.income, summary.currency)}</span></div>
          </div>
          {domainSpend.count > 0 && (
            <>
              <p className="nesio-settings-section-label">{L(dict, '手动 / 小票 / 旅行', 'Manual / receipts / travel')}</p>
              <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.35rem' }}>
                {L(
                  dict,
                  `本月 ${domainSpend.count} 笔 · 约 ${domainSpend.total.toFixed(0)}${summary.domainCount ? ` · 其中 ${summary.domainCount} 笔同币种已并入上方支出` : ''}${summary.otherCurrencyCount ? ` · ${summary.otherCurrencyCount} 笔异币种另计` : ''}`,
                  `${domainSpend.count} this month · ~${domainSpend.total.toFixed(0)}${summary.domainCount ? ` · ${summary.domainCount} same-currency folded into KPIs` : ''}${summary.otherCurrencyCount ? ` · ${summary.otherCurrencyCount} other-currency aside` : ''}`,
                )}
              </p>
              <div className="nesio-fin-personspend" style={{ marginBottom: '0.8rem' }}>
                {domainRows.slice(0, 5).map((e) => {
                  // P1 小票对账:金额±1% + 日期±3天 + 商户词,给一条候选;「不是」进否决记忆。
                  const takenTxIds = new Set(loadDomainExpenses().map((x) => x.linkedBankTxId).filter((v): v is string => Boolean(v)));
                  const cand = receiptMatchCandidates(
                    { id: e.id, amount: e.amount, occurredAt: e.occurredAt, merchant: e.merchant },
                    txs, { rejected: rejectedPairs, taken: takenTxIds, max: 1 },
                  )[0];
                  return (
                    <div key={e.id}>
                      <div className="nesio-fin-person-row">
                        <span className="nesio-fin-person-name">{e.merchant || e.note || (e.source === 'travel' ? L(dict, '旅行', 'Travel') : L(dict, '小票', 'Receipt'))}</span>
                        <span className="nesio-fin-person-amt" style={e.kind === 'income' ? { color: 'var(--status-go)' } : undefined}>{e.kind === 'income' ? '+' : ''}{e.currency}{e.amount}</span>
                      </div>
                      {cand && (
                        <div className="nesio-fin-person-row" style={{ paddingLeft: '0.6rem' }}>
                          <span className="nesio-fin-person-name" style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>
                            {L(dict, `银行流水可能是同一笔:${cand.name.slice(0, 18)} · ${cand.date.slice(5)}`, `Likely same in bank feed: ${cand.name.slice(0, 18)} · ${cand.date.slice(5)}`)}
                          </span>
                          <button type="button" className="nesio-fin-monthnav" style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-accent)' }}
                            onClick={() => { if (linkExpenseToBankTx(e.id, cand.id)) setRev((r) => r + 1); else setReportMsg(L(dict, '关联没成功,刷新后再试。', 'Link failed — refresh and retry.')); }}>
                            {L(dict, '关联', 'Link')}
                          </button>
                          <button type="button" className="nesio-fin-monthnav" style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}
                            onClick={() => { rejectPair(e.id, cand.id); setRev((r) => r + 1); }}>
                            {L(dict, '不是', 'No')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '0.2rem' }}>{L(dict, '关联后小票变成那笔银行流水的明细,不再双计。', 'Linked receipts become detail of the bank txn — no double counting.')}</p>
              </div>
            </>
          )}
          {/* 财务⑯:收入构成(工资/利息/分红/退税…按 Plaid 细分类分桶) */}
          {summary.income > 0 && (() => {
            const ib = incomeBreakdown(txs, ym);
            if (!ib.length) return null;
            const parts = ib.slice(0, 4).map((s) => `${categoryDetailLabel(s.detail, dict) || L(dict, '其他收入', 'Other income')} ${formatMoney(s.total, summary.currency)}`);
            return <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.5rem', marginBottom: '0.5rem' }}>{L(dict, `收入构成:${parts.join(' · ')}`, `Income mix: ${parts.join(' · ')}`)}</p>;
          })()}
          <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>{L(dict, '收入 / 转账 / 信用卡还款 不计入收支;分错了到「交易」点类型改。', 'Income / transfers / card payments are excluded; fix any mislabels under Transactions.')}</p>

          {/* 消费 × 人:来自「关系 → 挂一条」记的消费(真数据,只存本机)*/}
          {personSpend.length > 0 && (
            <>
              <p className="nesio-settings-section-label">{L(dict, '消费 × 人', 'Spending × people')}</p>
              <div className="nesio-fin-personspend">
                {personSpend.map((p) => (
                  <div key={p.key} className="nesio-fin-person-row">
                    <span className="nesio-fin-person-av" aria-hidden>{Array.from(p.name.trim())[0] || '·'}</span>
                    <span className="nesio-fin-person-name">{p.name}{p.title ? ` · ${p.title}` : ''}</span>
                    <span className="nesio-fin-person-amt">{formatMoney(p.total, summary.currency)}</span>
                  </div>
                ))}
              </div>
              <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, '来自你在「关系 → 挂一条」记的消费,仅你可见。', 'From spending you logged under People → attach; visible only to you.')}</p>
            </>
          )}

          {(findings.length > 0 || review.length > 0) && (
            <>
              <p className="nesio-settings-section-label">{L(dict, '风险预警', 'Risk alerts')}</p>
              <div className="nesio-fin-alerts">
                {/* 统一判定(financeFindings):flag=真实风险 → risk 红;attention=可关注 → warn 琥珀 */}
                {findings.map((f) => {
                  // P2 尾巴:findings 可点 —— 按 kind 跳到能采取行动的子页(死文字 → 入口)
                  const FINDING_SUB: Record<string, Sub> = {
                    anomaly: 'tx', fee_audit: 'tx',
                    subscription_hike: 'recurring', new_recurring: 'recurring', upcoming_bill: 'recurring',
                    cash_runway: 'cards', balance_risk: 'cards', savings_rate: 'spending',
                  };
                  const target = FINDING_SUB[f.kind];
                  const inner = (
                    <>
                      <p className="nesio-fin-alert-title">{L(dict, f.title[0], f.title[1])}{target ? ' ›' : ''}</p>
                      <p className="nesio-fin-alert-body">{L(dict, f.detail[0], f.detail[1])}</p>
                    </>
                  );
                  return target ? (
                    <button key={f.id} type="button" onClick={() => setSub(target)}
                      className={`nesio-fin-alert nesio-fin-alert--${f.severity === 'flag' ? 'risk' : 'warn'}`}
                      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                      {inner}
                    </button>
                  ) : (
                    <div key={f.id} className={`nesio-fin-alert nesio-fin-alert--${f.severity === 'flag' ? 'risk' : 'warn'}`}>{inner}</div>
                  );
                })}
                {/* 待归类是页面工作流提示(不是域判定),不进统一层,单独保留 */}
                {review.length > 0 && (
                  <div className="nesio-fin-alert nesio-fin-alert--info">
                    <p className="nesio-fin-alert-title">{L(dict, `${review.length} 笔交易待归类`, `${review.length} transaction(s) to categorize`)}</p>
                    <p className="nesio-fin-alert-body">{L(dict, '未匹配到分类的交易在「交易 → 规则审核」等你处理', 'Uncategorized transactions are waiting under Transactions → Review')}</p>
                  </div>
                )}
              </div>
              <p className="nesio-fin-alert-note">{L(dict, '预警按规则算(非 LLM):与 Today / 问一问 同一套判定', 'Rule-based (not LLM) — the same findings Today and Ask use')}</p>
            </>
          )}

          {trend.length > 1 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-6)' }}>{L(dict, '月度趋势 · 净支出与启发', 'Monthly trend · net spend + insight')}</p>
              {(() => {
                const max = Math.max(...trend.map((x) => x.net), 1);
                const last = trend[trend.length - 1];
                const prev = trend[trend.length - 2];
                const delta = prev && prev.net > 0 ? Math.round(((last.net - prev.net) / prev.net) * 100) : null;
                const narrative = delta == null
                  ? L(dict, '多记几个月,这里会出现「比上月怎样」的一句话。', 'A few more months unlock a one-line vs-last-month story.')
                  : delta > 8
                    ? L(dict, `本月净支出比上月高约 ${delta}% —— 值得扫一眼分类里哪块在涨。`, `Net spend is ~${delta}% above last month — glance which category rose.`)
                    : delta < -8
                      ? L(dict, `本月净支出比上月低约 ${Math.abs(delta)}% —— 节奏在往下走。`, `Net spend is ~${Math.abs(delta)}% below last month — the pace is easing.`)
                      : L(dict, '本月净支出与上月接近 —— 先稳住再说。', 'Net spend is close to last month — hold steady.');
                // P3 图表统一:去双重编码(原面积图+柱图画同一份数据,纯冗余)——只留柱
                // (带月份标签与数值,断档月天然可见);小值不再抬高到 4%(破坏比例)。
                return (
                  <>
                    <p className="nesio-fin-insight-line">{narrative}</p>
                    <div className="nesio-fin-trend">
                      {trend.map((t, i) => {
                        const prevMonth = trend[i - 1];
                        const gapBefore = prevMonth && prevYm(t.ym) !== prevMonth.ym; // 断档月:标记不连续,别画成相邻
                        return (
                          <div key={t.ym} className="nesio-fin-trend-col" style={gapBefore ? { borderLeft: '1px dashed var(--portal-line)', marginLeft: 2, paddingLeft: 2 } : undefined}>
                            <span className="nesio-fin-trend-val">{formatMoney(t.net, summary.currency)}</span>
                            <div className="nesio-fin-trend-bar-wrap"><div className={`nesio-fin-trend-bar${t.ym === ym ? ' is-cur' : ''}`} style={{ height: `${Math.max(1, Math.round((Math.max(0, t.net) / max) * 100))}%` }} /></div>
                            <span className="nesio-fin-trend-lbl">{t.ym.slice(5)}{gapBefore ? '·' : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
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

          {/* 财务㉓:月报 —— 报告级 Markdown,可下载 / 存入记忆(问一问可检索) */}
          <div className="nesio-fin-budget-add" style={{ marginTop: '1.25rem' }}>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              try {
                // 财务㉜:下载=彩色图文 HTML(自包含,双击即看,浏览器里还能打印成 PDF)
                const blob = new Blob([reportRichHtml(txs, accounts, ym, dict)], { type: 'text/html;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `finance-report-${ym}.html`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                setReportMsg(L(dict, `已下载 ${ym} 彩色月报(.html,双击打开)`, `Visual report for ${ym} downloaded (.html)`));
              } catch { setReportMsg(L(dict, '月报生成失败,请重试', 'Report failed — try again')); }
            }}>{L(dict, '下载彩色月报', 'Download report')}</button>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              try {
                const r = buildMonthlyReport(txs, accounts, ym, dict, new Date(), { domainNet: summary.domainNet, prevDomainNet: prevSummary.domainNet });
                const outcome = persistReportToMemory(r);
                setReportMsg(outcome === 'created'
                  ? L(dict, `已把 ${r.ym} 月报存入记忆,「问一问」可检索`, `Report ${r.ym} saved to memory — Ask can cite it`)
                  : L(dict, `已更新记忆里的 ${r.ym} 月报`, `Updated the ${r.ym} report in memory`));
              } catch { setReportMsg(L(dict, '存入记忆失败,请重试', 'Save to Memory failed — try again')); }
            }}>{L(dict, '存入记忆', 'Save to Memory')}</button>
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
        </>
      )}

      {/* ── 支出:分类 + 商户 Top + 收入来源 ── */}
      {sub === 'spending' && (
        <>
          {cats.length > 0 ? (
            <>
              {/* 分类支出环形图 */}
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
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, `支出分类 · 共 ${formatMoney(cats.reduce((s, c) => s + c.total, 0), summary.currency)}`, `Spending · ${formatMoney(cats.reduce((s, c) => s + c.total, 0), summary.currency)}`)}</p>
              <div className="nesio-fin-cats">
                {cats.map((c) => (
                  <div key={c.category} className="nesio-fin-cat">
                    <div className="nesio-fin-cat-top"><span className="nesio-fin-cat-name">{categoryLabel(c.category, dict)}</span><span className="nesio-fin-cat-amt">{formatMoney(c.total, summary.currency)} <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}>{c.pct}%</span>{c.deltaPct !== null ? <span className={`nesio-fin-delta${c.deltaPct > 0 ? ' up' : ' down'}`}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%</span> : c.isNew ? <span className="nesio-fin-delta is-new">{L(dict, '新增', 'new')}</span> : null}</span></div>
                    <div className="nesio-fin-bar"><div className="nesio-fin-bar-fill" style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '这个月还没有可统计的支出。', 'No spending to break down this month yet.')}</p>
          )}

          {merchants.length > 0 && (<>
            <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '商户 Top', 'Top merchants')}</p>
            <div className="nesio-fin-merchants">
              {merchants.map((m) => (
                <div key={m.name} className="nesio-fin-merchant"><span className="nesio-fin-merchant-name">{m.logo && <MLogo src={m.logo} />}{m.name}</span><span className="nesio-fin-merchant-right"><span className="nesio-fin-merchant-amt">{formatMoney(m.total, summary.currency)}</span><span className="nesio-fin-merchant-cnt">{L(dict, `${m.count} 笔`, `${m.count}×`)}</span></span></div>
              ))}
            </div>
          </>)}

          {/* 收入来源(按 Plaid 细分类分桶) */}
          {summary.income > 0 && (() => {
            const ib = incomeBreakdown(txs, ym);
            if (!ib.length) return null;
            return (<>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '收入来源', 'Income sources')}</p>
              <div className="nesio-fin-merchants">
                {ib.map((s) => (
                  <div key={s.detail} className="nesio-fin-merchant">
                    <span className="nesio-fin-merchant-name">{categoryDetailLabel(s.detail, dict) || L(dict, '其他收入', 'Other income')}</span>
                    <span className="nesio-fin-merchant-right"><span className="nesio-fin-merchant-amt" style={{ color: 'var(--status-go)' }}>+{formatMoney(s.total, summary.currency)}</span></span>
                  </div>
                ))}
              </div>
            </>);
          })()}
        </>
      )}

      {/* ── 交易:规则审核 + 筛选 + 明细 ── */}
      {sub === 'tx' && (
        <>
          {review.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, `规则审核 · ${review.length} 笔待归类`, `Review · ${review.length} to categorize`)}</p>
              {/* P3 纠错闭环:批量「全部按建议」(原来一次只出 1 笔,12 笔要点 12 次) */}
              {review.length > 1 && (
                <button type="button" className="nesio-fin-review-accept" style={{ marginBottom: '0.4rem' }}
                  onClick={() => { for (const t of review) setMerchantRuleFor(t, suggestCategory(t.name).category); setRev((r) => r + 1); }}>
                  {L(dict, `全部按建议归类(${review.length} 笔,每笔都可再改)`, `Accept all suggestions (${review.length}, each editable later)`)}
                </button>
              )}
              {review.slice(0, 3).map((t) => {
                const sug = suggestCategory(t.name);
                return (
                  <div key={t.id} className="nesio-fin-review">
                    <p className="nesio-fin-review-title">{t.name} · {formatMoney(t.amount, summary.currency)}</p>
                    {/* 规则命中的置信度是写死的常数(0.72/0.4),与证据量无关,不该以百分比精度冒充"可信度";改定性措辞。 */}
                    <p className="nesio-fin-review-sug">{L(dict, `建议分类:${categoryLabel(sug.category, 'zh')}${sug.confidence >= 0.6 ? '(关键词匹配)' : '(默认猜测)'}`, `Suggested: ${categoryLabel(sug.category, 'en')}${sug.confidence >= 0.6 ? ' (keyword match)' : ' (default guess)'}`)}</p>
                    <div className="nesio-fin-review-btns">
                      <button type="button" className="nesio-fin-review-accept" onClick={() => resolveReview(t, sug.category)}>{L(dict, '接受', 'Accept')}</button>
                      {COMMON_EXPENSE_CATEGORIES.filter((c) => c !== sug.category).slice(0, 2).map((c) => (
                        <button key={c} type="button" className="nesio-fin-review-alt" onClick={() => resolveReview(t, c)}>{categoryLabel(c, dict)}</button>
                      ))}
                      {/* P3:原「排除」实为归类 OTHER(仍计入支出),文案骗人 —— 改真语义:不计收支(转账流) */}
                      <button type="button" className="nesio-fin-review-skip" onClick={() => { setFlowRuleFor(t, 'transfer'); setRev((r) => r + 1); }}>{L(dict, '不计收支', 'Not spend')}</button>
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
                        <button key={opt} type="button" className={`nesio-fin-flowopt${f === opt ? ' is-active' : ''}`} onClick={() => applyFlow(t, opt)}>{L(dict, TX_FLOW_LABELS[opt][0], TX_FLOW_LABELS[opt][1])}</button>
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
                    <span className="nesio-fin-rule-txt">{learnedRules.labels[name] || name} <span className="nesio-fin-rule-arrow">→</span> {categoryLabel(cat, dict)}</span>
                    <button type="button" className="nesio-fin-rule-x" onClick={() => removeMerchantRule(name)} aria-label={L(dict, '删除规则', 'Remove rule')}>✕</button>
                  </div>
                ))}
                {Object.entries(learnedRules.flow).map(([name, flow]) => (
                  <div key={`f-${name}`} className="nesio-fin-rule">
                    <span className="nesio-fin-rule-txt">{learnedRules.labels[name] || name} <span className="nesio-fin-rule-arrow">→</span> {L(dict, TX_FLOW_LABELS[flow][0], TX_FLOW_LABELS[flow][1])}</span>
                    <button type="button" className="nesio-fin-rule-x" onClick={() => removeFlowRule(name)} aria-label={L(dict, '删除规则', 'Remove rule')}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── 交易续:识别到的定期账单(并入交易页)── */}
      {sub === 'tx' && (
        <>
          {upcoming.items.length > 0 && (
            <div className="nesio-fin-recur-hero">
              <span className="nesio-fin-recur-hero-l">{L(dict, `未来 7 天 · ${upcoming.items.length} 笔定期扣款`, `Next 7 days · ${upcoming.items.length} recurring`)}</span>
              <span className="nesio-fin-recur-hero-v">{formatMoney(upcoming.total, summary.currency)}</span>
            </div>
          )}
          <p className="nesio-settings-section-label" style={{ marginTop: upcoming.items.length ? '1rem' : 0 }}>{L(dict, '识别到的定期账单', 'Detected recurring bills')}</p>
          {recurring.length === 0 ? (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '还没识别到定期账单 —— 同一商户 2 笔规律扣款(或知名订阅品牌 1 笔)就会以「待确认」出现,3 笔转正。新连接的银行,完整历史会在几天内陆续回填,期间隔天点一次「同步」即可。', 'No recurring bills yet — 2 regular charges per merchant (or 1 from a known subscription brand) show up as "unconfirmed" and are confirmed after 3 charges. Newly linked banks backfill history over a few days; sync again occasionally.')}</p>
          ) : (
            <div className="nesio-fin-recurlist">
              {recurring.map((r) => (
                <div key={r.name} className="nesio-fin-recur">
                  <div className="nesio-fin-recur-main">
                    <span className="nesio-fin-recur-name">{r.logo && <MLogo src={r.logo} />}{r.name}{r.status === 'predicted' && <span className="nesio-fin-recur-badge">{L(dict, '待确认', 'unconfirmed')}</span>}{hikeByKey.has(r.key) && (() => { const h = hikeByKey.get(r.key)!; return <span className="nesio-fin-recur-badge" style={{ color: 'var(--status-gentle)', borderColor: 'var(--status-gentle)' }} title={L(dict, `从 ${formatMoney(h.from, h.currency)} 涨到 ${formatMoney(h.to, h.currency)}`, `up from ${formatMoney(h.from, h.currency)} to ${formatMoney(h.to, h.currency)}`)}>{L(dict, `↑涨价 ${h.deltaPct}%`, `↑ up ${h.deltaPct}%`)}</span>; })()}</span>
                    <span className="nesio-fin-recur-meta">{L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {categoryLabel(r.category, dict)} · {L(dict, `下次约 ${r.nextEstimate.slice(5).replace('-', '/')}`, `next ~${r.nextEstimate.slice(5).replace('-', '/')}`)} · {L(dict, `${r.count} 笔`, `${r.count}×`)}{r.status === 'predicted' ? L(dict, ' · 再出现 1 期自动转正', ' · confirms after next cycle') : ''}</span>
                  </div>
                  <span className="nesio-fin-recur-amt">{formatMoney(r.avgAmount, r.currency)}</span>
                  <button type="button" className="nesio-fin-rule-x" onClick={() => markNotRecurring(r.key)} aria-label={L(dict, '不是定期', 'Not recurring')} title={L(dict, '标为「不是定期」', 'Mark not recurring')}>✕</button>
                </div>
              ))}
            </div>
          )}
          <p className="nesio-fin-alert-note">{L(dict, '按流水周期规则识别(非 LLM),下次日期与金额为估算', 'Rule-based from transaction cadence (not LLM); next date & amount are estimates')}</p>
        </>
      )}

      {/* ── 预算(并入总览页)── */}
      {sub === 'overview' && (() => {
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
                {total.ratio > 1 && <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>{L(dict, `超出 ${Math.round((total.ratio - 1) * 100)}%`, `${Math.round((total.ratio - 1) * 100)}% over`)}</p>}
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
                  <span className="nesio-fin-kpi-l">{L(dict, '收入', 'Income')}</span>
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

      {/* ── 卡片:净资产 hero + 存款 / 投资 / 负债 分组 ── */}

      {/* P2 订阅监控(P3 拆分 → RecurringPane) */}
      {sub === 'recurring' && <RecurringPane txs={txs} recurring={recurring} currency={summary.currency} dict={dict} />}
      {/* P2 投资(P3 拆分 → InvestPane) */}
      {sub === 'invest' && <InvestPane txs={txs} holdings={holdings} nwSeries={nwSeries} currency={summary.currency} dict={dict} />}
      {/* 账户页(P3 拆分 → CardsPane:Plaid 分组 + 资产小结 + 持仓 + 手动资产) */}
      {sub === 'cards' && (
        <CardsPane txs={txs} accounts={accounts} holdings={holdings} manualAssets={manualAssets}
          ym={ym} currency={summary.currency} dict={dict}
          onQuickAddAsset={(assetId) => setQuickAdd({ seg: 'asset', ...(assetId ? { assetId } : {}) })} onChanged={() => setRev((r) => r + 1)} />
      )}

      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>{L(dict, '流水明细只存本机 · 随时可断开', 'Details stay on-device · disconnect anytime')}</p>
    </div>
  );
}
