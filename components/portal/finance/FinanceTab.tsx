'use client';

/**
 * FinanceTab — 财务(批次 29,批次 31 增强)。洞察里「财务」tab。
 * 子分类:总览(KPI + 风险预警 + 月度趋势)/ 支出(分类+商户)/ 交易(筛选+规则审核)/ 卡片(分卡)。
 * 读本机 Plaid 流水(nesio-bank-tx-v1)+ 账户(nesio-bank-accounts-v1)。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import FamilyDataCard from '../relationships/FamilyDataCard';
import {
  availableMonths, categoryBreakdown,
  needsReview, suggestCategory, setMerchantRule, effectiveCategory, effectiveCategoryDetail,
  formatMoney, ymOf, prevYm, txFlow, setFlowRule, TX_FLOW_LABELS,
  detectRecurring, upcomingRecurring, loadMerchantRules, loadFlowRules, setRecurRule,
  loadBankSyncedAt, excludedTxCount, internalAdjustmentIds, accountTypeLabel, assetSummaryWithHoldings, expenseMerchants,
  loadHoldings, setMerchantRuleFor, setFlowRuleFor, loadRuleLabels,
  bankDataReady, loadBankSyncStatus, loadAccountNames, displayAccountName,
  type BankTx, type BankAccount, type TxFlow, type Holding,
} from '@/lib/portal/bank-tx';
// 风险预警与 Today/问一问 同读一份判定(financeFindings,Layer1 漂移收口)——此前 bank-tx 里
// 另有一套 alerts 判定(函数级双实现),两个输出面据同一份流水各说各话,已删并由契约钉死不回潮。
import { financeFindings } from '@/lib/portal/finance-insight';
import { computeFinanceScores } from '@/lib/portal/finance-risk';
import { detectIncome, portfolioSummary, recurringPriceHikes } from '@/lib/portal/finance-features';
import { loadCombinedFinanceTx, loadCombinedFinanceAccounts } from '@/lib/portal/tesla-finance';
import QuickAddSheet from './QuickAddSheet';
import ReconcileSheet from './ReconcileSheet';
import RefundPairs from './RefundPairs';
import CardsPane from './CardsPane';
import AcctLogo from './AcctLogo';
import InvestPane from './InvestPane';
import NesioSheet from '../ui/NesioSheet';
import { listManualAssets, manualNetWorth, loadNetWorthSeries, finAssetsReady, FIN_ASSETS_EVENT, type ManualAsset } from '@/lib/portal/finance-assets';
import { listInventoryItems } from '@/lib/portal/inventory';
import { receiptMatchCandidates, rejectPair, loadRejectedPairs } from '@/lib/portal/receipt-match';
import { linkExpenseToBankTx, loadDomainExpenses } from '@/lib/portal/finance-sources';
import { domainExpenseTotal, listExpenses, EXPENSES_EVENT, type Expense } from '@/lib/portal/finance-sources';
import { financeMonthAggregate } from '@/lib/portal/finance-aggregate';
import { loadBudget, saveBudget, hasBudget, suggestBudget, budgetProgress, type BudgetConfig } from '@/lib/portal/finance-budget';
import { buildMonthlyReport, persistReportToMemory, autoPersistLastMonthReport } from '@/lib/portal/finance-report';
import { reportRichHtml } from '@/lib/portal/finance-report-visual';
import { categoryLabel, categoryDetailLabel, COMMON_EXPENSE_CATEGORIES, detailsForPrimary } from '@/lib/portal/tx-category';
import { splitEvenly } from '@/lib/portal/ledger-allocation';
import {
  loadTxAnnotations, txAnnotationOf, hasTxAnnotation, setTxPeople, setTxNote,
  addTxAttachment, removeTxAttachment, TX_ANNOTATIONS_EVENT, type TxAnnotation, type TxWriteResult,
  setTxSplits, clearTxSplits, setTxAmortize, clearTxAmortize, setTxCategory,
  setTxTrip, setTxTripNode, setTxMemoryNode, setTxAsset, setTxProject,
} from '@/lib/portal/tx-annotations';
import { putLocalFile, prettyBytes, MAX_FILE_BYTES } from '@/lib/portal/local-file-store';
import { getLifeGraph, searchLifeGraphFuzzy } from '@/lib/portal/life-graph';
import { buildRelationships } from '@/lib/portal/relationships';
import { loadTrips, recomputeBudgetNode, type Trip } from '@/lib/portal/travel-trips';
import { getProjects, type Project } from '@/lib/portal/project';
import { visibleMemoryNodes } from '@/lib/portal/memory-visibility';
import { memoryEventAt } from '@/lib/portal/memory-event-at';
import { IconLock, IconSnowflake } from '../icons';
import { isFreezeLaunched } from '@/lib/portal/entitlement';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'overview' | 'spending' | 'tx' | 'invest' | 'cards'; // 订阅 tab 已删(定期账单在交易页);预算在支出页渲染

/** 财务批注「关联人」候选:核心 / 亲近 / 家人关系,不含一般熟人。 */
function isFinancePickContact(c: { closeness: string; relation: string | null }): boolean {
  if (c.closeness === 'core' || c.closeness === 'close') return true;
  const r = c.relation || '';
  return /家人|亲人|配偶|伴侣|父|母|爸|妈|儿|女|兄|弟|姐|妹|family|spouse|partner|parent|child|sibling/i.test(r);
}

function monthLabel(ym: string, dict: string): string {
  const [y, m] = ym.split('-');
  return dict === 'en'
    ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : `${y} 年 ${Number(m)} 月`;
}

// 批次 40:分类支出环形图(纯 SVG,无依赖)
// 类别色走设计系统的 --viz-*(见 globals.css 那段说明):换皮肤时饼图跟着变饱和度,
// 而 8 个色相位仍然分散 —— 相邻扇区还是分得开。原来这 8 个是写死的 hex,换肤纹丝不动。
const DONUT_COLORS = Array.from({ length: 8 }, (_, i) => `var(--viz-${i + 1})`);
function FinanceDonut({ slices, centerTop, centerVal, onSlice, activeCategory, big }: {
  slices: Array<{ category: string; pct: number }>; centerTop: string; centerVal: string;
  /** bug2:环形可交互 —— 点扇区回调(再点同一块取消);不传则纯展示。 */
  onSlice?: (category: string) => void; activeCategory?: string | null;
  /** bug3「饼图调大」:主视图用大号(半径 +26%),小卡里仍用原尺寸。 */
  big?: boolean;
}) {
  const R = big ? 66 : 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  // P3 图表统一:与月报(finance-report-visual)同口径 —— 前 6 类 + 其余合并「其他」,
  // 修「屏幕版第 9 类以后直接消失、环上出现空缺」的双口径。
  const top = slices.slice(0, 6);
  const restPct = slices.slice(6).reduce((s, x) => s + x.pct, 0);
  const shown = restPct > 0 ? [...top, { category: 'OTHER_REST', pct: restPct }] : top;
  // 大号时整体等比放大:viewBox / 中心点 / 环宽 / 字号都跟着 R 走,别只改半径把环挤出画布。
  const VB = big ? 176 : 140;
  const HALF = VB / 2;
  const SW = big ? 18 : 14;
  return (
    <svg viewBox={`0 0 ${VB} ${VB}`} width={big ? 168 : 132} height={big ? 168 : 132} style={{ display: 'block', margin: '0 auto' }}>
      <g transform={`translate(${HALF},${HALF}) rotate(-90)`}>
        <circle r={R} fill="none" stroke="var(--portal-line)" strokeWidth={SW} />
        {shown.map((s, i) => {
          const len = (s.pct / 100) * C;
          const dim = activeCategory && activeCategory !== s.category;
          const seg = (
            <circle key={s.category} r={R} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={activeCategory === s.category ? SW + 4 : SW} strokeLinecap="butt"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}
              opacity={dim ? 0.35 : 1}
              style={onSlice ? { cursor: 'pointer' } : undefined}
              onClick={onSlice ? () => onSlice(s.category) : undefined} />
          );
          acc += len;
          return seg;
        })}
      </g>
      <text x={HALF} y={HALF - 5} textAnchor="middle" fontSize={big ? 10 : 8.5} fill="var(--portal-muted)" style={{ fontFamily: 'var(--font-sans)' }}>{centerTop}</text>
      <text x={HALF} y={HALF + 12} textAnchor="middle" fontSize={big ? 17 : 14} fontWeight="800" fill="var(--portal-ink)" style={{ fontFamily: 'var(--font-sans)' }}>{centerVal}</text>
    </svg>
  );
}

/** 财务⑩:机构 logo(Plaid base64;缺失用机构/账户名首字母色块,底色用机构主色)。 */

/** 财务⑲:商户 logo(Plaid 富化 URL;缺失由调用方不渲染,不占位)。 */
function MLogo({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="nesio-fin-mlogo" src={src} alt="" width={16} height={16} loading="lazy" />;
}

/**
 * bug3「交易里的每一笔流水增加修改选择,我可以手动关联人,传附件等」——
 * 展开在流水行下面的编辑区:①改流向 ②分类/子分类 ③关联人 ④附件 ⑤备注。
 *
 * 关联人/附件/备注存 tx-annotations 覆盖层(按 tx.id),下一次 Plaid 同步不会冲掉;
 * 附件本体进 local-file-store(IndexedDB)。写失败一律出可见错误,不假成功。
 */
/**
 * TxSplitEditor — 一笔支出分摊到多个分类/人;年费按月摊。
 *
 * 两条规矩写在 UI 上而不只在数据层:
 *   · **差一分都不存**。`validateAllocation` 返回 delta,这里直接显示「还剩 $x 要摊」——
 *     只说「合计不对」的话你不知道还差多少。
 *   · **分摊不改原额**。它是视图:总额聚合永远读原额,只有按分类/按人汇总才走分摊。
 *     两边都算就是同一笔钱按两套口径各算一次。
 */
function TxSplitEditor({ txId, total, dict, contacts, onChanged }: {
  txId: string; total: number; dict: string;
  contacts: Array<{ key: string; name: string }>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ target: string; amount: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [months, setMonths] = useState('');

  const existing = txAnnotationOf(txId).splits || [];
  const amort = txAnnotationOf(txId).amortize;

  const start = () => {
    setRows(existing.length
      ? existing.map((s) => ({ target: s.target, amount: String(s.amount) }))
      : splitEvenly(total, 2).map((s) => ({ target: '', amount: String(s.amount) })));
    setOpen(true); setErr(null); setSaved(false);
  };

  const save = () => {
    setSaved(false);
    const parsed = rows
      .map((r) => ({ target: r.target.trim(), amount: Number(r.amount) }))
      .filter((r) => r.target || r.amount);
    const r = setTxSplits(txId, total, parsed);
    if (r.ok) { setErr(null); setSaved(true); setOpen(false); onChanged(); return; }
    setErr(
      r.reason === 'sum_mismatch'
        ? (r.delta > 0
            ? L(dict, `还剩 ${r.delta.toFixed(2)} 没分完。`, `${r.delta.toFixed(2)} still to allocate.`)
            : L(dict, `分多了 ${Math.abs(r.delta).toFixed(2)}。`, `Over-allocated by ${Math.abs(r.delta).toFixed(2)}.`))
        : r.reason === 'duplicate_target' ? L(dict, '同一个去处出现了两次 —— 合起来写一行更清楚。', 'Same target twice — merge them into one row.')
        : r.reason === 'nonpositive' ? L(dict, '每一份都要大于 0。', 'Every share must be greater than 0.')
        : r.reason === 'empty' ? L(dict, '先填一行。', 'Add a row first.')
        : L(dict, '没存进去,可能空间满了。', "Couldn't save — storage may be full."),
    );
  };

  return (
    <div className="nesio-fin-txedit-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button type="button" className={`nesio-fin-flowopt${existing.length ? ' is-active' : ''}`} onClick={() => (open ? setOpen(false) : start())}>
          {existing.length
            ? L(dict, `已分摊 ${existing.length} 份`, `Split ${existing.length} ways`)
            : L(dict, '分摊', 'Split')}
        </button>
        {existing.length > 0 && (
          <button type="button" className="nesio-fin-flowopt" onClick={() => { clearTxSplits(txId); onChanged(); setOpen(false); }}>
            {L(dict, '撤销分摊', 'Undo split')}
          </button>
        )}
        {/* 按月摊:年费/保险。同样不生成新交易,原额不动。 */}
        <input className="nesio-fin-split-months" inputMode="numeric" placeholder={L(dict, '按月摊(月数)', 'Amortize (months)')}
          value={months} onChange={(e) => setMonths(e.target.value)}
          onBlur={() => {
            const m = Number(months);
            if (!months.trim()) return;
            if (!Number.isFinite(m) || m < 1) { setErr(L(dict, '月数要是大于 0 的整数。', 'Months must be a positive number.')); return; }
            const now = new Date();
            const ok = setTxAmortize(txId, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, Math.round(m));
            if (!ok) setErr(L(dict, '没存进去,可能空间满了。', "Couldn't save — storage may be full."));
            else { setErr(null); onChanged(); }
          }} />
        {amort && (
          <button type="button" className="nesio-fin-flowopt is-active" onClick={() => { clearTxAmortize(txId); onChanged(); }}>
            {L(dict, `每月摊 ${amort.months} 期 ✕`, `${amort.months}-month amortize ✕`)}
          </button>
        )}
      </div>

      {open && (
        <div className="nesio-fin-split-rows">
          {rows.map((r, i) => (
            <div key={i} className="nesio-fin-split-row">
              <input className="nesio-fin-split-target" placeholder={L(dict, '分类 / 人', 'Category / person')}
                list="nesio-split-targets" value={r.target}
                onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
              <input className="nesio-fin-split-amt" inputMode="decimal" placeholder="0.00" value={r.amount}
                onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <button type="button" className="nesio-fin-flowopt" aria-label={L(dict, '删这一行', 'Remove row')}
                onClick={() => setRows((v) => v.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <datalist id="nesio-split-targets">
            {contacts.slice(0, 24).map((c) => <option key={c.key} value={c.name} />)}
          </datalist>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button type="button" className="nesio-fin-flowopt" onClick={() => setRows((v) => [...v, { target: '', amount: '' }])}>
              {L(dict, '加一份', 'Add share')}
            </button>
            <button type="button" className="nesio-fin-flowopt" onClick={() => setRows(splitEvenly(total, Math.max(2, rows.length)).map((s, i) => ({ target: rows[i]?.target || '', amount: String(s.amount) })))}>
              {L(dict, '平均分', 'Split evenly')}
            </button>
            <button type="button" className="nesio-fin-flowopt is-active" onClick={save}>{L(dict, '存', 'Save')}</button>
          </div>
        </div>
      )}
      {err && <p className="nesio-claim-err" role="alert">{err}</p>}
      {saved && <p className="nesio-fin-score-hint">{L(dict, '分摊已存 —— 按分类汇总时会用它。', 'Split saved — category totals will use it.')}</p>}
    </div>
  );
}

function TxEditPanel({ txId, txAmount, flow, dict, onFlow, contacts, trips, memoryNodes, projects, financeAssets, inventoryItems, tx, onCategoryChanged }: {
  txId: string;
  /** 这一笔的原额(绝对值)。分摊要拿它卡合计 —— 差一分都不存。 */
  txAmount: number;
  flow: TxFlow;
  dict: string;
  onFlow: (f: TxFlow) => void;
  contacts: Array<{ key: string; name: string }>;
  trips: Trip[];
  memoryNodes: Array<{ id: string; name: string }>;
  projects: Project[];
  financeAssets: ManualAsset[];
  /** 物品库(耳机等)—— assetId 自由字符串,与手动财产共用字段,id 前缀本就不撞(fin-asset- / node-)。 */
  inventoryItems: Array<{ id: string; name: string }>;
  tx: BankTx;
  onCategoryChanged?: () => void;
}) {
  const [ann, setAnn] = useState<TxAnnotation>(() => txAnnotationOf(txId));
  const [note, setNote] = useState(() => txAnnotationOf(txId).note || '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memQ, setMemQ] = useState('');
  const pickRef = useRef<HTMLInputElement>(null);
  /** 端上从发票上读出来的话。「这张票上写的是多少」和这笔钱对不对得上,是挂发票的**全部意义**。 */
  const [scanNote, setScanNote] = useState<{ text: string; mismatch: boolean } | null>(null);
  const curCat = effectiveCategory(tx);
  const curDetail = effectiveCategoryDetail(tx);
  const [catDraft, setCatDraft] = useState(curCat);
  const [detailDraft, setDetailDraft] = useState(curDetail);
  const [customCat, setCustomCat] = useState('');
  const [customDetail, setCustomDetail] = useState('');
  const failed = L(dict, '这一下没存进本机 —— 可能空间满了,清点空间再试。', 'Not saved on this device — storage may be full.');

  const saveCategory = (nextCat: string, nextDetail: string) => {
    const ok = setTxCategory(txId, nextCat, nextDetail);
    setErr(ok ? null : failed);
    if (ok) {
      setAnn(txAnnotationOf(txId));
      setCatDraft(nextCat);
      setDetailDraft(nextDetail);
      onCategoryChanged?.();
    }
  };

  const people = ann.people || [];
  const linkedPerson = people[0] || '';
  const atts = ann.attachments || [];
  const nameOf = (key: string) => contacts.find((c) => c.key === key)?.name
    || (/[a-z]/i.test(key) ? key.replace(/\b\w/g, (m) => m.toUpperCase()) : key);

  const savePersonLink = (key: string) => {
    const k = key.trim().toLowerCase();
    const r = setTxPeople(txId, k ? [k] : []);
    if (!r.ok) setErr(failed);
    else if (!r.graphOk && k) {
      setErr(
        r.reason === 'no_person_node'
          ? L(dict, `已记在这笔交易上。不过「${nameOf(k)}」还不是通讯录里的联系人,所以 TA 的关系页暂时看不到这笔钱 —— 去关系页把 TA 加进来就会自动接上。`,
               `Saved on this transaction. “${nameOf(k)}” isn't a contact yet, so it won't show on their page — add them in People and it'll connect.`)
          : r.reason === 'no_tx_node'
            ? L(dict, '已记在这笔交易上。这笔流水还没同步进记忆,所以暂时只有财务页看得到 —— 下次同步后会自动补上。',
                 "Saved here. This transaction hasn't synced into memory yet, so only Finance shows it for now — the next sync will connect it.")
            : L(dict, '已记在这笔交易上,但没能连到记忆里 —— 别处暂时看不到。',
                 "Saved here, but couldn't connect it to memory — other pages won't show it yet."),
      );
    } else setErr(null);
    setAnn(txAnnotationOf(txId));
  };

  const saveLinkWrite = (r: TxWriteResult, emptyGraphHint?: string) => {
    if (!r.ok) setErr(failed);
    else if (!r.graphOk) {
      setErr(emptyGraphHint || L(dict, '已记在这笔交易上,但没能连到记忆里 —— 别处暂时看不到。',
        "Saved here, but couldn't connect it to memory — other pages won't show it yet."));
    } else setErr(null);
    setAnn(txAnnotationOf(txId));
  };

  const saveLinkField = (setter: (id: string, v: string) => TxWriteResult, value: string, emptyGraphHint?: string) => {
    saveLinkWrite(setter(txId, value), emptyGraphHint);
  };

  const memoryLabel = (id: string) => memoryNodes.find((m) => m.id === id)?.name || id;
  const filteredMemories = (() => {
    const q = memQ.trim();
    if (!q) return memoryNodes.slice(0, 40);
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const n of searchLifeGraphFuzzy(q, 30)) {
      if (n.attributes?.txShadow) continue;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ id: n.id, name: n.name || n.rawInput?.slice(0, 40) || n.id });
    }
    for (const m of memoryNodes) {
      if (seen.has(m.id)) continue;
      if (!m.name.toLowerCase().includes(q.toLowerCase()) && !m.id.includes(q)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out.slice(0, 40);
  })();

  const saveMemoryLink = (memoryNodeId: string) => {
    const id = memoryNodeId.trim();
    const r = setTxMemoryNode(txId, id);
    saveLinkWrite(
      r,
      id && r.reason === 'no_memory_node'
        ? L(dict, '已记在这笔交易上。不过这条记忆找不到了 —— 可能已被删除。', 'Saved here, but that memory was not found — it may have been deleted.')
        : id && r.reason === 'no_tx_node'
          ? L(dict, '已记在这笔交易上。这笔流水还没同步进记忆,所以暂时只有财务页看得到 —— 下次同步后会自动补上。',
               "Saved here. This transaction hasn't synced into memory yet, so only Finance shows it for now — the next sync will connect it.")
          : undefined,
    );
  };

  const onPick = async (list: FileList | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setErr(null);
    setBusy(true);
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        setErr(L(dict, `「${f.name}」有 ${prettyBytes(f.size)},超过 ${prettyBytes(MAX_FILE_BYTES)} 上限,换个小一点的。`,
          `“${f.name}” is ${prettyBytes(f.size)} — over the ${prettyBytes(MAX_FILE_BYTES)} limit.`));
        continue;
      }
      const assetId = `tx-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const meta = { name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size };
      const stored = await putLocalFile(assetId, f, meta);
      // 红线:本体没存进就不要在列表里挂一个指向空气的附件。
      const added = stored ? addTxAttachment(txId, { assetId, ...meta }) : null;
      if (!stored || !added?.ok) {
        setErr(L(dict, `「${f.name}」没能存进本机 —— 可能空间满了,清点空间再试。`, `Couldn't store “${f.name}” — device storage may be full.`));
        continue;
      }
      // 存下了但没挂到记忆节点上:财务页看得到,记忆详情/问一问取不到。说清楚。
      if (!added.graphOk) {
        setErr(L(dict, `「${f.name}」已存好,但还没连进记忆 —— 下次同步后记忆详情里也能看到。`,
          `“${f.name}” is saved, but not linked into memory yet — the next sync will connect it.`));
      }

      // ── 在这台设备上认一遍字 ────────────────────────────────────────────
      //
      // 「传附件」以前**只是存**:发票挂上去了,上面写的金额日期商家一个字都没进系统,
      // 搜也搜不到、对也对不上。可挂发票的意义**就是**那些字。
      //
      // 发票上是税号和金额 —— 这一步只在本机做,图一个字节不出手机。
      // (产品仓 nesio 里云识图在付费门后面;这里是 workshop,不分收费免费。)
      if (f.type.startsWith('image/') && added.nodeId) {
        const { attachImageUnderstanding } = await import('@/lib/portal/image-understand');
        const seen = await attachImageUnderstanding(added.nodeId, [f], { keepName: true });
        if (seen?.fields) {
          const amt = seen.fields.amount;
          // 差一分以内当一致 —— 浮点和四舍五入不该报成「对不上」。
          const mismatch = Math.abs(amt - Math.abs(txAmount)) > 0.01;
          setScanNote({
            text: mismatch
              ? L(dict, `票上是 ${amt}${seen.fields.date ? ` · ${seen.fields.date}` : ''},和这笔的 ${Math.abs(txAmount)} 对不上 —— 可能是含税前后,也可能挂错了单。`,
                     `Receipt says ${amt}${seen.fields.date ? ` · ${seen.fields.date}` : ''} — doesn't match this ${Math.abs(txAmount)}. Could be pre/post tax, or the wrong receipt.`)
              : L(dict, `票上是 ${amt}${seen.fields.date ? ` · ${seen.fields.date}` : ''},和这笔对得上。`,
                     `Receipt says ${amt}${seen.fields.date ? ` · ${seen.fields.date}` : ''} — matches this one.`),
            mismatch,
          });
        } else if (seen?.visionMessage) {
          // 「这台设备认不了字」和「这张图没认出字」是两件事,别混成一句。
          setScanNote({ text: seen.visionMessage, mismatch: false });
        }
      }
    }
    setAnn(txAnnotationOf(txId));
    setBusy(false);
  };

  const detailOpts = detailsForPrimary(catDraft || curCat);
  const knownCats = COMMON_EXPENSE_CATEGORIES as readonly string[];
  const isKnownCat = (c: string) => knownCats.includes(c) || c === 'INCOME';

  return (
    <div className="nesio-fin-txedit">
      <div className="nesio-fin-flowpick">
        {(['expense', 'refund', 'rebate', 'income', 'transfer'] as TxFlow[]).map((opt) => (
          <button key={opt} type="button" className={`nesio-fin-flowopt${flow === opt ? ' is-active' : ''}`} onClick={() => onFlow(opt)}>
            {L(dict, TX_FLOW_LABELS[opt][0], TX_FLOW_LABELS[opt][1])}
          </button>
        ))}
      </div>

      {/* 分类 / 子分类 / 自定义 —— 覆盖层,同步冲不掉 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '分类(只改这一笔)', 'Category (this transaction only)')}</p>
        <select className="nesio-fin-select" value={isKnownCat(catDraft) ? catDraft : '__custom__'}
          aria-label={L(dict, '分类', 'Category')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__custom__') { setCustomCat(catDraft && !isKnownCat(catDraft) ? catDraft : ''); return; }
            saveCategory(v, detailDraft.startsWith(`${v}_`) ? detailDraft : '');
          }}>
          {COMMON_EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabel(c, dict)}</option>
          ))}
          <option value="INCOME">{categoryLabel('INCOME', dict)}</option>
          <option value="__custom__">{L(dict, '自定义…', 'Custom…')}</option>
        </select>
        {!isKnownCat(catDraft) && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="nesio-fin-input" value={customCat} placeholder={L(dict, '自定义分类名', 'Custom category')}
              onChange={(e) => setCustomCat(e.target.value)}
              onBlur={() => { const v = customCat.trim(); if (v && v !== catDraft) saveCategory(v, detailDraft); }} />
          </div>
        )}
        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '子分类(可自定义)', 'Subcategory (custom OK)')}</p>
        {detailOpts.length > 0 && (
          <select className="nesio-fin-select" value={detailOpts.some((d) => d.id === detailDraft) ? detailDraft : ''}
            aria-label={L(dict, '子分类', 'Subcategory')}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { setCustomDetail(detailDraft); return; }
              saveCategory(catDraft || curCat, v);
            }}>
            <option value="">{L(dict, '选择或下方自定义', 'Pick or type below')}</option>
            {detailOpts.map((d) => (
              <option key={d.id} value={d.id}>{dict === 'en' ? d.labelEn : d.labelZh}</option>
            ))}
          </select>
        )}
        <input className="nesio-fin-input" value={detailOpts.some((d) => d.id === detailDraft) ? customDetail : (detailDraft || customDetail)}
          placeholder={L(dict, '自定义子分类(例:物业费)', 'Custom subcategory (e.g. HOA)')}
          onChange={(e) => setCustomDetail(e.target.value)}
          onBlur={() => {
            const v = customDetail.trim();
            if (v !== detailDraft) saveCategory(catDraft || curCat, v);
          }} />
        {(ann.category || ann.categoryDetail) && (
          <button type="button" className="nesio-fin-flowopt" onClick={() => saveCategory('', '')}>
            {L(dict, '恢复银行原分类', 'Reset to bank category')}
          </button>
        )}
      </div>

      {/* 关联人 / 旅行 / 记忆标签 / 财产 —— 下拉单选,可清空 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '关联人', 'Link a person')}</p>
        <select className="nesio-fin-select" value={linkedPerson} aria-label={L(dict, '关联人', 'Link a person')}
          onChange={(e) => savePersonLink(e.target.value)}>
          <option value="">{L(dict, '不关联', 'None')}</option>
          {contacts.map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </select>
        {!contacts.length && (
          <p className="nesio-fin-score-hint">{L(dict, '还没有可选的人 —— 先去关系页加一个核心/家人联系人。', 'No eligible people yet — add a core/family contact on the People page first.')}</p>
        )}

        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '关联旅行', 'Link a trip')}</p>
        <select className="nesio-fin-select" value={ann.tripId || ''} aria-label={L(dict, '关联旅行', 'Link a trip')}
          onChange={(e) => {
            const v = e.target.value;
            saveLinkField(setTxTrip, v);
            if (v) recomputeBudgetNode(v);
            else if (ann.tripId) recomputeBudgetNode(ann.tripId);
          }}>
          <option value="">{L(dict, '不关联', 'None')}</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{t.title || t.destination}</option>
          ))}
        </select>
        {ann.tripId && (() => {
          const trip = trips.find((t) => t.id === ann.tripId);
          if (!trip) return null;
          const cats = [
            { id: 'flight', label: L(dict, '机票', 'Flight') },
            { id: 'stay', label: L(dict, '住宿', 'Lodging') },
            { id: 'shop', label: L(dict, '购物', 'Shopping') },
            ...(trip.customBudgetCategories || []).map((c) => ({ id: c.id, label: c.label })),
          ];
          const spendNodes = trip.nodes.filter((n) => n.kind === 'flight' || n.kind === 'hotel' || n.kind === 'shopping');
          return (
            <>
              <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '行程花费类', 'Trip spend type')}</p>
              <select
                className="nesio-fin-select"
                value={ann.tripNodeId || ''}
                aria-label={L(dict, '行程花费类', 'Trip spend type')}
                onChange={(e) => {
                  const ok = setTxTripNode(txId, e.target.value);
                  setErr(ok ? null : failed);
                  setAnn(txAnnotationOf(txId));
                  if (ok && ann.tripId) recomputeBudgetNode(ann.tripId);
                }}
              >
                <option value="">{L(dict, '未细分(记入刷卡)', 'Unspecified (card spend)')}</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
                {spendNodes.length > 0 && (
                  <optgroup label={L(dict, '具体行程项', 'Specific items')}>
                    {spendNodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.title || n.kind}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </>
          );
        })()}

        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '关联记忆', 'Link a memory')}</p>
        <input className="nesio-fin-input" value={memQ} aria-label={L(dict, '搜索记忆', 'Search memories')}
          placeholder={L(dict, '搜索记忆…', 'Search memories…')}
          onChange={(e) => setMemQ(e.target.value)} />
        <select className="nesio-fin-select" value={ann.memoryNodeId || ''} aria-label={L(dict, '关联记忆', 'Link a memory')}
          onChange={(e) => saveMemoryLink(e.target.value)}>
          <option value="">{L(dict, '不关联', 'None')}</option>
          {ann.memoryNodeId && !filteredMemories.some((m) => m.id === ann.memoryNodeId) && (
            <option value={ann.memoryNodeId}>{memoryLabel(ann.memoryNodeId)}</option>
          )}
          {filteredMemories.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {!memoryNodes.length && !memQ.trim() && (
          <p className="nesio-fin-score-hint">{L(dict, '还没有可选的记忆 —— 先去记忆库记一条。', 'No memories yet — add one in Memory first.')}</p>
        )}

        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '关联项目', 'Link a project')}</p>
        <select className="nesio-fin-select" value={ann.projectId || ''} aria-label={L(dict, '关联项目', 'Link a project')}
          onChange={(e) => saveLinkField(setTxProject, e.target.value)}>
          <option value="">{L(dict, '不关联', 'None')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
          ))}
        </select>

        <p className="nesio-fin-score-hint" style={{ margin: 0 }}>{L(dict, '关联财产', 'Link an asset')}</p>
        <select className="nesio-fin-select" value={ann.assetId || ''} aria-label={L(dict, '关联财产', 'Link an asset')}
          onChange={(e) => saveLinkField(setTxAsset, e.target.value)}>
          <option value="">{L(dict, '不关联', 'None')}</option>
          {financeAssets.length > 0 && (
            <optgroup label={L(dict, '手动财产', 'Manual assets')}>
              {financeAssets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          )}
          {inventoryItems.length > 0 && (
            <optgroup label={L(dict, '物品库', 'Inventory')}>
              {inventoryItems.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </optgroup>
          )}
          {ann.assetId && !financeAssets.some((a) => a.id === ann.assetId) && !inventoryItems.some((i) => i.id === ann.assetId) && (
            <option value={ann.assetId}>{ann.assetId}</option>
          )}
        </select>
      </div>

      <div className="nesio-fin-txedit-row">
        <button type="button" className="nesio-fin-flowopt" disabled={busy} onClick={() => pickRef.current?.click()}>
          {busy ? L(dict, '存着…', 'Saving…') : L(dict, '传附件', 'Attach')}
        </button>
      </div>
      <input ref={pickRef} type="file" multiple accept="image/*,application/pdf" className="nesio-visually-hidden"
        onChange={(e) => { void onPick(e.target.files); e.currentTarget.value = ''; }} />

      {/* 分摊:把这一笔拆到多个分类/人。**合计必须等于原额**,差一分都不存 ——
          「大致分了一下」的分摊比不分更糟:按分类汇总会少一块钱,而你看不出少在哪。
          分摊不改原额,它是一个视图;总额聚合永远读原额。 */}
      <TxSplitEditor txId={txId} total={txAmount} dict={dict} contacts={contacts} onChanged={() => setAnn(txAnnotationOf(txId))} />

      {atts.length > 0 && (
        <ul className="nesio-hang-att-list">
          {atts.map((a) => (
            <li key={a.assetId} className="nesio-hang-att">
              <span className="nesio-hang-att-name">{a.name}</span>
              <span className="nesio-hang-att-size">{prettyBytes(a.size)}</span>
              <button type="button" className="nesio-rel-rec-del" aria-label={L(dict, '移除', 'Remove')}
                onClick={() => { void removeTxAttachment(txId, a.assetId).then((ok) => { setErr(ok ? null : failed); setAnn(txAnnotationOf(txId)); }); }}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <input className="nesio-fin-input" value={note} aria-label={L(dict, '备注', 'Note')}
        placeholder={L(dict, '备注', 'Note')}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note !== (ann.note || '')) { setErr(setTxNote(txId, note) ? null : failed); setAnn(txAnnotationOf(txId)); } }} />

      {/* 对不上不用红色 —— 那多半是含税前后差,不是出事了。用琥珀提一句就够。 */}
      {scanNote && (
        <p className={`nesio-fin-scannote${scanNote.mismatch ? ' is-off' : ''}`}>{scanNote.text}</p>
      )}

      {err && <p className="nesio-rel-detail-err" role="alert">{err}</p>}
    </div>
  );
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
  const [annRev, setAnnRev] = useState(0); // bug3:交易批注改了要重读覆盖层
  // 三态,不是两态。原来是 hydrated: boolean,而 bankDataReady() 的 catch 里直接
  // setHydrated(true) —— 也就是**把「读不出来」当成「没有数据」**:IDB 打不开的那一次,
  // 界面就说「还没有银行流水,去连接 Plaid」,而流水其实好端端躺在本机。
  // 用户实测到的正是这个:同一个财务页在「有完整数据」和「完全空白」之间跳变。
  // (CLAUDE.md 红线:失败必须看得见,不许伪装成空。)
  const [hydrateState, setHydrateState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [quickAdd, setQuickAdd] = useState<null | { seg: 'asset'; assetId?: string }>(null); // 仅资产估值/更新(手记银行流水已撤)
  const [reconcileOpen, setReconcileOpen] = useState(false); // L3-b:上传 statement 对账(端上解析,不上传)

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
    // 同步期间 accounts/tx/holdings 连发 nesio-bank-updated → 防抖,避免大表反复 setState 卡死主线程
    let bankReloadTimer: number | null = null;
    const reloadBankDebounced = () => {
      if (bankReloadTimer != null) window.clearTimeout(bankReloadTimer);
      bankReloadTimer = window.setTimeout(() => { bankReloadTimer = null; reload(); }, 180);
    };
    // 数据搬 IDB 后:水合完成/同步后派发 nesio-bank-updated → 重读(冷启动空窗自愈)。
    window.addEventListener('nesio-bank-updated', reloadBankDebounced);
    // Tesla 同步后派发 nesio-connectors-refreshed → 新充电花费即时进财务。
    window.addEventListener('nesio-connectors-refreshed', reloadBankDebounced);
    window.addEventListener(EXPENSES_EVENT, reloadBankDebounced);
    // P1:手动资产/锚点变动 → 净值 hero 与账户页即时刷新
    const onAssets = () => setRev((r) => r + 1);
    window.addEventListener(FIN_ASSETS_EVENT, onAssets);
    // bug3:交易批注(关联人/附件/备注)写完 → 行上的「已批注」即时更新
    const onAnn = () => setAnnRev((r) => r + 1);
    window.addEventListener(TX_ANNOTATIONS_EVENT, onAnn);
    return () => {
      if (bankReloadTimer != null) window.clearTimeout(bankReloadTimer);
      window.removeEventListener('nesio-bank-updated', reloadBankDebounced);
      window.removeEventListener('nesio-connectors-refreshed', reloadBankDebounced);
      window.removeEventListener(EXPENSES_EVENT, reloadBankDebounced);
      window.removeEventListener(FIN_ASSETS_EVENT, onAssets);
      window.removeEventListener(TX_ANNOTATIONS_EVENT, onAnn);
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
  // bug3:交易批注(关联人/附件/备注)—— 行上只用来显示「已批注」,编辑在 TxEditPanel 里。
  // ⚠️ 必须待在空态早退**之前**:hook 顺序不能随渲染变化(fin-display 契约钉的就是这条)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txAnns = useMemo(() => loadTxAnnotations(), [rev, annRev]);
  // bug3「手动关联人」的候选:与关系页同一套联系人(只取 key + 显示名)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pickContacts = useMemo(
    () => buildRelationships(getLifeGraph(), Date.now())
      .filter(isFinancePickContact)
      .map((c) => ({ key: c.key, name: c.name })),
    [rev, sub],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txEditTrips = useMemo(
    () => [...loadTrips()].sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [rev, annRev],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txEditMemoryNodes = useMemo(
    () => visibleMemoryNodes(getLifeGraph(), true)
      .filter((n) => !n.attributes?.txShadow)
      .sort((a, b) => memoryEventAt(b).getTime() - memoryEventAt(a).getTime())
      .slice(0, 80)
      .map((n) => ({ id: n.id, name: n.name || n.rawInput?.slice(0, 40) || n.id })),
    [rev, annRev],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txEditProjects = useMemo(() => getProjects(), [rev, annRev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txEditFinanceAssets = useMemo(() => listManualAssets(), [rev, annRev]);
  const txEditInventoryItems = useMemo(
    () => listInventoryItems().map((i) => ({ id: i.id, name: i.name })).filter((i) => i.name.trim()),
    [rev, annRev],
  );
  // 财务㉗:投资组合(持仓聚合;⚠️ 同样必须在空态早退之前)
  const [budgetNote, setBudgetNote] = useState('');
  const [showAddBudget, setShowAddBudget] = useState(false); // bug2:「手动添加」按钮展开分类选择
  const [allocPick, setAllocPick] = useState<string | null>(null); // bug3:组合结构环形图点开看这一类持仓
  const [spendFocus, setSpendFocus] = useState<string | null>(null); // bug2:环形图点选分类 → 走势/分析/明细
  const [txLimit, setTxLimit] = useState(10); // bug2:交易默认只显示 10 条
  const [recurDetail, setRecurDetail] = useState<string | null>(null); // bug2:订阅条目详情(key)
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
          <button type="button" className="nesio-fin-review-accept" style={{ marginTop: 'var(--space-2)' }}
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
        <p className="nesio-insights-empty">{L(dict, '还没有银行流水。到「设置 → 数据接入 → 银行流水 · Plaid」连接账户并点「同步」。', 'No bank transactions yet. Connect via Settings → Data sources → Plaid and sync.')}</p>
        {domainSpend.count > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <p className="nesio-settings-section-label">{L(dict, '本月小票 / 旅行', 'Receipts / travel this month')}</p>
            <p className="nesio-fin-alert-note" style={{ textAlign: 'left' }}>
              {L(dict, `${domainSpend.count} 笔 · 合计约 ${domainSpend.total.toFixed(0)}(未并入银行 KPI)`, `${domainSpend.count} · ~${domainSpend.total.toFixed(0)} (not in bank KPIs)`)}
            </p>
            {domainRows.slice(0, 6).map((e) => (
              <div key={e.id} className="nesio-fin-person-row" style={{ marginTop: 'var(--space-1)' }}>
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

  // 设计:总览顶部补 —— 本月支出(毛)+ 环比、念念一句话小结
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
  // 设计:5 个子页 —— 总览 / 支出 / 交易 / 投资 / 卡片。预算并入支出,定期并入交易(订阅 tab 与交易页重复,已删)。
  // bug3:「支出」tab 改名「分类」—— 这一页的主体就是按分类的环形图,不是又一份支出总额
  const SUBS: Array<[Sub, string, string]> = [['overview', '总览', 'Overview'], ['spending', '分类', 'Categories'], ['tx', '交易', 'Tx'], ['invest', '投资', 'Invest'], ['cards', '卡片', 'Cards']];
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
  // 批次 40 → 财务⑩:交易行显示账户归属(accountId → 完整账户,logo/后四位)
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const acctNames = loadAccountNames(); // bug2:账户自定义名(rev 变化时组件已重渲)

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

      {/* bug3:「＋记」不再混在 tab 行里(它不是一个视图,是一个动作)——
          挪到总览的卡片下面,当一个普通按钮。 */}
      <div className="nesio-fin-subtabs">
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>
      <QuickAddSheet open={quickAdd != null} initialSeg={quickAdd?.seg} initialAssetId={quickAdd?.assetId}
        currency={summary.currency || undefined} onClose={() => setQuickAdd(null)} onSaved={() => setRev((r) => r + 1)} />

      {/* ── 总览 ── */}
      {sub === 'overview' && (
        <>
          {/* 冷冻仓入口:未上线时不渲染(免费/Pro 都不上);点击统一走 Portal 的 nesio-open-freeze 门 */}
          {isFreezeLaunched() && (
            <button type="button" className="nesio-fin-freeze-entry" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-freeze'))}>
              <IconSnowflake size={14} />
              <span>{L(dict, '想冲动买的,先冻起来 · 冷静期', 'Freeze an impulse buy · cool-off')}</span>
              <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--portal-muted)' }}>›</span>
            </button>
          )}
          <FamilyDataCard kind="spend" />
          {/* bug3:卡片就是这四张 —— 收入 / 支出 / 总资产 / 投资(当月盈亏放进投资卡里)。
              念念那句话和「＋记」都挪到卡片下面。 */}
          {(() => {
            const s2 = assetSummaryWithHoldings(accounts, holdings, summary.currency || 'USD'); // 与账户列表同口径
            const manualNet = manualNetWorth(manualAssets);
            const totalAssets = Math.round((s2.net + manualNet) * 100) / 100;
            const portfolio = portfolioSummary(holdings);
            const investValue = s2.investments;
            const pts = [...nwSeries].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60);
            const vals = pts.map((p) => p.plaidNet + p.manualNet);
            const min = Math.min(...vals), max = Math.max(...vals);
            const span = max - min || 1;
            const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(1, vals.length - 1)) * 300},${34 - ((v - min) / span) * 28}`).join(' ');
            const fmtGain = (g: number) => (g >= 0 ? `+${formatMoney(g)}` : `-${formatMoney(-g)}`);
            return (
              <div className="nesio-fin-kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="nesio-fin-kpi">
                  <span className="nesio-fin-kpi-l">{L(dict, '收入', 'Income')}</span>
                  <span className="nesio-fin-kpi-v">{formatMoney(summary.income, summary.currency)}</span>
                </div>
                <div className="nesio-fin-kpi">
                  <span className="nesio-fin-kpi-l">{L(dict, '支出', 'Spending')}</span>
                  <span className="nesio-fin-kpi-v">{formatMoney(grossSpend, summary.currency)}</span>
                  {spendDelta !== null && <span className={`nesio-fin-delta${spendDelta > 0 ? ' up' : ' down'}`}>{spendDelta > 0 ? '+' : ''}{spendDelta}%</span>}
                </div>
                {(totalAssets !== 0) && (
                  <div className="nesio-fin-kpi">
                    <span className="nesio-fin-kpi-l">{L(dict, '总资产', 'Total assets')}</span>
                    <span className="nesio-fin-kpi-v">{totalAssets < 0 ? '-' : ''}{formatMoney(Math.abs(totalAssets), summary.currency)}</span>
                    {vals.length >= 2 && (
                      <svg viewBox="0 0 300 36" style={{ width: '100%', height: 36 }} aria-hidden>
                        <path d={path} fill="none" stroke="var(--portal-accent)" strokeWidth="2" />
                        <circle cx="300" cy={34 - ((vals[vals.length - 1] - min) / span) * 28} r="3" fill="var(--portal-accent)" />
                      </svg>
                    )}
                  </div>
                )}
                {investValue > 0 && (
                  <div className="nesio-fin-kpi">
                    <span className="nesio-fin-kpi-l">{L(dict, '投资', 'Investing')}</span>
                    <span className="nesio-fin-kpi-v">{formatMoney(investValue, summary.currency)}</span>
                    {/* 「当月盈亏想知道投资卡片里」—— 浮动盈亏就挂在这张卡上,不再单独占一格 */}
                    {portfolio && portfolio.gain !== null && (
                      <span className="nesio-fin-delta" style={{ color: portfolio.gain >= 0 ? 'var(--status-go)' : 'var(--status-gentle)' }}>
                        {fmtGain(portfolio.gain)}{portfolio.gainPct !== null ? ` (${portfolio.gainPct >= 0 ? '+' : ''}${portfolio.gainPct}%)` : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 念念一句话 + 「＋记」:都在卡片下面 */}
          {nessaSummary && (
            <div className="nesio-fin-nessa">
              <span>{nessaSummary}</span>
            </div>
          )}
          {/* 组合结构:去图例,改交互环形图(点一块看这一类的持仓) */}
          {(() => {
            const portfolio = portfolioSummary(holdings);
            if (!portfolio) return null;
            const active = allocPick ? portfolio.byType.find((x) => x.label === allocPick) || null : null;
            const inType = active ? holdings.filter((h) => (h.type || L(dict, '其他', 'Other')) === active.label).sort((a, b) => b.value - a.value).slice(0, 8) : [];
            return (
              <>
                <div className="nesio-fin-donut-wrap" style={{ marginTop: 'var(--space-2)' }}>
                  <FinanceDonut big slices={portfolio.byType.map((x) => ({ category: x.label, pct: x.pct }))}
                    onSlice={(c) => setAllocPick((p) => (p === c ? null : c))} activeCategory={allocPick}
                    centerTop={active ? active.label : L(dict, '组合结构', 'Allocation')}
                    centerVal={active ? `${active.pct}%` : formatMoney(portfolio.totalValue)} />
                </div>
                {active && (
                  <div className="nesio-fin-acctgroup">
                    {inType.length === 0 ? (
                      <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '这一类下没有明细持仓。', 'No holdings itemized under this type.')}</p>
                    ) : inType.map((h, i) => (
                      <div key={`${h.accountId}-${h.ticker || h.name}-${i}`} className="nesio-fin-acctrow">
                        <div className="nesio-fin-acctrow-body">
                          <span className="nesio-fin-acctrow-name" style={{ fontWeight: 'var(--weight-regular)' as never }}>{h.ticker || h.name}</span>
                        </div>
                        <span className="nesio-fin-acctrow-bal">{formatMoney(h.value, h.currency)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
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
              <div className="nesio-fin-personspend" style={{ marginBottom: 'var(--space-3)' }}>
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
                        <div className="nesio-fin-person-row" style={{ paddingLeft: 'var(--space-2)' }}>
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
                <p className="nesio-fin-alert-note" style={{ textAlign: 'left', marginTop: 'var(--space-1)' }}>{L(dict, '关联后小票变成那笔银行流水的明细,不再双计。', 'Linked receipts become detail of the bank txn — no double counting.')}</p>
              </div>
            </>
          )}

          {(findings.length > 0 || review.length > 0) && (
            <details className="nesio-fin-fold">
              <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none' }}>{L(dict, `风险预警 · ${findings.length + (review.length > 0 ? 1 : 0)} 条`, `Risk alerts · ${findings.length + (review.length > 0 ? 1 : 0)}`)} ›</summary>
              <div className="nesio-fin-alerts">
                {/* 统一判定(financeFindings):flag=真实风险 → risk 红;attention=可关注 → warn 琥珀 */}
                {findings.map((f) => {
                  // P2 尾巴:findings 可点 —— 按 kind 跳到能采取行动的子页(死文字 → 入口)
                  const FINDING_SUB: Record<string, Sub> = {
                    anomaly: 'tx', fee_audit: 'tx',
                    subscription_hike: 'tx', new_recurring: 'tx', upcoming_bill: 'tx', // 订阅 tab 已删,定期在交易页
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
            </details>
          )}

          {trend.length > 1 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-6)' }}>{L(dict, '月度趋势', 'Monthly trend')}</p>
              {(() => {
                // bug2:柱状图 → 折线图;点月份标签选择该月(全页数据跟着切换)。
                const max = Math.max(...trend.map((x) => x.net), 1);
                const W = 300, H = 64, PAD = 8;
                const px = (i: number) => PAD + (i / Math.max(1, trend.length - 1)) * (W - PAD * 2);
                const py = (v: number) => H - 14 - (Math.max(0, v) / max) * (H - 24);
                const path = trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(t.net)}`).join(' ');
                return (
                  <>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label={L(dict, '净支出月度折线', 'Net spend by month')}>
                      <path d={path} fill="none" stroke="var(--portal-accent)" strokeWidth="2" />
                      {trend.map((t, i) => (
                        <circle key={t.ym} cx={px(i)} cy={py(t.net)} r={t.ym === ym ? 4 : 2.5}
                          fill={t.ym === ym ? 'var(--portal-accent)' : 'var(--portal-card, #fff)'} stroke="var(--portal-accent)" strokeWidth="1.5" />
                      ))}
                    </svg>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
                      {trend.map((t) => (
                        <button key={t.ym} type="button" onClick={() => setYm(t.ym)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: t.ym === ym ? 'var(--portal-accent)' : 'var(--portal-muted)', fontWeight: t.ym === ym ? 700 : 400, padding: '2px 4px' }}>
                          {t.ym.slice(5)}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          )}

          {/* 批次 39:原「支出」tab 内容(分类聚合 + 商户 Top)并入总览 —— 它本就是聚合分析 */}
          {/* 财务⑮:财务体检 —— L3 分项评分,每项带通行标准出处;红只给真实风险 */}
          {scores.length > 0 && (
            <details className="nesio-fin-fold" style={{ marginTop: 'var(--space-5)' }}>
              <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none' }}>{L(dict, '财务体检', 'Financial checkup')} ›</summary>
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
            </details>
          )}

          {/* 财务㉓:月报 —— 报告级 Markdown,可下载 / 存入记忆(问一问可检索) */}
          <div className="nesio-fin-budget-add" style={{ marginTop: 'var(--space-5)' }}>
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

          {/* bug2:已学规则 —— 从交易页移到总览最下面,折叠 */}
          {(Object.keys(learnedRules.merchant).length > 0 || Object.keys(learnedRules.flow).length > 0) && (
            <details className="nesio-fin-fold" style={{ marginTop: 'var(--space-5)' }}>
              <summary className="nesio-settings-section-label" style={{ cursor: 'pointer', listStyle: 'none' }}>{L(dict, `已学规则 · ${Object.keys(learnedRules.merchant).length + Object.keys(learnedRules.flow).length} 条`, `Learned rules · ${Object.keys(learnedRules.merchant).length + Object.keys(learnedRules.flow).length}`)} ›</summary>
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
            </details>
          )}
        </>
      )}

      {/* ── 支出:交互环形图 + 商户 Top(折叠)+ 收入来源(折叠)—— 预算在上方 IIFE 渲染 ── */}

      {/* ── 交易:规则审核 + 筛选 + 明细 ── */}
      {sub === 'tx' && (
        <>
          {/* L3-b:上传对账单。放在交易页顶部 —— 这一页就是「我这个月都花了什么」,
              对账是它的自然动作。解析全在本机(pdf.js),文件不上传;产出的是候选行,
              勾了才进账本。 */}
          <button type="button" className="nesio-fin-review-accept" style={{ marginBottom: 'var(--space-2)' }}
            onClick={() => setReconcileOpen(true)}>
            {L(dict, '上传对账单核对(只在本机解析,不上传)', 'Check a statement (parsed on this device)')}
          </button>
          <ReconcileSheet open={reconcileOpen} onClose={() => setReconcileOpen(false)} onSaved={() => setRev((r) => r + 1)} />

          {/* 批次 40:筛选改成下拉菜单(账户 + 分类) —— 人工审核/退款配对沉到列表下方 */}
          <div className="nesio-fin-filterbar" style={{ marginTop: 0 }}>
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

          {/* bug2 交易行三行制:①日期+类别 ②logo+名字+金额同行 ③账户logo+自定义名+卡尾号 */}
          <div className="nesio-fin-txlist">
            {shownTx.slice(0, txLimit).map((t) => {
              const f = txFlow(t, undefined, refundEvidence);
              const a = t.accountId ? acctById.get(t.accountId) : undefined;
              return (
                <div key={t.id}>
                  <div className="nesio-fin-txrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
                      <button type="button" className={`nesio-fin-txflow nesio-fin-txflow--${f}`} onClick={() => setFlowEditId((id) => (id === t.id ? null : t.id))}>
                        <span className="nesio-fin-txflow-l">{L(dict, TX_FLOW_LABELS[f][0], TX_FLOW_LABELS[f][1])}</span>
                        {f === 'expense' && (() => {
                          // 财务⑨:primary 友好名后接 detailed 细分类(咖啡/加油…);*_OTHER_* 无增量不显示
                          const primary = categoryLabel(effectiveCategory(t), dict) || L(dict, '待归类', 'Uncategorized');
                          const detail = categoryDetailLabel(effectiveCategoryDetail(t), dict);
                          return <span className="nesio-fin-txcat"> · {primary}{detail && detail !== primary ? ` · ${detail}` : ''}</span>;
                        })()}
                        {f === 'income' && (() => {
                          const detail = categoryDetailLabel(effectiveCategoryDetail(t), dict);
                          return detail ? <span className="nesio-fin-txcat"> · {detail}</span> : null;
                        })()}
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="nesio-fin-txname" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{t.merchantLogo && <MLogo src={t.merchantLogo} />}{t.name || L(dict, '未知商户', 'Unknown')}</span>
                      <span className={`nesio-fin-txamt${t.amount < 0 ? ' is-refund' : ''}`}>{signed(t.amount)}</span>
                    </div>
                    <div className="nesio-fin-txfoot">
                      {a && (
                        <span className="nesio-fin-txacct">
                          <AcctLogo a={a} size={13} />
                          {displayAccountName(a, acctNames)}{a.mask ? ` ····${a.mask}` : ''}
                        </span>
                      )}
                      {t.city && (
                        <span className="nesio-fin-txacct" style={{ marginLeft: 'auto', color: 'var(--portal-muted)' }}>{t.city}</span>
                      )}
                      {/* bug3:每一笔都能改 —— 流向 / 分类 / 关联人 / 附件 / 备注 */}
                      <button type="button" className="nesio-fin-txedit-btn"
                        aria-expanded={flowEditId === t.id}
                        onClick={() => setFlowEditId((id) => (id === t.id ? null : t.id))}>
                        {hasTxAnnotation(txAnnotationOf(t.id, txAnns)) ? L(dict, '已批注 · 修改', 'Annotated · Edit') : L(dict, '修改', 'Edit')}
                      </button>
                    </div>
                  </div>
                  {flowEditId === t.id && (
                    <TxEditPanel txId={t.id} txAmount={Math.abs(t.amount)} flow={f} dict={dict} contacts={pickContacts}
                      trips={txEditTrips} memoryNodes={txEditMemoryNodes} projects={txEditProjects}
                      financeAssets={txEditFinanceAssets} inventoryItems={txEditInventoryItems}
                      tx={t} onFlow={(opt) => applyFlow(t, opt)} onCategoryChanged={() => setRev((r) => r + 1)} />
                  )}
                </div>
              );
            })}
          </div>
          {/* bug2:只显示 10 条,其余折叠 */}
          {shownTx.length > txLimit && (
            <button type="button" className="nesio-fin-flowopt" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={() => setTxLimit(shownTx.length)}>
              {L(dict, `展开其余 ${shownTx.length - txLimit} 笔`, `Show ${shownTx.length - txLimit} more`)}
            </button>
          )}
          {txLimit > 10 && shownTx.length > 10 && (
            <button type="button" className="nesio-fin-flowopt" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={() => setTxLimit(10)}>
              {L(dict, '收起', 'Collapse')}
            </button>
          )}
          {adjIds.size > 0 && (
            <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-1)' }}>
              {L(dict, `已折叠 ${adjIds.size / 2} 组银行内部调整(同日同额一正一负,净额为零)`, `${adjIds.size / 2} internal bank adjustment pair(s) collapsed (same-day offsetting, net zero)`)}
            </p>
          )}

          {/* 人工识别沉底:先看流水,再处理待归类 / 退款配对(提示要说清差在哪) */}
          {review.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{L(dict, `规则审核 · ${review.length} 笔待归类`, `Review · ${review.length} to categorize`)}</p>
              {review.length > 1 && (
                <button type="button" className="nesio-fin-review-accept" style={{ marginBottom: 'var(--space-2)' }}
                  onClick={() => { for (const t of review) setMerchantRuleFor(t, suggestCategory(t.name).category); setRev((r) => r + 1); }}>
                  {L(dict, `全部按建议归类(${review.length} 笔,每笔都可再改)`, `Accept all suggestions (${review.length}, each editable later)`)}
                </button>
              )}
              {review.slice(0, 3).map((t) => {
                const sug = suggestCategory(t.name);
                return (
                  <div key={t.id} className="nesio-fin-review">
                    <p className="nesio-fin-review-title">{t.name} · {formatMoney(t.amount, summary.currency)}</p>
                    <p className="nesio-fin-review-sug">{L(dict, `建议分类:${categoryLabel(sug.category, 'zh')}${sug.confidence >= 0.6 ? '(关键词匹配)' : '(默认猜测)'}`, `Suggested: ${categoryLabel(sug.category, 'en')}${sug.confidence >= 0.6 ? ' (keyword match)' : ' (default guess)'}`)}</p>
                    <div className="nesio-fin-review-btns">
                      <button type="button" className="nesio-fin-review-accept" onClick={() => resolveReview(t, sug.category)}>{L(dict, '接受', 'Accept')}</button>
                      {COMMON_EXPENSE_CATEGORIES.filter((c) => c !== sug.category).slice(0, 2).map((c) => (
                        <button key={c} type="button" className="nesio-fin-review-alt" onClick={() => resolveReview(t, c)}>{categoryLabel(c, dict)}</button>
                      ))}
                      <button type="button" className="nesio-fin-review-skip" onClick={() => { setFlowRuleFor(t, 'transfer'); setRev((r) => r + 1); }}>{L(dict, '不计收支', 'Not spend')}</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <RefundPairs txs={txs} currency={summary.currency || undefined} onChanged={() => setRev((r) => r + 1)} />
          </div>

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
              {/* bug2:去掉行尾 ✕;点一下进入订阅详情页(内有编辑/确认按钮) */}
              {recurring.map((r) => (
                <button key={r.key} type="button" className="nesio-fin-recur" style={{ border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent', fontFamily: 'var(--font-sans)' }}
                  onClick={() => setRecurDetail(r.key)}>
                  <div className="nesio-fin-recur-main">
                    <span className="nesio-fin-recur-name">{r.logo && <MLogo src={r.logo} />}{r.name}{r.status === 'predicted' && !r.confirmed && <span className="nesio-fin-recur-badge">{L(dict, '待确认', 'unconfirmed')}</span>}{hikeByKey.has(r.key) && (() => { const h = hikeByKey.get(r.key)!; return <span className="nesio-fin-recur-badge" style={{ color: 'var(--status-gentle)', borderColor: 'var(--status-gentle)' }} title={L(dict, `从 ${formatMoney(h.from, h.currency)} 涨到 ${formatMoney(h.to, h.currency)}`, `up from ${formatMoney(h.from, h.currency)} to ${formatMoney(h.to, h.currency)}`)}>{L(dict, `↑涨价 ${h.deltaPct}%`, `↑ up ${h.deltaPct}%`)}</span>; })()}</span>
                    <span className="nesio-fin-recur-meta">{L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {categoryLabel(r.category, dict)} · {L(dict, `下次约 ${r.nextEstimate.slice(5).replace('-', '/')}`, `next ~${r.nextEstimate.slice(5).replace('-', '/')}`)}</span>
                  </div>
                  {/* bug3:金额右对齐(定宽右靠,一列数字能对上);删行尾 › ——
                      整行就是按钮,箭头只是又一个视觉噪点 */}
                  <span className="nesio-fin-recur-amt nesio-fin-recur-amt--right">{formatMoney(r.avgAmount, r.currency)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* bug2:订阅详情(点行进入;编辑分类 / 确认转正 / 标不是定期) */}
      {(() => {
        const r = recurDetail ? recurring.find((x) => x.key === recurDetail) : null;
        return (
          <NesioSheet variant="bottom" open={r != null} onOpenChange={(o) => { if (!o) setRecurDetail(null); }} ariaLabel={L(dict, '订阅详情', 'Subscription detail')}>
            {r && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as never, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.logo && <MLogo src={r.logo} />}{r.name}
                  {r.status === 'predicted' && !r.confirmed && <span className="nesio-fin-recur-badge">{L(dict, '待确认', 'unconfirmed')}</span>}
                </p>
                <div className="nesio-fin-kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 0 }}>
                  <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '金额', 'Amount')}</span><span className="nesio-fin-kpi-v">{formatMoney(r.latestAmount || r.avgAmount, r.currency)}</span></div>
                  <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '下次约', 'Next')}</span><span className="nesio-fin-kpi-v">{r.nextEstimate.slice(5).replace('-', '/')}</span></div>
                </div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
                  {L(dict, r.cadenceLabel[0], r.cadenceLabel[1])} · {L(dict, `已出现 ${r.count} 笔`, `${r.count} charge(s)`)} · {L(dict, `最近 ${r.lastDate}`, `last ${r.lastDate}`)}
                </p>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '编辑分类', 'Edit category')}</p>
                  <select className="nesio-fin-select" value={r.category}
                    onChange={(e) => { if (e.target.value) { setMerchantRule(r.name, e.target.value); setRev((v) => v + 1); } }}>
                    {[r.category, ...COMMON_EXPENSE_CATEGORIES.filter((c) => c !== r.category)].map((c) => (
                      <option key={c} value={c}>{categoryLabel(c, dict)}</option>
                    ))}
                  </select>
                </div>
                {/* 确认过就不再问第二遍(bug3:确认后「待确认」必须消失) */}
                {r.status === 'predicted' && !r.confirmed && (
                  <button type="button" className="nesio-fin-review-accept" onClick={() => { setRecurRule(r.key, 'yes'); setRev((v) => v + 1); setRecurDetail(null); }}>
                    {L(dict, '确认是定期', 'Confirm recurring')}
                  </button>
                )}
                <button type="button" className="nesio-fin-flowopt" onClick={() => { markNotRecurring(r.key); setRecurDetail(null); }}>
                  {L(dict, '不是定期,从列表移除', 'Not recurring — remove')}
                </button>
              </div>
            )}
          </NesioSheet>
        );
      })()}

      {/* ── 支出主体:单一环形图;点分类 → 走势 + 商户分析 + 每笔明细 ── */}
      {sub === 'spending' && (
        <>
          {cats.length > 0 ? (
            <>
              {(() => {
                const active = cats.find((c) => c.category === spendFocus) || null;
                const flowRules = loadFlowRules();
                const catTxs = active
                  ? txs.filter((t) => (t.date || '').slice(0, 7) === ym && txFlow(t, flowRules) === 'expense' && effectiveCategory(t) === active.category)
                    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || Math.abs(b.amount) - Math.abs(a.amount))
                  : [];
                const merchantAgg = (() => {
                  const m = new Map<string, { name: string; total: number; count: number; logo?: string }>();
                  for (const t of catTxs) {
                    const key = (t.merchantId || t.name || '?').trim();
                    const cur = m.get(key) || { name: t.name || L(dict, '未知', 'Unknown'), total: 0, count: 0, logo: t.merchantLogo };
                    cur.total += Math.abs(t.amount);
                    cur.count += 1;
                    if (t.merchantLogo) cur.logo = t.merchantLogo;
                    m.set(key, cur);
                  }
                  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5);
                })();
                const avg = catTxs.length ? active!.total / catTxs.length : 0;
                return (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <FinanceDonut big slices={cats}
                      centerTop={active ? categoryLabel(active.category, dict) : L(dict, '本月支出', 'This month')}
                      centerVal={active ? `${active.pct}%` : formatMoney(cats.reduce((s, c) => s + c.total, 0), summary.currency)}
                      onSlice={(c) => { if (c === 'OTHER_REST') return; setSpendFocus((v) => (v === c ? null : c)); }}
                      activeCategory={spendFocus} />
                    {!active && (
                      <p className="nesio-fin-score-hint" style={{ textAlign: 'center', marginTop: 'var(--space-1)' }}>
                        {L(dict, '点一块分类,看走势、商户和每笔明细', 'Tap a slice for trend, merchants, and each charge')}
                      </p>
                    )}
                    {active && (() => {
                      const seq = availableMonths(txs).slice(0, 6).reverse().map((m) => ({
                        ym: m, total: categoryBreakdown(txs, m).find((x) => x.category === active.category)?.total || 0,
                      }));
                      const max = Math.max(...seq.map((x) => x.total), 1);
                      const W = 280, H = 56, PAD = 8;
                      const px = (i: number) => PAD + (i / Math.max(1, seq.length - 1)) * (W - PAD * 2);
                      const py = (v: number) => H - 12 - (v / max) * (H - 20);
                      const path = seq.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(p.total)}`).join(' ');
                      return (
                        <div style={{ marginTop: 'var(--space-2)' }}>
                          <div className="nesio-fin-cat-top">
                            <span className="nesio-fin-cat-name">{categoryLabel(active.category, dict)}</span>
                            <span className="nesio-fin-cat-amt">{formatMoney(active.total, summary.currency)}
                              {active.deltaPct !== null ? <span className={`nesio-fin-delta${active.deltaPct > 0 ? ' up' : ' down'}`}>{active.deltaPct > 0 ? '+' : ''}{active.deltaPct}%</span> : active.isNew ? <span className="nesio-fin-delta is-new">{L(dict, '新增', 'new')}</span> : null}
                            </span>
                          </div>
                          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label={L(dict, '该分类月度折线', 'Category monthly trend')}>
                            <path d={path} fill="none" stroke="var(--portal-accent)" strokeWidth="2" />
                            {seq.map((p, i) => <circle key={p.ym} cx={px(i)} cy={py(p.total)} r={p.ym === ym ? 3.5 : 2} fill="var(--portal-accent)" />)}
                          </svg>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
                            {seq.map((p) => <span key={p.ym} style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{p.ym.slice(5)}</span>)}
                          </div>

                          {/* 分析:笔数 / 均笔 / 占月支出 + 商户 Top(并进同一块,不再另开饼图) */}
                          <div className="nesio-fin-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 'var(--space-3)', marginBottom: 0 }}>
                            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '笔数', 'Count')}</span><span className="nesio-fin-kpi-v">{catTxs.length}</span></div>
                            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '均笔', 'Avg')}</span><span className="nesio-fin-kpi-v">{formatMoney(avg, summary.currency)}</span></div>
                            <div className="nesio-fin-kpi"><span className="nesio-fin-kpi-l">{L(dict, '占本月', 'Share')}</span><span className="nesio-fin-kpi-v">{active.pct}%</span></div>
                          </div>
                          {merchantAgg.length > 0 && (
                            <div style={{ marginTop: 'var(--space-3)' }}>
                              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '该分类 · 商户 Top', 'In this category · Top merchants')}</p>
                              {merchantAgg.map((m) => (
                                <div key={m.name} className="nesio-fin-cat-top" style={{ marginBottom: 4 }}>
                                  <span className="nesio-fin-cat-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    {m.logo && <MLogo src={m.logo} />}{m.name}
                                    <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}> · {L(dict, `${m.count} 笔`, `${m.count}×`)}</span>
                                  </span>
                                  <span className="nesio-fin-cat-amt">{formatMoney(m.total, summary.currency)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ marginTop: 'var(--space-3)' }}>
                            <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, `明细 · ${catTxs.length} 笔`, `Details · ${catTxs.length}`)}</p>
                            {catTxs.length === 0 ? (
                              <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '这个分类本月没有流水。', 'No charges in this category this month.')}</p>
                            ) : (
                              <div className="nesio-fin-txlist">
                                {catTxs.map((t) => {
                                  const a = t.accountId ? acctById.get(t.accountId) : undefined;
                                  const detail = categoryDetailLabel(effectiveCategoryDetail(t), dict);
                                  return (
                                    <div key={t.id} className="nesio-fin-txrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span className="nesio-fin-txdate">{(t.date || '').slice(5).replace('-', '/')}</span>
                                        {detail && <span className="nesio-fin-txcat" style={{ color: 'var(--portal-muted)' }}>{detail}</span>}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span className="nesio-fin-txname" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {t.merchantLogo && <MLogo src={t.merchantLogo} />}{t.name || L(dict, '未知商户', 'Unknown')}
                                        </span>
                                        <span className="nesio-fin-txamt">-{formatMoney(Math.abs(t.amount), summary.currency)}</span>
                                      </div>
                                      {a && (
                                        <span className="nesio-fin-txacct">
                                          <AcctLogo a={a} size={13} />
                                          {displayAccountName(a, acctNames)}{a.mask ? ` ····${a.mask}` : ''}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </>
          ) : (
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, '这个月还没有可统计的支出。', 'No spending to break down this month yet.')}</p>
          )}
        </>
      )}

      {/* ── 预算(bug2:并入支出页;bug3:「手动添加」改名「预算」,与「生成」一起放到本页最下面) ── */}
      {sub === 'spending' && (() => {
        const patchBudget = (next: BudgetConfig) => { saveBudget(next); setRev((r) => r + 1); };
        const addRow = (
          <>
            <div className="nesio-fin-budget-add" style={{ marginTop: 0 }}>
              <button type="button" className="nesio-fin-review-accept" onClick={() => setShowAddBudget((v) => !v)}>{L(dict, '预算', 'Budget')}</button>
              <button type="button" className="nesio-fin-flowopt" onClick={() => {
                const s = suggestBudget(txs);
                if (s) { patchBudget(s); setBudgetNote(''); }
                else setBudgetNote(L(dict, '历史还不足 3 个完整月,先手动添加一个分类预算。', 'Less than 3 full months of history — add a category budget manually.'));
              }}>{L(dict, '生成', 'Generate')}</button>
            </div>
            {showAddBudget && (
              <div className="nesio-fin-budget-add">
                <select className="nesio-fin-select" value="" aria-label={L(dict, '添加分类预算', 'Add category budget')} onChange={(e) => { if (e.target.value) { patchBudget({ ...budget, categories: { ...budget.categories, [e.target.value]: 100 } }); setShowAddBudget(false); } }}>
                  <option value="">{L(dict, '选择分类', 'Pick a category')}</option>
                  {COMMON_EXPENSE_CATEGORIES.filter((c) => !budget.categories[c]).map((c) => (
                    <option key={c} value={c}>{categoryLabel(c, dict)}</option>
                  ))}
                </select>
              </div>
            )}
            {budgetNote && <p className="nesio-settings-option-hint">{budgetNote}</p>}
          </>
        );
        if (!hasBudget(budget)) return addRow;
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
            {addRow}
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
              <div className="nesio-fin-kpis" style={{ marginTop: 'var(--space-2)', marginBottom: 0, gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
            <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{L(dict, '分类预算', 'Category budgets')}</p>
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
              <div className="nesio-fin-cat" style={{ marginTop: 'var(--space-4)' }}>
                <div className="nesio-fin-cat-top">
                  <span className="nesio-fin-cat-name">{L(dict, '其他(未设预算)', 'Everything else')}</span>
                  <span className="nesio-fin-cat-amt">{formatMoney(bp.otherSpent)}</span>
                </div>
                <p className="nesio-fin-score-hint" style={{ marginTop: 0 }}>{L(dict, '这些分类还没设预算 —— 超支常藏在这里,可用下方「+ 添加分类预算」纳入。', "No budget on these categories yet — overspend often hides here; add one below.")}</p>
              </div>
            )}
          </>
        );
      })()}

      {/* P2 投资(P3 拆分 → InvestPane) */}
      {sub === 'invest' && <InvestPane txs={txs} holdings={holdings} accounts={accounts} nwSeries={nwSeries} currency={summary.currency} dict={dict} />}
      {/* 账户页(P3 拆分 → CardsPane:Plaid 分组 + 资产小结 + 持仓 + 手动资产) */}
      {sub === 'cards' && (
        <CardsPane txs={txs} accounts={accounts} holdings={holdings} manualAssets={manualAssets}
          ym={ym} currency={summary.currency} dict={dict}
          onQuickAddAsset={(assetId) => setQuickAdd({ seg: 'asset', ...(assetId ? { assetId } : {}) })} onChanged={() => setRev((r) => r + 1)} />
      )}
    </div>
  );
}
