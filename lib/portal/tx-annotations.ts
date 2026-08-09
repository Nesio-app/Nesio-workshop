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
import { validateAllocation } from './ledger-allocation';
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
  /**
   * 分摊:这一笔钱拆到多个分类/人。
   *
   * **合计必须等于原额**(`validateAllocation` 卡到分)。差一分都不存 ——
   * 「大致分了一下」的分摊比不分更糟:分类汇总会少一块钱,而你看不出来少在哪。
   *
   * 分摊**不改变原额**,它是一个视图。总额聚合永远读原额,只有按分类/按人
   * 汇总时才走分摊(`allocationForCategoryTotals` 定的规矩)。
   */
  splits?: Array<{ target: string; amount: number; note?: string }>;
  /** 按月摊(年费/保险):`{ startMonth: '2026-01', months: 12 }`。同样只是视图。 */
  amortize?: { startMonth: string; months: number };
  /**
   * 本笔覆盖分类(PFC 或自由文本)。Plaid 同步不会带这个字段 ——
   * 必须放覆盖层,否则下次合并会冲掉「我改过的分类」。
   */
  category?: string;
  /** 子分类 / 自定义细分(PFC detailed 或自由文本)。 */
  categoryDetail?: string;
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
  // 分摊也算「有批注」—— 漏掉的话存进去的分摊会被当成空键当场删掉。
  return Boolean(
    (a.people && a.people.length) || (a.attachments && a.attachments.length) || (a.note && a.note.trim())
    || (a.splits && a.splits.length) || a.amortize
    || (a.category && a.category.trim()) || (a.categoryDetail && a.categoryDetail.trim()),
  );
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
export interface TxWriteResult {
  ok: boolean;
  graphOk: boolean;
  reason?: BridgeResult['reason'];
  /** 这笔钱在图上的节点 id(挂附件时才有)—— 端上认出的发票原文要补进这条节点。 */
  nodeId?: string;
}

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

export type SplitResult =
  | { ok: true }
  | { ok: false; reason: 'sum_mismatch'; delta: number }
  | { ok: false; reason: 'nonpositive' | 'empty' | 'duplicate_target' | 'write_failed' };

/**
 * 存分摊。**合计必须等于原额,差一分都不存。**
 *
 * 为什么这么硬:「大致分了一下」的分摊比不分更糟 —— 按分类汇总时会少一块钱,
 * 而你根本看不出来少在哪。`validateAllocation` 卡到分,这里只是把它的结论存下来。
 *
 * 失败原因原样返回(尤其 `delta`:还差多少没分),UI 能直接显示「还剩 $3.20 要摊」,
 * 而不是一句没用的「合计不对」。
 */
export function setTxSplits(
  txId: string, total: number,
  splits: ReadonlyArray<{ target: string; amount: number; note?: string }>,
): SplitResult {
  const v = validateAllocation(total, splits);
  if (!v.ok) return v.reason === 'sum_mismatch' ? { ok: false, reason: 'sum_mismatch', delta: v.delta } : { ok: false, reason: v.reason };
  return write(txId, { splits: v.splits }) ? { ok: true } : { ok: false, reason: 'write_failed' };
}

/** 撤掉分摊 —— 这一笔回到「整笔算在它自己的分类下」。 */
export function clearTxSplits(txId: string): boolean {
  return write(txId, { splits: [] });
}

/** 按月摊(年费/保险)。同样只是视图:不生成十二条新交易,原额不动。 */
export function setTxAmortize(txId: string, startMonth: string, months: number): boolean {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !(months >= 1)) return false;
  return write(txId, { amortize: { startMonth, months } });
}

export function clearTxAmortize(txId: string): boolean {
  return write(txId, { amortize: undefined });
}

export function setTxNote(txId: string, note: string): boolean {
  return write(txId, { note: note.trim() });
}

/**
 * 改这一笔的分类 / 子分类。空字符串 = 清掉覆盖,回到规则或 Plaid 原值。
 * 只影响本笔(不像商户规则会改同名商户的所有流水)。
 */
export function setTxCategory(
  txId: string,
  category: string,
  categoryDetail?: string | null,
): boolean {
  if (typeof window === 'undefined') return false;
  const all = loadTxAnnotations();
  const next: TxAnnotation = { ...(all[txId] || {}) };
  const cat = (category || '').trim();
  if (cat) next.category = cat; else delete next.category;
  if (categoryDetail !== undefined) {
    const detail = String(categoryDetail || '').trim();
    if (detail) next.categoryDetail = detail; else delete next.categoryDetail;
  }
  if (!hasTxAnnotation(next)) delete all[txId]; else all[txId] = next;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { reportStorageDropped(); return false; }
  window.dispatchEvent(new CustomEvent(TX_ANNOTATIONS_EVENT, { detail: { txId } }));
  return true;
}

/** 只改子分类 / 自定义细分(主分类不动)。 */
export function setTxCategoryDetail(txId: string, categoryDetail: string): boolean {
  const d = (categoryDetail || '').trim();
  return write(txId, { categoryDetail: d || undefined });
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
  return { ok, graphOk: g.graphOk, reason: g.reason, nodeId: g.nodeId };
}

/** 删附件:元信息和 IndexedDB 里的本体一起删(否则本体成孤儿,永远占着配额)。 */
export async function removeTxAttachment(txId: string, assetId: string): Promise<boolean> {
  const cur = txAnnotationOf(txId).attachments || [];
  const ok = write(txId, { attachments: cur.filter((a) => a.assetId !== assetId) });
  detachAssetFromTx(txId, assetId);   // 图上也摘掉,否则节点还指着一个已删的本体 → 破图
  await deleteLocalFile(assetId);
  return ok;
}
