/**
 * asset-care —— 一件资产的「照料记录」:税费 / 维修 / 保养(Bug4 图23-24 的资产页)。
 *
 * 为什么不塞进 finance:钱那一半本来就该进财务(addManualEntry 带 assetId +
 * assetCostKind,assetHoldingCosts 会把它归集回这件资产)。但照料记录里有一半东西
 * 不是钱 —— 谁做的(关联到 people 里那个人)、多久做一次、下次什么时候。
 * 那半边在财务里无处安放,所以单独一张表,只存「事」,钱仍然只有财务一份真源。
 *
 * 落 IDB blob store:换端跟着备份/模块同步走,不占 localStorage 那 5MB。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import { deleteLocalImage } from './local-image-store';

export const ASSET_CARE_KEY = 'nesio-asset-care-v1';
export const ASSET_CARE_EVENT = 'nesio-asset-care-updated';

export type CareKind = 'tax' | 'repair' | 'maintenance';

export interface CareRecord {
  id: string;
  /** 关联的手动资产 id(finance-assets 的 ManualAsset.id) */
  assetId: string;
  kind: CareKind;
  /** 项目名:房产税 / 换热水器 / 保养 6 万公里… */
  title: string;
  /** 发生日 YYYY-MM-DD */
  date: string;
  /** 花了多少(可空 —— 有些保养是免费的/还没结账)。填了会同时进财务。 */
  amount?: number;
  /** 这笔钱在财务里的那一条 id —— 删记录时一并撤掉,不留孤儿账。 */
  expenseId?: string;
  /** 服务方:优先关联到 people 里的人;没有对应的人就留个名字。 */
  providerPersonId?: string;
  providerName?: string;
  /** 服务方联系方式(电话/微信/邮箱,原样存,不解析)。 */
  providerContact?: string;
  /**
   * 附件(合同/发票/维修单的照片)。存的是 local-image-store 的 assetId,
   * 图本身在 IndexedDB —— 这张表里只放 id,不塞 dataURL(会把 blob 撑爆)。
   */
  attachments?: string[];
  /** 周期(月)。填了才算「会再来一次」的事,才有下次时间。 */
  everyMonths?: number;
  /** 下次什么时候 YYYY-MM-DD。没显式填就按 date + everyMonths 推。 */
  nextDate?: string;
  note?: string;
  createdAt: string;
}

const store = createBlobStore<CareRecord[]>({
  key: ASSET_CARE_KEY,
  updateEvent: ASSET_CARE_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function assetCareReady(): Promise<void> {
  return store.ready().then(() => undefined);
}

export function listCareRecords(assetId?: string): CareRecord[] {
  const raw = store.load();
  const all = Array.isArray(raw) ? raw.filter((r) => r && r.id && r.assetId && r.date) : [];
  const rows = assetId ? all.filter((r) => r.assetId === assetId) : all;
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** date + everyMonths → 下次时间。月末对齐:1/31 + 1 月 = 2/28,不是 3/3。 */
export function nextDueDate(date: string, everyMonths?: number): string | undefined {
  if (!everyMonths || everyMonths <= 0) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const target = new Date(y, m - 1 + everyMonths, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(target.getDate())}`;
}

export function addCareRecord(input: Omit<CareRecord, 'id' | 'createdAt' | 'nextDate'> & { nextDate?: string }): CareRecord {
  const rec: CareRecord = {
    ...input,
    id: `care-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nextDate: input.nextDate || nextDueDate(input.date, input.everyMonths),
    createdAt: new Date().toISOString(),
  };
  store.save([rec, ...listCareRecords()].slice(0, 2000)); // save() 自己派 ASSET_CARE_EVENT
  return rec;
}

export function removeCareRecord(id: string): CareRecord | null {
  const all = listCareRecords();
  const hit = all.find((r) => r.id === id) || null;
  if (!hit) return null;
  store.save(all.filter((r) => r.id !== id));
  // 附件跟着记录一起走 —— 留在 IDB 里就是没人认领的孤儿图,只占空间。
  for (const a of hit.attachments ?? []) void deleteLocalImage(a);
  return hit;
}

/**
 * 要再做一次的事:有 nextDate 且没被更新的记录里,每个「项目」只留最近一次。
 * 同一个 title 保养过三次,该提醒的是最后那次推出来的下次,不是三条。
 */
export function upcomingCare(assetId?: string, now = new Date()): CareRecord[] {
  const bySlot = new Map<string, CareRecord>();
  for (const r of listCareRecords(assetId)) {
    if (!r.nextDate) continue;
    const slot = `${r.assetId}|${r.kind}|${r.title.trim()}`;
    const prev = bySlot.get(slot);
    if (!prev || r.date > prev.date) bySlot.set(slot, r);
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [...bySlot.values()]
    .filter((r) => (r.nextDate || '') >= today)
    .sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
}
