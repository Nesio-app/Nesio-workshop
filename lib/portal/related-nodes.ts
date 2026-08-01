/**
 * related-nodes —— 记忆详情下面那串「相关」。
 *
 * ## 2026-07-30 反链保底
 *
 * 原来把三种信号混在一起打分(显式边 +10、共同标签 ×3、关键词 ×2)然后 `slice(0, 5)`。
 * **4 个共同标签就是 12 分,压过一条真关联的 10 分** —— 你亲手连的那条会因为旁边
 * 几条标签相近的记忆而根本不显示。
 *
 * 这两件事本来就不是一回事:
 *   · **显式关联是事实** —— 你连的,或者系统按航班号/金额确定性连的。必须**全部展示**,
 *     不打分、不截断(Notion 的反链面板就是这么做的)。
 *   · **相关是猜测** —— 标签/关键词像而已。可以打分、可以截断。
 *
 * 抽成独立模块是为了**能真跑测试**:原来它是 MemoryTab 里的局部函数,契约只能 grep
 * 源码,而 grep 挡不住「在末尾再补一个 slice」这种回归(自查时正好踩到)。
 */

export interface RelatableNode {
  id: string;
  name: string;
  rawInput?: string;
  createdAt: string;
  tags?: string[];
  relations?: Array<{ targetId: string; relation: string }>;
  attributes?: Record<string, unknown>;
}

/** 「相关」最多补几条猜出来的。**显式关联不占这个额度。** */
export const RELATED_GUESS_CAP = 5;

export interface RankDeps {
  /** 从文本里抽关键词(复用调用方那套,免得两处分词不一致)。 */
  extractKeywords: (text: string) => string[];
  /** 天气这类背景数据不算记忆。 */
  isExcluded: (n: RelatableNode) => boolean;
  /** 批量导入的:不靠标签/关键词猜,噪声太大(显式连过的仍然算)。 */
  isBulkImported: (n: RelatableNode) => boolean;
  /** 不参与「共同标签」计分的系统标签。 */
  systemTags: ReadonlySet<string>;
}

export interface RankResult {
  /** 显式关联 —— 一条不少,永远排最前。 */
  explicit: RelatableNode[];
  /** 猜出来的,已按分排序并截断。 */
  guessed: RelatableNode[];
}

/**
 * 分开算,别混。调用方要一个列表的话取 `[...explicit, ...guessed]` ——
 * **不要再对合起来的结果截断**,那就等于把显式关联又挤掉了。
 */
export function rankRelatedNodes(
  target: RelatableNode,
  all: readonly RelatableNode[],
  deps: RankDeps,
): RankResult {
  const targetWords = deps.extractKeywords(`${target.name} ${target.rawInput || ''}`);
  const targetTags = new Set((target.tags || []).filter((t) => !deps.systemTags.has(t)));
  const isExplicit = (node: RelatableNode) => Boolean(
    target.relations?.some((r) => r.targetId === node.id)
    || node.relations?.some((r) => r.targetId === target.id),
  );

  const pool = all.filter((n) => n.id !== target.id && !deps.isExcluded(n));
  const explicit = pool.filter(isExplicit);
  const explicitIds = new Set(explicit.map((n) => n.id));

  const guessed = pool
    .filter((n) => !explicitIds.has(n.id))
    .map((node) => {
      let score = (node.tags || []).filter((t) => targetTags.has(t)).length * 3;
      const nodeWords = deps.extractKeywords(`${node.name} ${node.rawInput || ''}`);
      score += targetWords.filter((w) => nodeWords.includes(w)).length * 2;
      if (deps.isBulkImported(node)) score = 0;
      return { node, score };
    })
    .filter((s) => s.score >= 2)
    // 批次 53:同分(循环日历的每一次 Sprint 计划分数一样)按日期升序,读起来是时间线
    .sort((a, b) => b.score - a.score
      || String(a.node.attributes?.start ?? a.node.createdAt).localeCompare(String(b.node.attributes?.start ?? b.node.createdAt)))
    .slice(0, RELATED_GUESS_CAP)
    .map((s) => s.node);

  return { explicit, guessed };
}
