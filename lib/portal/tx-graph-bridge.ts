/**
 * tx-graph-bridge — 把交易批注(人 / 附件)写到**图上**,而不只是财务页的覆盖层。
 *
 * ## 为什么需要这一层
 *
 * `tx-annotations` 是按 tx.id 存的本机覆盖层,**全仓只有财务页读它**。所以在它上面
 * 关联一个人,后果是:Linda 的关系页看不到这笔钱、记忆库搜不到、问一问引用不到。
 * 关联做了,但只有一个地方认。
 *
 * 图才是那些能力的所在地。每一笔流水现在都有一个轻量节点(`tx-node.ts`),
 * 所以「接线」就是:批注写进覆盖层的**同时**,在图上落一条真关联。
 *
 * ## 两边各管什么
 *
 *   · **覆盖层**(tx-annotations)—— 财务页自己的显示状态。人的 key、备注、附件元信息。
 *     它必须留着:财务页按 tx.id 渲染,不该为了显示一行字去扫全图。
 *   · **图**(这一层)—— 人↔这笔钱的双向关联、附件本体挂在 `node.assets`。
 *     关系页、记忆库、问一问、回看都从这里读。
 *
 * 覆盖层是**投影**,图是**事实**。两边不一致时以图为准 —— 覆盖层可以重建,
 * 图上的关联丢了就是真丢了。
 *
 * ## 失败不静默
 *
 * 图没写成功要让调用方知道(返回 `graphOk: false`),因为那意味着「你以为关联上了,
 * 其实 Linda 那边还是看不到」—— 这正是这一层要修的问题,不能修完又在自己内部
 * 复现一遍。
 */

import { getLifeGraph, linkNodes, unlinkNodes, updateLifeNode, type LifeNode, type LifeNodeAsset } from './life-graph';
import { findTxNode } from './tx-node';
import { resolveEntityKey, loadEntityAliases } from './entity-resolution';

/** 「这笔钱和这个人有关」。跟认领(paid_by_tx)是两回事:认领是「这件东西花的就是这笔」。 */
export const TX_PERSON_RELATION = 'involves_person';

/**
 * 按 key 找 person 节点。
 *
 * 覆盖层存的是 `personKey`(小写名字或邮箱),图上是 person 节点。走 `resolveEntityKey`
 * 而不是字符串相等 —— 「妈妈 / 母亲」是同一个人,别名表就是为这个存在的。
 */
export function findPersonNode(personKey: string, graph?: readonly LifeNode[]): LifeNode | null {
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  const aliases = (() => { try { return loadEntityAliases(); } catch { return {}; } })();
  const want = resolveEntityKey(personKey, aliases);
  if (!want) return null;
  for (const n of g) {
    if (n.type !== 'person' || !n.name) continue;
    if (resolveEntityKey(n.name, aliases) === want) return n;
    const em = typeof n.attributes?.email === 'string' ? n.attributes.email : '';
    if (em && resolveEntityKey(em, aliases) === want) return n;
  }
  return null;
}

export interface BridgeResult {
  /** 图上写成功了吗。false = 关联只落在财务页,别的地方看不到。 */
  graphOk: boolean;
  /** 没写成的原因,给 UI 出具体提示用(别只说「失败了」)。 */
  reason?: 'no_tx_node' | 'no_person_node' | 'link_failed';
  /**
   * 这笔钱在图上的节点 id。给「挂完附件还要往同一条节点里补东西」的调用方用
   * (端上认出来的发票原文要落进这条节点的 rawInput,否则票上的字一个都搜不到)。
   * 没找到节点时不存在 —— 和 graphOk:false 同时发生。
   */
  nodeId?: string;
}

/**
 * 人 ↔ 这笔钱,写到图上。
 *
 * 两头都必须是真节点:流水节点(同步时建的)和 person 节点。缺哪头就报哪头 ——
 * 「这个人还不在通讯录里」和「这笔流水还没同步进来」是两个完全不同的问题,
 * 合并成一句「关联失败」的话用户根本不知道该干什么。
 */
export function linkTxToPerson(txId: string, personKey: string): BridgeResult {
  const graph = (() => { try { return getLifeGraph(); } catch { return []; } })();
  const txNode = findTxNode(txId, graph);
  if (!txNode) return { graphOk: false, reason: 'no_tx_node' };
  const person = findPersonNode(personKey, graph);
  if (!person) return { graphOk: false, reason: 'no_person_node' };
  const r = linkNodes(txNode.id, person.id, TX_PERSON_RELATION);
  return r.ok ? { graphOk: true } : { graphOk: false, reason: 'link_failed' };
}

/** 解除。找不到节点就当已经没有了 —— 解除的语义是「让它不存在」,不存在就是成功。 */
export function unlinkTxFromPerson(txId: string, personKey: string): BridgeResult {
  const graph = (() => { try { return getLifeGraph(); } catch { return []; } })();
  const txNode = findTxNode(txId, graph);
  if (!txNode) return { graphOk: true };
  const person = findPersonNode(personKey, graph);
  if (!person) return { graphOk: true };
  unlinkNodes(txNode.id, person.id, TX_PERSON_RELATION);
  return { graphOk: true };
}

/**
 * 附件挂到流水节点的 `node.assets`。
 *
 * 本体仍在 IndexedDB(`local-file-store`),这里只挂元信息 —— 跟别的记忆一模一样。
 * 挂上之后记忆详情能看到、问一问能取到。
 */
export function attachAssetToTx(txId: string, asset: LifeNodeAsset): BridgeResult {
  const txNode = findTxNode(txId);
  if (!txNode) return { graphOk: false, reason: 'no_tx_node' };
  const existing = txNode.assets || [];
  if (existing.some((a) => a.id === asset.id)) return { graphOk: true, nodeId: txNode.id };
  const ok = updateLifeNode(txNode.id, { assets: [...existing, asset] });
  return ok ? { graphOk: true, nodeId: txNode.id } : { graphOk: false, reason: 'link_failed', nodeId: txNode.id };
}

/** 从流水节点摘掉附件元信息。本体的删除由调用方走 `removeTxAttachment`(它删 IndexedDB)。 */
export function detachAssetFromTx(txId: string, assetId: string): BridgeResult {
  const txNode = findTxNode(txId);
  if (!txNode) return { graphOk: true };
  const existing = txNode.assets || [];
  if (!existing.some((a) => a.id === assetId)) return { graphOk: true };
  const ok = updateLifeNode(txNode.id, { assets: existing.filter((a) => a.id !== assetId) });
  return ok ? { graphOk: true } : { graphOk: false, reason: 'link_failed' };
}

/** 这笔钱关联了哪些人(从**图**读,不是覆盖层)—— 关系页/问一问用这条。 */
export function peopleOfTx(txId: string, graph?: readonly LifeNode[]): LifeNode[] {
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  const txNode = findTxNode(txId, g);
  if (!txNode) return [];
  const ids = new Set((txNode.relations || []).filter((r) => r.relation === TX_PERSON_RELATION).map((r) => r.targetId));
  return g.filter((n) => ids.has(n.id));
}

/** 这个人关联了哪些流水节点 —— 关系页「这个人相关的钱」。 */
export function txNodesOfPerson(personNodeId: string, graph?: readonly LifeNode[]): LifeNode[] {
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  const person = g.find((n) => n.id === personNodeId);
  if (!person) return [];
  const ids = new Set((person.relations || []).filter((r) => r.relation === TX_PERSON_RELATION).map((r) => r.targetId));
  return g.filter((n) => ids.has(n.id));
}
