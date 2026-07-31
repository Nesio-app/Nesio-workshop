/**
 * finance-assets — 手动资产 + 估值锚点 + 净值日快照(财务大修 P1;设计=artifact fb540e24 v3.3)。
 *
 * 模型借 maybe 的形(AGPL 只借形不借码):资产没有「当前值」真值字段 —— 值 = 最新锚点;
 * 锚点是带日期/依据的事实,可回溯可改(与 Signal 主事实表同精神)。
 * classification 决定净值符号(loan=liability 减);kind='cash' 的资产可作「+」记账的资金渠道
 * (现金/红包只是例子)。币种按用户拍板不考虑 —— 净值简单相加。
 *
 * 快照:每次 Plaid 同步/手动改动落一条当日净值快照(按日 upsert,留 730 天),
 * 「今天 +$860」= 与上一快照比 —— 不假装实时行情。
 * 存储经 createBlobStore(IDB)→ 自动登记进备份 + 云模块同步枚举(换端不丢)。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import { loadBankAccounts, assetSummaryWithHoldings, loadHoldings } from './bank-tx';
import { loadDomainExpenses } from './finance-sources';

export const FIN_ASSETS_KEY = 'nesio-fin-assets-v1';
export const FIN_NETWORTH_SERIES_KEY = 'nesio-fin-networth-series-v1';
export const FIN_ASSETS_EVENT = 'nesio-fin-assets-updated';

export type ManualAssetKind = 'property' | 'vehicle' | 'cash' | 'crypto' | 'collect' | 'loan' | 'other';

export interface AssetAnchor {
  date: string;   // YYYY-MM-DD
  value: number;  // 该日总值(loan 为剩余欠款,存正数)
  note?: string;  // 依据(链家参考/银行评估/自己估的/盘点…)
}

export interface ManualAsset {
  id: string;
  name: string;
  kind: ManualAssetKind;
  /** 净值符号:asset 加 / liability 减(loan 默认 liability)。 */
  classification: 'asset' | 'liability';
  /** cash 型渠道:可在「+」记一笔里作为资金渠道(现金钱包/微信红包…)。 */
  isChannel?: boolean;
  /** 锚点,新→旧排序。值 = anchors[0].value。 */
  anchors: AssetAnchor[];
  createdAt: string;
  /**
   * #10(2026-07-30 真机):「资产 → 车」里同时躺着「JingBell」(Tesla 实时数据)和
   * 「Model Y」($0 的手动空壳)—— 同一个分类下两套互不关联的车辆数据入口。
   * 它们本来就是同一辆车的两半:一半是接口来的现在什么样,一半是你自己记的
   * 估值 / 保养 / 税费。绑上之后两半合成一张卡。
   * 空 = 没绑(用户明说过「分开也不影响」,所以绑定是可选的,不绑照旧各显各的)。
   */
  teslaVehicleId?: string;
}

const assetsStore = createBlobStore<ManualAsset[]>({
  key: FIN_ASSETS_KEY, updateEvent: FIN_ASSETS_EVENT,
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

export interface NetWorthSnapshot {
  date: string;        // YYYY-MM-DD
  plaidNet: number;    // Plaid 口径净资产(assetSummary.net)
  manualNet: number;   // 手动资产净值
  investTotal: number; // 投资账户市值合计(当日收益播报用)
}

const seriesStore = createBlobStore<NetWorthSnapshot[]>({
  key: FIN_NETWORTH_SERIES_KEY, updateEvent: FIN_ASSETS_EVENT,
  validate: (v) => Array.isArray(v), onWriteError: reportStorageDropped,
});

/** 冷启动竞态修复:两个 store 水合完成(FinanceTab 等它再判空,不丢首个 emit)。 */
export function finAssetsReady(): Promise<void> {
  return Promise.all([assetsStore.ready(), seriesStore.ready()]).then(() => undefined);
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FIN_ASSETS_EVENT));
}

function sortAnchors(anchors: AssetAnchor[]): AssetAnchor[] {
  return [...anchors].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function listManualAssets(): ManualAsset[] {
  const raw = assetsStore.load();
  return Array.isArray(raw) ? raw.filter((a) => a && a.id && Array.isArray(a.anchors)) : [];
}

export function addManualAsset(input: {
  name: string; kind: ManualAssetKind; value: number; date?: string; note?: string; isChannel?: boolean;
}): ManualAsset {
  const asset: ManualAsset = {
    id: `fin-asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    kind: input.kind,
    classification: input.kind === 'loan' ? 'liability' : 'asset',
    ...(input.isChannel || input.kind === 'cash' ? { isChannel: true } : {}),
    anchors: [{ date: input.date || todayStr(), value: input.value, ...(input.note ? { note: input.note } : {}) }],
    createdAt: new Date().toISOString(),
  };
  assetsStore.save([asset, ...listManualAssets()]);
  emit();
  return asset;
}

/** 记一条估值锚点(同日覆盖 —— 一天只留一条,改错可重记)。 */
/**
 * 把这件资产绑到某辆 Tesla 车(#10)。传空串 = 解绑。
 * 只写这一个字段,不动估值/记录 —— 绑定是「这两半是同一辆车」的声明,不是数据迁移。
 */
export function bindAssetToTesla(assetId: string, vehicleId: string): boolean {
  const all = listManualAssets();
  const idx = all.findIndex((a) => a.id === assetId);
  if (idx < 0) return false;
  const v = vehicleId.trim();
  // 一辆车只能绑一件资产 —— 否则两张卡都说「这是 JingBell」,又是同屏两个事实
  if (v) for (let i = 0; i < all.length; i++) if (i !== idx && all[i].teslaVehicleId === v) all[i] = { ...all[i], teslaVehicleId: undefined };
  all[idx] = { ...all[idx], ...(v ? { teslaVehicleId: v } : { teslaVehicleId: undefined }) };
  assetsStore.save(all);
  return true;
}

export function addAssetAnchor(assetId: string, anchor: AssetAnchor): boolean {
  const all = listManualAssets();
  const idx = all.findIndex((a) => a.id === assetId);
  if (idx < 0) return false;
  const rest = all[idx].anchors.filter((x) => x.date !== anchor.date);
  all[idx] = { ...all[idx], anchors: sortAnchors([anchor, ...rest]) };
  assetsStore.save(all);
  emit();
  return true;
}

export function removeManualAsset(assetId: string): void {
  assetsStore.save(listManualAssets().filter((a) => a.id !== assetId));
  emit();
}

/** 资产当前值 = 最新锚点;无锚点为 0。 */
export function assetCurrentValue(a: Pick<ManualAsset, 'anchors'>): number {
  return sortAnchors(a.anchors)[0]?.value ?? 0;
}

/** 渠道余额(用户拍板:补上推算)= 最新锚点(盘点)+ 锚点日之后该渠道的 收入−支出。
 *  maybe 的 balance-with-anchors 语义:锚点是硬复位点,其间按记账事实累加 —— 记账终于会动余额。 */
export function channelBalance(
  a: Pick<ManualAsset, 'id' | 'anchors'>,
  expenses: ReadonlyArray<{ channelId?: string; kind?: string; amount: number; occurredAt: string }>,
): number {
  const anchor = sortAnchors(a.anchors)[0];
  let bal = anchor?.value ?? 0;
  const since = anchor?.date ?? '';
  for (const e of expenses) {
    if (e.channelId !== a.id) continue;
    if (since && (e.occurredAt || '') <= since) continue; // 盘点日及之前的已被盘点吸收
    bal += (e.kind === 'income' ? 1 : -1) * e.amount;
  }
  return Math.round(bal * 100) / 100;
}

/** 手动净值 = Σ asset − Σ liability;渠道用推算余额(传 expenses 时),其余用锚点值。 */
export function manualNetWorth(
  assets: readonly ManualAsset[],
  expenses?: ReadonlyArray<{ channelId?: string; kind?: string; amount: number; occurredAt: string }>,
): number {
  let net = 0;
  for (const a of assets) {
    const v = a.isChannel && expenses ? channelBalance(a, expenses) : assetCurrentValue(a);
    net += (a.classification === 'liability' ? -1 : 1) * v;
  }
  return Math.round(net * 100) / 100;
}

/** 总净值 = Plaid 口径(投资账户无 balance 时用持仓市值兜底)+ 手动(币种按用户拍板不折算,简单相加)。 */
export function combinedNetWorth(): { plaidNet: number; manualNet: number; net: number } {
  const plaidNet = assetSummaryWithHoldings(loadBankAccounts(), loadHoldings()).net;
  let manualNet: number;
  try { manualNet = manualNetWorth(listManualAssets(), loadDomainExpenses()); }
  catch { manualNet = manualNetWorth(listManualAssets()); }
  return { plaidNet, manualNet, net: Math.round((plaidNet + manualNet) * 100) / 100 };
}

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SERIES_CAP = 730; // 两年日粒度

export function loadNetWorthSeries(): NetWorthSnapshot[] {
  const raw = seriesStore.load();
  return Array.isArray(raw) ? raw : [];
}

/** 快照纯核心:按日 upsert、日期降序、cap 截断(可单测)。 */
export function upsertSnapshot(series: readonly NetWorthSnapshot[], snap: NetWorthSnapshot, cap = SERIES_CAP): NetWorthSnapshot[] {
  return [snap, ...series.filter((s) => s.date !== snap.date)]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, cap);
}

/** 落一条今日净值快照(同步后/手动改动后调用;幂等 —— 一天一条,后写覆盖)。 */
export function recordNetWorthSnapshot(now = new Date()): NetWorthSnapshot {
  const { plaidNet, manualNet } = combinedNetWorth();
  const investTotal = Math.round(loadHoldings().reduce((s, h) => s + (h.value || 0), 0) * 100) / 100;
  const snap: NetWorthSnapshot = { date: todayStr(now), plaidNet, manualNet, investTotal };
  seriesStore.save(upsertSnapshot(loadNetWorthSeries(), snap));
  emit();
  return snap;
}

/** 「今天 +$860」:最新快照 vs 上一条(纯函数)。不足两条返回 null —— 不编数。 */
export function investDailyChange(series: readonly NetWorthSnapshot[]): { delta: number; pct: number; fromDate: string } | null {
  const s = [...series].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (s.length < 2) return null;
  const [cur, prev] = s;
  if (!(prev.investTotal > 0)) return null;
  const delta = Math.round((cur.investTotal - prev.investTotal) * 100) / 100;
  return { delta, pct: Math.round((delta / prev.investTotal) * 10000) / 100, fromDate: prev.date };
}

/* ---------- P2:折旧与持有成本(用户拍板:固定资产要记折旧/税金/维修) ---------- */

/** 折旧(纯回溯):最早锚点 − 最新锚点,>0 才有意义(车贬值);升值资产返回 0。 */
export function assetDepreciation(a: Pick<ManualAsset, 'anchors'>): number {
  if (a.anchors.length < 2) return 0;
  const sorted = [...a.anchors].sort((x, y) => (x.date < y.date ? 1 : -1));
  const dep = sorted[sorted.length - 1].value - sorted[0].value;
  return dep > 0 ? Math.round(dep * 100) / 100 : 0;
}

export interface AssetCosts { tax: number; repair: number; insurance: number; other: number; total: number; count: number }

/** 资产持有成本归集(税金/维修/保险…):关联到该资产的支出,当年口径。纯函数。 */
export function assetHoldingCosts(
  assetId: string,
  expenses: ReadonlyArray<{ assetId?: string; assetCostKind?: string; amount: number; occurredAt: string; kind?: string }>,
  year = new Date().getFullYear(),
): AssetCosts {
  const out: AssetCosts = { tax: 0, repair: 0, insurance: 0, other: 0, total: 0, count: 0 };
  for (const e of expenses) {
    if (e.assetId !== assetId || e.kind === 'income') continue;
    if (Number((e.occurredAt || '').slice(0, 4)) !== year) continue;
    const k = (e.assetCostKind || 'other') as keyof AssetCosts;
    if (k === 'tax' || k === 'repair' || k === 'insurance' || k === 'other') out[k] += e.amount;
    out.total += e.amount;
    out.count += 1;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { tax: r2(out.tax), repair: r2(out.repair), insurance: r2(out.insurance), other: r2(out.other), total: r2(out.total), count: out.count };
}
