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

/** 衣物:衣橱那张脸管的东西(节点属性 garment,与 lib/portal/wardrobe 的 listWardrobe 同一判据)。 */
function isGarment(i: InventoryItem): boolean {
  return i.node?.attributes?.garment === true;
}

/**
 * 「收纳」这张脸管的东西:所有物品**减去食材、减去衣物**。
 * 2026-07-29 标注(Bug4 P10「第一个显示物品数量,除了食材,衣服」):
 * 衣物此前还留在收纳数里,于是「物品 / 衣橱 / 食材」三个数加起来大于总数 —— 又一笔对不上的账。
 */
export function listStorageItems(): InventoryItem[] {
  return listInventoryItems().filter((i) => !isFoodItem(i) && !isGarment(i));
}

/** 归「衣橱」那张脸的件数(收纳页三个统计里的第二个)。 */
export function countWardrobeItems(): number {
  return listInventoryItems().filter(isGarment).length;
}

/**
 * 归「做饭 · 库存」那张脸的件数。
 * 收纳页用它说一句「另有 N 件食材在做饭 · 库存」—— 让 18 + 4 = 22 在屏幕上对得上,
 * 而不是让用户自己猜那 4 件去哪了。
 */
export function countPantryItems(): number {
  return listInventoryItems().filter(isFoodItem).length;
}

/**
 * 「收纳」这张脸报的那个数(2026-07-30,bug #15 复发)。
 *
 * 上一轮把「哪些东西算收纳」统一了(listStorageItems),球和清单终于是同一批东西。
 * 但用户还是看到 22 vs 18 —— 因为剩下的分歧在**「件」这个字指什么**:
 *   · 球读的是 inventoryStats().count,那是 **Σ 数量**(一盒 5 支笔算 5);
 *   · 清单顶上的「全部 N」是 **行数**(那盒笔算 1 行)。
 * 两个数都对,可它们共用同一个字。用户点进去只会数出 18 行,自然觉得「东西变少了」。
 *
 * 定死:**门面上的数 = 你点进去会看到的行数**。数量总数是附加信息,
 * 只在两者不同时补一句,不抢主位。
 */
export interface StorageHeadline {
  /** 点进去会看到多少行 —— 门面上就报这个。 */
  rows: number;
  /** Σ 数量(一盒 5 支笔算 5)。 */
  pieces: number;
}

export function storageHeadline(items: readonly InventoryItem[]): StorageHeadline {
  let pieces = 0;
  for (const i of items) pieces += i.quantity != null && i.quantity > 0 ? i.quantity : 1;
  return { rows: items.length, pieces };
}
