/**
 * shopping — 购物清单 I/O 层。清单**就是一条「记忆」节点**(note,tag 购物清单),条目 JSON 存
 * attributes.items —— 因此可搜、随生活图谱上你自己的云、和别的记忆一视同仁,不是孤岛工具。
 * 缺料并入 → 到店勾选 → 买到的经 addPantry 回流库存。全程复用现成件,不另起竖井。
 */
import { updateLifeNode, deleteLifeNode, getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { normalizeIngredient } from './food-catalog';
import { addPantry } from './pantry';
import { mergeShoppingItems, partitionCheckout, type ShoppingItem } from './shopping-core';

export type { ShoppingItem } from './shopping-core';
const TAG = '购物清单';

export interface ShoppingListView { id: string; items: ShoppingItem[] }

function parseItems(node: LifeNode): ShoppingItem[] {
  try {
    const raw = node.attributes?.items;
    const arr = raw ? JSON.parse(String(raw)) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function findActive(): LifeNode | null {
  return getLifeGraph().find((n) => n.type === 'note' && (n.tags || []).includes(TAG)) || null;
}
function writeItems(node: LifeNode, items: ShoppingItem[]): boolean {
  return updateLifeNode(node.id, { attributes: { ...node.attributes, items: JSON.stringify(items) } });
}

/** 当前购物清单(没有返回 null)。 */
export function getShoppingList(): ShoppingListView | null {
  const n = findActive();
  return n ? { id: n.id, items: parseItems(n) } : null;
}

/**
 * 把缺料加进购物清单(归一化 + 跳过常备,不买盐)。没有清单就新建一条记忆节点。
 * 返回并入后的清单;incoming 全是常备/空时,可能返回原样(或 null 若本来就没清单)。
 */
export function addToShopping(rawNames: string[]): ShoppingListView | null {
  const names = rawNames
    .map((r) => normalizeIngredient(r))
    .filter((x) => x.name && !x.isStaple)
    .map((x) => x.name);
  const existing = findActive();
  if (existing) {
    const merged = mergeShoppingItems(parseItems(existing), names);
    writeItems(existing, merged);
    return { id: existing.id, items: merged };
  }
  if (!names.length) return null;
  const items = mergeShoppingItems([], names);
  const node = ingestLifeNode({
    type: 'note', name: '购物清单',
    attributes: { items: JSON.stringify(items), epistemic: 'observation', generator: 'user' },
    source: 'manual', confidence: 1, relations: [], tags: [TAG],
  });
  return { id: node.id, items };
}

/** 勾选/取消一个条目(买到了打勾)。 */
export function toggleShoppingItem(name: string, checked: boolean): boolean {
  const n = findActive();
  if (!n) return false;
  return writeItems(n, parseItems(n).map((i) => (i.name === name ? { ...i, checked } : i)));
}

/** 从清单删掉一个条目;清单空了就删掉整条记忆。 */
export function removeShoppingItem(name: string): boolean {
  const n = findActive();
  if (!n) return false;
  const items = parseItems(n).filter((i) => i.name !== name);
  return items.length ? writeItems(n, items) : deleteLifeNode(n.id);
}

/**
 * 到店结账:勾选(买到)的回流进库存(addPantry → 打食材标),并从清单移除;清单空则删除。
 * 返回回流到库存的条目数。
 */
export function checkoutBought(): number {
  const n = findActive();
  if (!n) return 0;
  const { bought, remaining } = partitionCheckout(parseItems(n));
  for (const it of bought) addPantry({ name: it.name, quantity: it.qty ?? undefined });
  if (!remaining.length) deleteLifeNode(n.id);
  else writeItems(n, remaining);
  return bought.length;
}
