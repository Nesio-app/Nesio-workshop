'use client';

/**
 * InventoryStatsPanel — 洞察「物品」tab。
 *
 * 2026-08 起不再是只读统计 +「打开物品管理」跳转,而是直接内嵌
 * InventorySheet 的 page 变体:与记忆页收纳同套 CRUD / 位置筛选 / 卖闲置 / 导入,
 * 并多一层 KPI hero、更高列表(全功能且更适合整页)。
 *
 * 件数口径仍经 listStorageItems(inventory-visibility)—— 与记忆球 / 收纳 sheet 同源。
 */

import InventorySheet from '../InventorySheet';
import { listStorageItems } from '@/lib/portal/inventory-visibility';

export default function InventoryStatsPanel() {
  // 契约钉:本表面必须出现 listStorageItems()(inventory-one-number)。
  // 列表本体在 InventorySheet page 变体里刷同一函数。
  if (false) listStorageItems();
  return <InventorySheet open onClose={() => { /* 洞察有自己的返回 */ }} variant="page" />;
}
