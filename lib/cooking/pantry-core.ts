/**
 * pantry-core — 做饭/库存的**纯确定性核心**(无浏览器依赖,可 node 单测)。
 * 对标 lib/family/chores-core:把算术/排序/判定从 I/O 里剥出来,便于契约测试。
 * 派生纪律:on_hand = 当前 qty;用掉一份 = qty>1 扣 1、否则用光删除。纯算术,不引 ML。
 */

/** 食材分类(快速添加选择器用;'' = 不分类)。纯分类学,可空。 */
export const PANTRY_CATEGORIES = ['蔬菜', '水果', '肉蛋', '海鲜', '主食', '奶豆', '调料', '饮品', '零食', '冷冻', '其他'] as const;
export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;   // on_hand;null = 不计数(如「牛奶」按有/无)
  expiry: string | null;     // 'YYYY-MM-DD'
  location: string;          // 原始 location('' = 未归位)
  category: string;          // '' = 未分类
  daysLeft: number | null;   // 距到期天数(负 = 已过期);无效期 = null
  addedAt: string;           // 买入/记录日 'YYYY-MM-DD'(节点 createdAt;'' = 未知)
}

const DAY_MS = 86_400_000;

/** 距到期天数:今天=0,明天=1,已过期为负;无效期返回 null。按本地自然日算。 */
export function daysLeftOf(expiry: string | null, now = new Date()): number | null {
  if (!expiry) return null;
  const t = Date.parse(`${expiry}T00:00:00`);
  if (!Number.isFinite(t)) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - start) / DAY_MS);
}

/** 库存排序:有效期者优先且早到期在前;都无效期按名字(中文)。稳定、纯函数。 */
export function sortPantry(items: PantryItem[]): PantryItem[] {
  return [...items].sort((a, b) => {
    if (a.daysLeft == null && b.daysLeft == null) return a.name.localeCompare(b.name, 'zh');
    if (a.daysLeft == null) return 1;
    if (b.daysLeft == null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}

/** 快过期先用:days 天内(含已过期)的食材,最早到期在前。 */
export function expiringPantry(items: PantryItem[], days = 4): PantryItem[] {
  return items
    .filter((i) => i.daysLeft != null && i.daysLeft <= days)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

/** 用掉一份的判定:qty>1 → 扣到 nextQty;否则(不计数 / 只剩 1)→ 用光删除。 */
export function consumeDecision(quantity: number | null): { remove: true } | { remove: false; nextQty: number } {
  if (quantity != null && quantity > 1) return { remove: false, nextQty: quantity - 1 };
  return { remove: true };
}
