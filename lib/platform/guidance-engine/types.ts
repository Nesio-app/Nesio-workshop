/**
 * Guidance Engine — 硬拆后仅存的公共类型(2026-07-29,8 层规则管线已物理删除)。
 * 判决/门/兜底的类型各自住在 ai-judge.ts / guidance-gates.ts / fallback-cards.ts;
 * 这里只留仍被域模块(衣橱/跨区)引用的洞察条目形状。
 */

/** 域洞察条目 —— 各域引擎的统一输出形状(衣橱 outfitFindings / 跨区 deliver 仍产出它)。 */
export interface DomainInsightItem {
  id: string;               // 域内稳定 id
  severity: 'flag' | 'attention';
  title: [string, string];  // [zh, en]
  body: [string, string];   // [zh, en]
  cta: [string, string];
}
