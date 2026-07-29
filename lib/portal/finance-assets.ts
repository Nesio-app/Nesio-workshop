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
import { loadBankAccounts, assetSummary, loadHoldings } from './bank-tx';

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

/** 手动净值 = Σ asset − Σ liability(纯函数,可单测)。 */
export function manualNetWorth(assets: readonly ManualAsset[]): number {
  let net = 0;
  for (const a of assets) net += (a.classification === 'liability' ? -1 : 1) * assetCurrentValue(a);
  return Math.round(net * 100) / 100;
}

/** 总净值 = Plaid 口径 + 手动(币种按用户拍板不折算,简单相加)。 */
export function combinedNetWorth(): { plaidNet: number; manualNet: number; net: number } {
  const plaidNet = assetSummary(loadBankAccounts()).net;
  const manualNet = manualNetWorth(listManualAssets());
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
