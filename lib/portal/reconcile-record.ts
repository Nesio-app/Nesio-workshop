/**
 * reconcile-record — 对账记录 + 凭证(L4)。
 *
 * 每对一次账留一条记录:哪份文件、哪个账期、你说的数、我算的数、差多少、
 * 最后接受了几笔、原始 PDF 存在哪。
 *
 * 为什么要留:
 *   · 三个月后发现某月数字不对,能查到「那个月是拿这份 statement 对的,当时差 $0」——
 *     没有这条记录的话,只能重新对一遍,而账本已经被改过了,对不回去。
 *   · 「已锁定」那一档要有依据。锁一个月的账,依据就是这条记录。
 *   · 凭证(原始 PDF)是会计意义上的原始单据。存本机 local-file-store,
 *     和其他附件同一套 —— 会进你自己的备份,不进任何服务器。
 *
 * 一条记录**不可改**:它记的是「那一刻的对账结论」。发现结论错了要重新对一次、
 * 留一条新记录,而不是回去改旧的 —— 改了就没有审计线索可言了。
 */

import { reportStorageDropped } from './storage-health';

export const RECONCILE_RECORDS_KEY = 'nesio-reconcile-records-v1';
/** 记录上限:超了丢最旧的。审计价值集中在近期,而无上限会把 localStorage 撑爆。 */
export const RECONCILE_RECORDS_MAX = 200;

export interface ReconcileRecord {
  id: string;
  /** 同一份文件的稳定键(文件名 + 大小 + 修改时间),幂等用。 */
  fileKey: string;
  fileName: string;
  accountTail?: string;
  periodStart?: string;
  periodEnd?: string;
  /** 你(单子)说的期末余额。 */
  expected?: number;
  /** 我按解析出的交易算的。 */
  computed?: number;
  /** expected − computed。0 = 对上了。 */
  delta?: number;
  /** 这次接受进账本的笔数。 */
  acceptedCount: number;
  /** 凭证:原始 PDF 在 local-file-store 里的 assetId(没存凭证时为空)。 */
  voucherAssetId?: string;
  createdAt: string;
}

export function loadReconcileRecords(): ReconcileRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECONCILE_RECORDS_KEY) || '[]') as unknown;
    return Array.isArray(v) ? (v as ReconcileRecord[]) : [];
  } catch { return []; }
}

/**
 * 追加一条。返回 false = 没存上,调用方必须给可见失败态 ——
 * 静默失败的话人以为「已经留痕了」,而其实什么都没有,那比不做更糟。
 */
export function addReconcileRecord(r: Omit<ReconcileRecord, 'id' | 'createdAt'>): ReconcileRecord | null {
  if (typeof window === 'undefined') return null;
  const now = new Date().toISOString();
  const row: ReconcileRecord = {
    ...r,
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };
  // 最新的在前,超上限丢最旧的
  const next = [row, ...loadReconcileRecords()].slice(0, RECONCILE_RECORDS_MAX);
  try { localStorage.setItem(RECONCILE_RECORDS_KEY, JSON.stringify(next)); return row; }
  catch { reportStorageDropped(); return null; }
}

/** 这份文件之前对过几次(同一份单子重复上传时给人看,不是拦截)。 */
export function recordsForFile(fileKey: string, all = loadReconcileRecords()): ReconcileRecord[] {
  return all.filter((r) => r.fileKey === fileKey);
}

/** 凭证在 local-file-store 里的 assetId 约定。同一份文件恒定 —— 重复上传不占两份空间。 */
export function voucherAssetId(fileKey: string): string {
  // 只取可见字符,避免文件名里的空格/斜杠把 key 弄脏
  return `stmt:${fileKey.replace(/[^\w.:-]+/g, '_')}`;
}
