/**
 * wishlist — 想做清单(屏4)。**就是一条「记忆」节点**(note,tag 想做清单),dish 列表 JSON 存
 * attributes.dishes。想做的菜先攒着,选一道 → 算缺料(屏5)。复用 addLifeNode,不另起存储。
 */
import { updateLifeNode, deleteLifeNode, getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

const TAG = '想做清单';
export interface WishDish { name: string; note?: string }   // note = 朋友推荐/拍一张/想给孩子做…

function find(): LifeNode | null {
  return getLifeGraph().find((n) => n.type === 'collection' && (n.tags || []).includes(TAG)) || null;
}
function parse(n: LifeNode): WishDish[] {
  try { const a = JSON.parse(String(n.attributes?.dishes ?? '[]')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function write(n: LifeNode, dishes: WishDish[]): boolean {
  return updateLifeNode(n.id, { attributes: { ...n.attributes, dishes: JSON.stringify(dishes) } });
}

export function getWishlist(): WishDish[] {
  const n = find();
  return n ? parse(n) : [];
}

/** 加一道想做的菜(去重;没有清单就新建一条记忆)。 */
export function addWish(name: string, note?: string): WishDish[] {
  const nm = name.trim();
  if (!nm) return getWishlist();
  const n = find();
  if (n) {
    const cur = parse(n);
    if (!cur.some((d) => d.name === nm)) cur.unshift({ name: nm, ...(note ? { note } : {}) });
    write(n, cur);
    return cur;
  }
  const dishes: WishDish[] = [{ name: nm, ...(note ? { note } : {}) }];
  ingestLifeNode({
    type: 'collection', name: '想做清单',
    attributes: { dishes: JSON.stringify(dishes), epistemic: 'observation', generator: 'user' },
    source: 'manual', confidence: 1, relations: [], tags: [TAG],
  });
  return dishes;
}

/** 从想做清单删一道;清单空了就删掉整条记忆。 */
export function removeWish(name: string): WishDish[] {
  const n = find();
  if (!n) return [];
  const rest = parse(n).filter((d) => d.name !== name);
  if (!rest.length) { deleteLifeNode(n.id); return []; }
  write(n, rest);
  return rest;
}
