/**
 * shopping-core — 购物清单**纯逻辑**(无 import,可 node 单测)。
 * 反向闭环:选菜 → 缺料 → 购物清单 → 到店勾选 → 回流库存。清单本身是一条「记忆」节点
 * (见 shopping.ts),这里只管条目的合并/勾选拆分,纯数组算术。
 */

export interface ShoppingItem { name: string; qty: number | null; checked: boolean; }

/** 把新缺料并进现有清单:按名去重(已在清单里的不重复加),新条目未勾选。 */
export function mergeShoppingItems(existing: ShoppingItem[], incoming: string[]): ShoppingItem[] {
  const seen = new Set(existing.map((i) => i.name));
  const out = existing.slice();
  for (const raw of incoming) {
    const n = (raw || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ name: n, qty: null, checked: false });
  }
  return out;
}

/** 到店结账:勾选(买到)= 回流库存;未勾选 = 留在清单。 */
export function partitionCheckout(items: ShoppingItem[]): { bought: ShoppingItem[]; remaining: ShoppingItem[] } {
  return {
    bought: items.filter((i) => i.checked),
    remaining: items.filter((i) => !i.checked),
  };
}
