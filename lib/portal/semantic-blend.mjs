/**
 * 文本 rank × cosine 相似度的混合(纯函数,供 semantic-rerank.ts 与 node 行为测试共用)。
 *
 * cosine 对相关文本聚在 0.7–0.9 的窄带,而文本 rankScore 占满 [0,1]。直接 0.5/0.5 混合
 * 会让宽方差的 rank 淹没窄带的 sim,语义只能轻微扰动排序。这里先把"有向量"的 sim 做
 * min-max 归一化(拉到 [0,1]),再等权混合,让语义真正参与排序;无向量的节点退回纯 rank
 * (语义未知,不惩罚)。
 */

/**
 * @param {{ rank:number, sim:number, hasVec:boolean }[]} items  rank∈[0,1];sim=cosine;hasVec=是否有向量
 * @param {number} wRank
 * @param {number} wSim
 * @returns {number[]} 与 items 等长的最终分
 */
export function blendRankSim(items, wRank = 0.5, wSim = 0.5) {
  const present = items.filter((it) => it.hasVec).map((it) => it.sim);
  const lo = present.length ? Math.min(...present) : 0;
  const hi = present.length ? Math.max(...present) : 0;
  const range = hi - lo;
  return items.map((it) => {
    if (!it.hasVec) return it.rank;                 // 无向量 → 纯 rank,不被语义拉低
    const norm = range > 1e-9 ? (it.sim - lo) / range : 0.5; // 全相等 → 中性 0.5
    return wRank * it.rank + wSim * norm;
  });
}
