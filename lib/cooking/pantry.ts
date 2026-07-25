/**
 * pantry — 做饭/库存的数据层(M1 · I/O 层,纯逻辑见 pantry-core.ts)。
 *
 * 架构决定(与「物品/收纳」一致):**食材不建独立竖井**。一件库存食材 = life-graph 的
 * `object` 节点,额外打一个域标 `食材`。这样直接白拿:
 *   - 相机识图 / 条码查食物 / CSV 导入(物品那套摄入管线);
 *   - 快过期提醒(guidance-engine 的 `expiry` 类型见到 attributes.expiry 自动播报);
 *   - 生活图谱的云同步(食材随图上你自己的云,不共享、不建 Supabase 表);
 *   - Memory 搜索、「牛奶放哪」问答。
 * 一份数据一个真相。库存只是 object 节点「按食材看 + 按过期排」的一张脸。
 */
import {
  addInventoryItem,
  updateInventoryItem,
  removeInventoryItem,
  listInventoryItems,
  type InventoryItem,
} from '@/lib/portal/inventory';
import {
  daysLeftOf, sortPantry, consumeDecision,
  PANTRY_CATEGORIES, type PantryItem, type PantryCategory,
} from './pantry-core';

// 纯逻辑对外从这里透出,消费者只 import 一个模块。
export { daysLeftOf, expiringPantry, PANTRY_CATEGORIES } from './pantry-core';
export type { PantryItem, PantryCategory } from './pantry-core';

/**
 * 「食材」是**后台子类**(attributes.subtype),不是可见标签 —— 属性从不渲染成 chip,
 * 所以库存食材不会在物品页/记忆卡上冒出「食材」小标签。listPantry 收它、物品页排除它,
 * 同一张图两张脸靠这一个判定分开(isFoodItem),不重复不孤岛。
 */
export const PANTRY_SUBTYPE = '食材';

/** 一件物品是不是食材(做饭页收、物品页排除的唯一判定)。兼容早期用 tag 标的历史项。 */
export function isFoodItem(i: InventoryItem): boolean {
  return i.subtype === PANTRY_SUBTYPE || i.tags.includes(PANTRY_SUBTYPE);
}

function toPantryItem(i: InventoryItem, now: Date): PantryItem {
  return {
    id: i.id, name: i.name, quantity: i.quantity, expiry: i.expiry,
    location: i.location, category: i.category, daysLeft: daysLeftOf(i.expiry, now),
  };
}

/** 全部食材(subtype=食材 的 object 节点),快过期在前、其余按名。 */
export function listPantry(now = new Date()): PantryItem[] {
  const items = listInventoryItems()
    .filter(isFoodItem)
    .map((i) => toPantryItem(i, now));
  return sortPantry(items);
}

export interface NewPantryItem {
  name: string; quantity?: number; expiry?: string; location?: string; category?: string;
}

/** 进货:加一件食材(subtype=食材,后台标 → 自动进过期提醒 + 云同步)。返回新节点 id。 */
export function addPantry(input: NewPantryItem): string {
  const node = addInventoryItem({
    name: input.name,
    quantity: input.quantity,
    expiry: input.expiry,
    location: input.location,
    category: input.category,
    subtype: PANTRY_SUBTYPE,
  });
  return node.id;
}

/** 用掉一份:纯判定见 consumeDecision —— qty>1 扣 1,否则用光删除。返回是否成功。 */
export function consumePantry(id: string, now = new Date()): boolean {
  const it = listPantry(now).find((i) => i.id === id);
  if (!it) return false;
  const d = consumeDecision(it.quantity);
  return d.remove ? removeInventoryItem(id) : updateInventoryItem(id, { quantity: d.nextQty });
}

/** 直接删除一件食材(整条去掉,不是用掉一份)。 */
export function removePantry(id: string): boolean {
  return removeInventoryItem(id);
}
