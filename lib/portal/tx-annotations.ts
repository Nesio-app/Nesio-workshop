/**
 * tx-annotations — 交易流水的人工批注(bug3:「交易里的每一笔流水增加修改选择,
 * 我可以手动关联人,传附件等」)。
 *
 * 为什么单独一层:Plaid 流水是每次同步整体合并的机构数据,直接往 BankTx 上写字段
 * 会被下一次同步冲掉(账户自定义名 ACCT_NAME_KEY 就是因为这个才做成覆盖层)。
 * 这里同样只按 tx.id 存一份本机覆盖层:关联的人、附件、备注。
 *
 * 附件本体走 local-file-store(IndexedDB,唯一副本),这里只存 assetId + 元信息 ——
 * localStorage 放不下发票图,也不该放。
 */

import { reportStorageDropped } from './storage-health';
import { deleteLocalFile } from './local-file-store';

export interface TxAttachment {
  assetId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface TxAnnotation {
  /** 关联的人(relationships 的归一 key:小写名或邮箱) */
  people?: string[];
  attachments?: TxAttachment[];
  note?: string;
}

const KEY = 'nesio-fin-tx-annotations-v1';
export const TX_ANNOTATIONS_EVENT = 'nesio-tx-annotations-updated';

export function loadTxAnnotations(): Record<string, TxAnnotation> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, TxAnnotation>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function txAnnotationOf(txId: string, all?: Record<string, TxAnnotation>): TxAnnotation {
  return (all || loadTxAnnotations())[txId] || {};
}

/** 有没有批注(行上是否显示「人/附件」小标)。 */
export function hasTxAnnotation(a: TxAnnotation | undefined): boolean {
  if (!a) return false;
  return Boolean((a.people && a.people.length) || (a.attachments && a.attachments.length) || (a.note && a.note.trim()));
}

/**
 * 写一条批注。返回 false = 没写进去(配额满/隐私模式)——
 * 调用方必须把 false 变成可见的失败态,不许当成功(CLAUDE.md 红线)。
 */
function write(txId: string, patch: TxAnnotation): boolean {
  if (typeof window === 'undefined') return false;
  const all = loadTxAnnotations();
  const next: TxAnnotation = { ...(all[txId] || {}), ...patch };
  // 空批注就删键,别攒垃圾
  if (!hasTxAnnotation(next)) delete all[txId]; else all[txId] = next;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { reportStorageDropped(); return false; }
  window.dispatchEvent(new CustomEvent(TX_ANNOTATIONS_EVENT, { detail: { txId } }));
  return true;
}

export function setTxPeople(txId: string, people: string[]): boolean {
  const uniq = [...new Set(people.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  return write(txId, { people: uniq });
}

export function toggleTxPerson(txId: string, personKey: string): boolean {
  const cur = txAnnotationOf(txId).people || [];
  const k = personKey.trim().toLowerCase();
  return setTxPeople(txId, cur.includes(k) ? cur.filter((p) => p !== k) : [...cur, k]);
}

export function setTxNote(txId: string, note: string): boolean {
  return write(txId, { note: note.trim() });
}

export function addTxAttachment(txId: string, att: TxAttachment): boolean {
  const cur = txAnnotationOf(txId).attachments || [];
  if (cur.some((a) => a.assetId === att.assetId)) return true;
  return write(txId, { attachments: [...cur, att] });
}

/** 删附件:元信息和 IndexedDB 里的本体一起删(否则本体成孤儿,永远占着配额)。 */
export async function removeTxAttachment(txId: string, assetId: string): Promise<boolean> {
  const cur = txAnnotationOf(txId).attachments || [];
  const ok = write(txId, { attachments: cur.filter((a) => a.assetId !== assetId) });
  await deleteLocalFile(assetId);
  return ok;
}
