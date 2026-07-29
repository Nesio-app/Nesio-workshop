/**
 * inventory-visibility — 「收纳这个入口该报几件」的唯一判据(2026-07-29 QA #12/#13)。
 *
 * 用户在同一条路径上看到两个数:
 *   · 记忆页「收纳」球标着 22 件
 *   · 点进去,收纳页顶上写 18 件 · 18 未归位
 * 差的 4 件是食材。收纳页早就把食材滤掉了(它们归「做饭 · 库存」那张脸,
 * 免得护照清单里混进菠菜),而外面那个球直接读了 listInventoryItems() 的全长度。
 * 两处各写各的口径,于是「点进去东西变少了」。
 *
 * 判据收到这里一份:**谁把「收纳」这个词摆给用户看,谁就调 listStorageItems()。**
 * 想报食材的用 lib/cooking/pantry 的 listPantryItems() —— 那是另一张脸,另一个数。
 *
 * 为什么单开一个文件:isFoodItem 在 lib/cooking/pantry.ts,而它 import 了 inventory.ts。
 * 把这个判据写回 inventory.ts 会成环。
 *
 * 契约:scripts/inventory-one-number.test.mjs。
 */
import { isFoodItem } from '../cooking/pantry';
import { listInventoryItems, type InventoryItem } from './inventory';

/** 「收纳」这张脸管的东西:所有物品减去食材。 */
export function listStorageItems(): InventoryItem[] {
  return listInventoryItems().filter((i) => !isFoodItem(i));
}

/**
 * 归「做饭 · 库存」那张脸的件数。
 * 收纳页用它说一句「另有 N 件食材在做饭 · 库存」—— 让 18 + 4 = 22 在屏幕上对得上,
 * 而不是让用户自己猜那 4 件去哪了。
 */
export function countPantryItems(): number {
  return listInventoryItems().filter(isFoodItem).length;
}
