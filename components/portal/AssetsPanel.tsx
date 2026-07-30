'use client';

/**
 * AssetsPanel —— 洞察「资产」页(Bug4 图23-24,原来的「车」页)。
 *
 * 两个 tab:房产 / 车。共用同一套底座,不做两份实现:
 *   · 估值 = finance-assets 的手动资产 + 估值锚点(用户拍板方案 1:手动录入,零外部依赖 ——
 *     不接 Zillow 之类第三方,估值是「你自己认的那个数 + 你写的依据」,可回溯可改)。
 *   · 花钱的记录(税费/维修/保养)走 finance-sources.addManualEntry(assetId + assetCostKind),
 *     所以它们**同时**出现在财务板块里,不是资产页自己的私账;assetHoldingCosts 再把它们归集回来。
 *   · 不花钱的那一半(谁做的、多久一次、下次什么时候)在 asset-care 里 —— 财务放不下这些。
 *
 * 车 tab 在这套之上多一块实时快照(TeslaPanel:状态/里程/充电/能耗),那块是接口来的,只读。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import TeslaPanel from './TeslaPanel';
import {
  listManualAssets, addManualAsset, addAssetAnchor, removeManualAsset,
  assetCurrentValue, assetHoldingCosts, FIN_ASSETS_EVENT,
  type ManualAsset, type ManualAssetKind,
} from '@/lib/portal/finance-assets';
import { loadDomainExpenses, addManualEntry, EXPENSES_EVENT } from '@/lib/portal/finance-sources';
import {
  listCareRecords, addCareRecord, removeCareRecord, upcomingCare, nextDueDate,
  ASSET_CARE_EVENT, type CareKind, type CareRecord,
} from '@/lib/portal/asset-care';
import { buildRelationships } from '@/lib/portal/relationships';
import { getLifeGraph } from '@/lib/portal/life-graph';

type AssetTab = 'property' | 'vehicle';

const CARE_KINDS: Array<{ k: CareKind; zh: string; en: string }> = [
  { k: 'tax', zh: '税费', en: 'Tax' },
  { k: 'repair', zh: '维修', en: 'Repair' },
  { k: 'maintenance', zh: '维护', en: 'Upkeep' },
];

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function AssetsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [tab, setTab] = useState<AssetTab>('property');
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    for (const ev of [FIN_ASSETS_EVENT, ASSET_CARE_EVENT, EXPENSES_EVENT]) window.addEventListener(ev, bump);
    return () => { for (const ev of [FIN_ASSETS_EVENT, ASSET_CARE_EVENT, EXPENSES_EVENT]) window.removeEventListener(ev, bump); };
  }, [bump]);

  // tick 是**故意**的依赖:这三个 store 都是同步读快照,本身不响应式。
  // 上面的事件监听让 tick 自增 = 「有人改了数据,重读一遍」。去掉它就再也不刷新。
  /* eslint-disable react-hooks/exhaustive-deps */
  const assets = useMemo(() => listManualAssets().filter((a) => a.kind === tab), [tab, tick]);
  const expenses = useMemo(() => loadDomainExpenses(), [tick]);
  // 服务方候选:关系里已有的人。挑了就把 personKey 存下来,以后这个人的页面能看到「他修过什么」。
  const people = useMemo(() => {
    try { return buildRelationships(getLifeGraph()).slice(0, 200); } catch { return []; }
  }, [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="nesio-assets">
      <div className="nesio-assets-tabs" role="tablist">
        {([['property', '房产', 'Property'], ['vehicle', '车', 'Car']] as const).map(([k, zh, en]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={`nesio-assets-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {L(dict, zh, en)}
          </button>
        ))}
      </div>

      {/* 车 tab 顶部是接口来的实时快照(状态/里程/充电/能耗),只读,不在手动录入范围内。 */}
      {tab === 'vehicle' && (
        <div className="nesio-assets-live">
          <TeslaPanel />
        </div>
      )}

      <AssetList
        kind={tab}
        assets={assets}
        expenses={expenses}
        people={people}
        dict={dict}
      />
    </div>
  );
}

/* ── 资产清单 + 新增 ──────────────────────────────────────────────── */

function AssetList({ kind, assets, expenses, people, dict }: {
  kind: ManualAssetKind;
  assets: ManualAsset[];
  expenses: ReturnType<typeof loadDomainExpenses>;
  people: Array<{ key: string; name: string }>;
  dict: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const isProperty = kind === 'property';
  function submit() {
    const v = Number(value);
    if (!name.trim() || !Number.isFinite(v)) return;
    const a = addManualAsset({ name: name.trim(), kind, value: v, note: note.trim() || undefined });
    setAdding(false); setName(''); setValue(''); setNote('');
    setOpenId(a.id);
  }

  return (
    <>
      {assets.length === 0 && !adding && (
        <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-3)' }}>
          {isProperty
            ? L(dict, '还没有房产。加一处,自己填个估值 —— 估值就是你认的那个数,想改随时改。', 'No property yet. Add one with your own valuation — it is your number, editable anytime.')
            : L(dict, '还没有车。加一辆,才能记保养和税费。', 'No car yet. Add one to track upkeep and tax.')}
        </p>
      )}

      {assets.map((a) => (
        <AssetCard
          key={a.id}
          asset={a}
          expenses={expenses}
          people={people}
          dict={dict}
          open={openId === a.id}
          onToggle={() => setOpenId(openId === a.id ? null : a.id)}
        />
      ))}

      {adding ? (
        <div className="nesio-assets-form">
          <input className="nesio-assets-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={isProperty ? L(dict, '叫它什么(如:家 / 老宅)', 'Name it (e.g. Home)') : L(dict, '叫它什么(如:Model Y)', 'Name it (e.g. Model Y)')} />
          <input className="nesio-assets-input" value={value} onChange={(e) => setValue(e.target.value)}
            inputMode="decimal" placeholder={L(dict, '现在值多少', 'What is it worth now')} />
          <input className="nesio-assets-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={L(dict, '依据(邻居成交价 / 银行评估 / 自己估的)', 'Basis (comp sale / bank appraisal / my guess)')} />
          <div className="nesio-assets-row2">
            <button type="button" className="nesio-assets-btn" onClick={() => setAdding(false)}>{L(dict, '稍后', 'Later')}</button>
            <button type="button" className="nesio-assets-btn pri" onClick={submit} disabled={!name.trim() || !Number.isFinite(Number(value))}>
              {L(dict, '加进来', 'Add')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="nesio-assets-add" onClick={() => setAdding(true)}>
          + {isProperty ? L(dict, '加一处房产', 'Add property') : L(dict, '加一辆车', 'Add a car')}
        </button>
      )}
    </>
  );
}

/* ── 单件资产:估值 + 记录 ─────────────────────────────────────────── */

function AssetCard({ asset, expenses, people, dict, open, onToggle }: {
  asset: ManualAsset;
  expenses: ReturnType<typeof loadDomainExpenses>;
  people: Array<{ key: string; name: string }>;
  dict: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [reval, setReval] = useState(false);
  const [rv, setRv] = useState('');
  const [rnote, setRnote] = useState('');

  const cur = assetCurrentValue(asset);
  const costs = assetHoldingCosts(asset.id, expenses);
  const records = listCareRecords(asset.id);
  const due = upcomingCare(asset.id);
  const latest = asset.anchors[0];

  function saveAnchor() {
    const v = Number(rv);
    if (!Number.isFinite(v)) return;
    addAssetAnchor(asset.id, { date: todayStr(), value: v, ...(rnote.trim() ? { note: rnote.trim() } : {}) });
    setReval(false); setRv(''); setRnote('');
  }

  return (
    <div className="nesio-assets-card">
      <button type="button" className="nesio-assets-head" onClick={onToggle} aria-expanded={open}>
        <span className="n">{asset.name}</span>
        <span className="v">{money(cur)}</span>
        <span className="c" aria-hidden>{open ? '⌄' : '›'}</span>
      </button>
      <p className="nesio-assets-sub">
        {latest?.date}{latest?.note ? ` · ${latest.note}` : ''}
        {asset.anchors.length > 1 && ` · ${L(dict, `${asset.anchors.length} 次估值`, `${asset.anchors.length} valuations`)}`}
        {costs.total > 0 && ` · ${L(dict, `今年花了 ${money(costs.total)}`, `${money(costs.total)} this year`)}`}
      </p>

      {/* 下次要做的事 —— 收起状态也显示,这是这张卡唯一会「找你」的信息。 */}
      {due.length > 0 && (
        <p className="nesio-assets-due">
          {L(dict, '下次 ', 'Next ')}{due[0].nextDate} · {due[0].title}
          {due.length > 1 && L(dict, ` (还有 ${due.length - 1} 项)`, ` (+${due.length - 1})`)}
        </p>
      )}

      {open && (
        <div className="nesio-assets-body">
          {/* ① 估值 */}
          {reval ? (
            <div className="nesio-assets-form">
              <input className="nesio-assets-input" value={rv} onChange={(e) => setRv(e.target.value)}
                inputMode="decimal" placeholder={L(dict, '现在值多少', 'What is it worth now')} />
              <input className="nesio-assets-input" value={rnote} onChange={(e) => setRnote(e.target.value)}
                placeholder={L(dict, '依据', 'Basis')} />
              <div className="nesio-assets-row2">
                <button type="button" className="nesio-assets-btn" onClick={() => setReval(false)}>{L(dict, '稍后', 'Later')}</button>
                <button type="button" className="nesio-assets-btn pri" onClick={saveAnchor} disabled={!Number.isFinite(Number(rv))}>{L(dict, '存下来', 'Save')}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="nesio-assets-link" onClick={() => setReval(true)}>{L(dict, '更新估值', 'Update valuation')}</button>
          )}

          {asset.anchors.length > 1 && (
            <div className="nesio-assets-anchors">
              {asset.anchors.slice(0, 6).map((an) => (
                <div key={`${an.date}-${an.value}`} className="nesio-assets-anchor">
                  <span>{an.date}</span><span>{money(an.value)}</span>
                  {an.note && <span className="note">{an.note}</span>}
                </div>
              ))}
            </div>
          )}

          {/* ② 记录:税费 / 维修 / 维护 */}
          <CareSection assetId={asset.id} records={records} people={people} dict={dict} />

          {costs.total > 0 && (
            <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-3)' }}>
              {L(dict,
                `今年:税 ${money(costs.tax)} · 维修 ${money(costs.repair)} · 其他 ${money(costs.other)} —— 这些同时记在财务里。`,
                `This year: tax ${money(costs.tax)} · repair ${money(costs.repair)} · other ${money(costs.other)} — also tracked in Finance.`)}
            </p>
          )}

          <button type="button" className="nesio-assets-link danger"
            onClick={() => { if (confirm(L(dict, `删掉「${asset.name}」?记录会一并删掉,已入财务的花费保留。`, `Delete “${asset.name}”? Its records go too; finance entries stay.`))) removeManualAsset(asset.id); }}>
            {L(dict, '删掉这一件', 'Delete this')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── 照料记录 ─────────────────────────────────────────────────────── */

function CareSection({ assetId, records, people, dict }: {
  assetId: string;
  records: CareRecord[];
  people: Array<{ key: string; name: string }>;
  dict: string;
}) {
  const [kind, setKind] = useState<CareKind | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState('');   // personKey 或自由文本
  const [every, setEvery] = useState('');

  function submit() {
    if (!kind || !title.trim()) return;
    const amt = Number(amount);
    const hasAmt = amount.trim() !== '' && Number.isFinite(amt) && amt > 0;
    // 钱进财务(唯一真源),同时把 expenseId 记回照料记录,删的时候不留孤儿账。
    const exp = hasAmt
      ? addManualEntry({
        amount: amt, kind: 'expense', date,
        category: kind === 'tax' ? L(dict, '税费', 'Tax') : kind === 'repair' ? L(dict, '维修', 'Repair') : L(dict, '维护', 'Upkeep'),
        note: title.trim(),
        assetId,
        assetCostKind: kind === 'maintenance' ? 'other' : kind,
      })
      : null;
    const person = people.find((p) => p.key === provider);
    addCareRecord({
      assetId, kind, title: title.trim(), date,
      ...(hasAmt ? { amount: amt } : {}),
      ...(exp ? { expenseId: exp.id } : {}),
      ...(person ? { providerPersonId: person.key, providerName: person.name } : provider.trim() ? { providerName: provider.trim() } : {}),
      ...(Number(every) > 0 ? { everyMonths: Number(every) } : {}),
    });
    setKind(null); setTitle(''); setAmount(''); setProvider(''); setEvery(''); setDate(todayStr());
  }

  return (
    <div className="nesio-assets-care">
      <div className="nesio-assets-carehead">
        {CARE_KINDS.map(({ k, zh, en }) => (
          <button key={k} type="button" className={`nesio-assets-chip${kind === k ? ' on' : ''}`}
            onClick={() => setKind(kind === k ? null : k)}>
            + {L(dict, zh, en)}
          </button>
        ))}
      </div>

      {kind && (
        <div className="nesio-assets-form">
          <input className="nesio-assets-input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'tax' ? L(dict, '什么税(如:2026 房产税)', 'Which tax') : kind === 'repair' ? L(dict, '修了什么', 'What was fixed') : L(dict, '做了什么(如:保养 / 清洗空调)', 'What was done')} />
          <div className="nesio-assets-row2">
            <input className="nesio-assets-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="nesio-assets-input" value={amount} onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal" placeholder={L(dict, '花了多少(可空)', 'Cost (optional)')} />
          </div>
          <input className="nesio-assets-input" list={`care-people-${assetId}`} value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder={L(dict, '谁做的(可从关系里挑)', 'Who did it (pick from People)')} />
          <datalist id={`care-people-${assetId}`}>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </datalist>
          {kind !== 'tax' && (
            <input className="nesio-assets-input" value={every} onChange={(e) => setEvery(e.target.value)}
              inputMode="numeric" placeholder={L(dict, '多久做一次(月;空=一次性)', 'Every N months (blank = one-off)')} />
          )}
          {Number(every) > 0 && (
            <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
              {L(dict, `下次:${nextDueDate(date, Number(every))}`, `Next: ${nextDueDate(date, Number(every))}`)}
            </p>
          )}
          <div className="nesio-assets-row2">
            <button type="button" className="nesio-assets-btn" onClick={() => setKind(null)}>{L(dict, '稍后', 'Later')}</button>
            <button type="button" className="nesio-assets-btn pri" onClick={submit} disabled={!title.trim()}>{L(dict, '记下来', 'Save')}</button>
          </div>
        </div>
      )}

      {records.slice(0, 12).map((r) => (
        <div key={r.id} className="nesio-assets-rec">
          <div className="l">
            <span className="t">{r.title}</span>
            <span className="m">
              {r.date}
              {r.providerName ? ` · ${r.providerName}` : ''}
              {r.everyMonths ? L(dict, ` · 每 ${r.everyMonths} 个月`, ` · every ${r.everyMonths}mo`) : ''}
              {r.nextDate ? L(dict, ` · 下次 ${r.nextDate}`, ` · next ${r.nextDate}`) : ''}
            </span>
          </div>
          <div className="r">
            {r.amount ? <span className="a">{money(r.amount)}</span> : null}
            <button type="button" className="x" aria-label={L(dict, '删除', 'Delete')} onClick={() => removeCareRecord(r.id)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
