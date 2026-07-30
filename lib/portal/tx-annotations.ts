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
 *
 * ## ⚠️ 这一层**不是**关联的归宿
 *
 * 全仓只有财务页读这张表。所以只写这里的话:你把一笔钱关联给 Linda,
 * **Linda 的关系页看不到,记忆库也搜不到**。
 *
 * 真关联落在图上(`tx-graph-bridge.ts`)—— 每一笔流水都有节点,人也有节点,
 * 两者之间连一条真边。这里的字段是那条边的**投影**,给财务页快速渲染用
 * (按 tx.id 取一行,不用扫全图)。
 *
 * 所以下面每个写入函数都是**两写**:覆盖层 + 图。图写失败要让调用方知道
 * (返回里带 graphOk)—— 静默的话就等于「你以为关联上了,其实别处还是看不到」,
 * 那正是这一层要修的毛病。
 */

import { reportStorageDropped } from './storage-health';
import { deleteLocalFile } from './local-file-store';
import { linkTxToPerson, unlinkTxFromPerson, attachAssetToTx, detachAssetFromTx, type BridgeResult } from './tx-graph-bridge';

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

/** 两写的结果:`ok` 是覆盖层(财务页看得到吗),`graphOk` 是图(别处看得到吗)。 */
export interface TxWriteResult { ok: boolean; graphOk: boolean; reason?: BridgeResult['reason'] }

export function setTxPeople(txId: string, people: string[]): TxWriteResult {
  const uniq = [...new Set(people.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const before = new Set(txAnnotationOf(txId).people || []);
  const ok = write(txId, { people: uniq });
  // 图上按差集增删 —— 不是每次全删重连:重连会把 linkNodes 建的边(带 createdAt)
  // 全部换成新的,关联的"什么时候连上的"就丢了。
  let graphOk = true; let reason: BridgeResult['reason'];
  for (const k of uniq) {
    if (before.has(k)) continue;
    const r = linkTxToPerson(txId, k);
    if (!r.graphOk) { graphOk = false; reason = reason ?? r.reason; }
  }
  for (const k of before) {
    if (uniq.includes(k)) continue;
    const r = unlinkTxFromPerson(txId, k);
    if (!r.graphOk) { graphOk = false; reason = reason ?? r.reason; }
  }
  return { ok, graphOk, reason };
}

export function toggleTxPerson(txId: string, personKey: string): TxWriteResult {
  const cur = txAnnotationOf(txId).people || [];
  const k = personKey.trim().toLowerCase();
  return setTxPeople(txId, cur.includes(k) ? cur.filter((p) => p !== k) : [...cur, k]);
}

export function setTxNote(txId: string, note: string): boolean {
  return write(txId, { note: note.trim() });
}

export function addTxAttachment(txId: string, att: TxAttachment): TxWriteResult {
  const cur = txAnnotationOf(txId).attachments || [];
  if (cur.some((a) => a.assetId === att.assetId)) return { ok: true, graphOk: true };
  const ok = write(txId, { attachments: [...cur, att] });
  // 同时挂到流水节点的 node.assets —— 记忆详情/问一问取附件都走那里,
  // 只写覆盖层的话这张发票除了财务页哪儿都看不到。
  const g = attachAssetToTx(txId, {
    id: att.assetId,
    kind: att.mimeType?.startsWith('image/') ? 'image' : 'file',
    local: true,
    ...(att.mimeType ? { mimeType: att.mimeType } : {}),
    ...(att.name ? { label: att.name } : {}),
    createdAt: new Date().toISOString(),
  });
  return { ok, graphOk: g.graphOk, reason: g.reason };
}

/** 删附件:元信息和 IndexedDB 里的本体一起删(否则本体成孤儿,永远占着配额)。 */
export async function removeTxAttachment(txId: string, assetId: string): Promise<boolean> {
  const cur = txAnnotationOf(txId).attachments || [];
  const ok = write(txId, { attachments: cur.filter((a) => a.assetId !== assetId) });
  detachAssetFromTx(txId, assetId);   // 图上也摘掉,否则节点还指着一个已删的本体 → 破图
  await deleteLocalFile(assetId);
  return ok;
}
