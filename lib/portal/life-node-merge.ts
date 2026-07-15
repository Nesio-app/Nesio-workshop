/**
 * 生活图谱节点冲突合并(数据审计#3 收尾,批次209)。
 *
 * 跨端同一 id 节点冲突:按 attributes.updatedAt(缺失退 createdAt)取新者的标量字段;
 * **attributes / tags 两侧并集**(较旧侧独有键不丢)。
 *
 * 为何不是整节点 LWW:mergeCloudMemorySnapshot 曾用 `{...loser, ...winner}` 浅合并 —— 顶层独有
 * 字段虽保留,但嵌套 attributes 被整体替换 → A 端离线加 expiry、B 端离线加 location、B 较新,
 * 合并后 A 的 expiry 静默丢。并集消除这个「并发加不同属性丢一侧」的真丢数据窗。
 *
 * 为何不上 per-field 时间戳 / CRDT:单用户个人图谱里「两端离线并发编辑同一节点**同一字段**」极罕见,
 * CRDT 是过度工程(违背架构护栏:不做无谓复杂度)。并集覆盖最常见的「并发加不同属性/标签」,
 * 是性价比最高的根因收敛。代价:较旧侧删掉、较新侧仍留的键会被并集「复活」—— 属性删除本就罕见,
 * 用「加得多、删得少」的现实换掉「并发加静默丢」,净正。
 */
import type { LifeNode } from './life-graph';

/** 冲突时间戳:attributes.updatedAt(编辑时刻)优先,缺失退 createdAt。 */
export function nodeStamp(n: LifeNode): string {
  return String((n.attributes?.updatedAt as string) || n.createdAt || '');
}

/**
 * 合并两个同 id 节点:新者(updatedAt 大)赢标量字段,attributes/tags 两侧并集。
 * assets 由调用方另行并集(需要外部资产索引,不在纯合并内)。
 */
export function mergeConflictingNodes(a: LifeNode, b: LifeNode): LifeNode {
  const bWins = nodeStamp(b) >= nodeStamp(a);
  const winner = bWins ? b : a;
  const loser = bWins ? a : b;
  return {
    ...loser,
    ...winner,
    attributes: { ...(loser.attributes || {}), ...(winner.attributes || {}) },
    tags: Array.from(new Set([...(loser.tags || []), ...(winner.tags || [])])),
  };
}
