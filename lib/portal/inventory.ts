/**
 * inventory — 原生收纳的数据层(收纳重建 · 片 1)。
 *
 * 架构决定:物品**不再**存独立的 IndexedDB 竖井(静态版的 baohe_inventory_local_db 整个不要了)。
 * 物品 = life-graph 的 `object` 节点 —— 拍一下识别的物品本来就是 object 节点,收纳只是
 * 给同一批节点一个「按位置浏览」的视图。这样问一问「护照放在哪」、Memory 搜索、
 * 云 signal 同步全部免费获得,一份数据一个真相。
 *
 * 这里只补两样轻量的东西:
 *   1. 位置表(空间 → 容器)—— 纯分类学,localStorage `nesio-inventory-places-v1`
 *   2. location 属性的「空间 · 容器」规范(写入/解析)
 */

import {
  addLifeNode,
  deleteLifeNode,
  getLifeGraph,
  updateLifeNode,
  type LifeNode,
} from './life-graph';

/* ---------- 位置表(空间/容器) ---------- */

export interface InventorySpace {
  id: string;
  emoji: string;
  name: string;
  containers: string[]; // 容器名列表(轻量,不单独建实体)
}

const PLACES_KEY = 'nesio-inventory-places-v1';

const DEFAULT_SPACES: InventorySpace[] = [
  { id: 'sp-bedroom', emoji: '🛏️', name: '卧室', containers: [] },
  { id: 'sp-kitchen', emoji: '🍳', name: '厨房', containers: [] },
  { id: 'sp-desk', emoji: '📚', name: '书桌', containers: [] },
];

export function loadSpaces(): InventorySpace[] {
  if (typeof window === 'undefined') return DEFAULT_SPACES;
  try {
    const raw = JSON.parse(localStorage.getItem(PLACES_KEY) || 'null') as InventorySpace[] | null;
    if (Array.isArray(raw) && raw.length > 0) return raw.filter((s) => s && s.id && s.name);
  } catch { /* ignore */ }
  return DEFAULT_SPACES;
}

export function saveSpaces(spaces: InventorySpace[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(spaces)); } catch { /* quota */ }
}

export function addSpace(name: string, emoji = '📦'): InventorySpace[] {
  const spaces = loadSpaces();
  const trimmed = name.trim();
  if (!trimmed || spaces.some((s) => s.name === trimmed)) return spaces;
  const next = [...spaces, { id: `sp-${Date.now().toString(36)}`, emoji, name: trimmed, containers: [] }];
  saveSpaces(next);
  return next;
}

export function addContainer(spaceId: string, containerName: string): InventorySpace[] {
  const spaces = loadSpaces();
  const trimmed = containerName.trim();
  if (!trimmed) return spaces;
  const next = spaces.map((s) =>
    s.id === spaceId && !s.containers.includes(trimmed)
      ? { ...s, containers: [...s.containers, trimmed] }
      : s,
  );
  saveSpaces(next);
  return next;
}

/* ---------- location 规范:「空间 · 容器」 ---------- */

const LOC_SEP = ' · ';

export function joinLocation(space: string, container?: string): string {
  return container?.trim() ? `${space}${LOC_SEP}${container.trim()}` : space;
}

/** 解析 location 为 {space, container}。容忍旧数据的任意自由文本(全落到 space)。 */
export function splitLocation(location: string): { space: string; container: string } {
  const idx = location.indexOf(LOC_SEP);
  if (idx === -1) return { space: location.trim(), container: '' };
  return { space: location.slice(0, idx).trim(), container: location.slice(idx + LOC_SEP.length).trim() };
}

/* ---------- 物品视图(life-graph object 节点的投影) ---------- */

export interface InventoryItem {
  node: LifeNode;
  id: string;
  name: string;
  location: string;      // 原始 location 属性('' = 未归位)
  space: string;         // 解析出的空间名('' = 未归位)
  container: string;
  quantity: number | null;
  expiry: string | null; // ISO 日期
  note: string;
  price: number | null;
  hasPhoto: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = parseFloat(v); if (Number.isFinite(n)) return n; }
  return null;
}

export function toInventoryItem(node: LifeNode): InventoryItem {
  const a = node.attributes || {};
  const location = str(a.location).trim();
  const { space, container } = splitLocation(location);
  return {
    node,
    id: node.id,
    name: node.name,
    location,
    space: location ? space : '',
    container,
    quantity: num(a.quantity),
    expiry: str(a.expiry).slice(0, 10) || null,
    note: str(a.note),
    price: num(a.price),
    hasPhoto: Boolean(node.assets?.some((as) => as.kind === 'image')),
  };
}

/** 全部物品(object 节点),新→旧。 */
export function listInventoryItems(): InventoryItem[] {
  return getLifeGraph()
    .filter((n) => n.type === 'object')
    .map(toInventoryItem);
}

/* ---------- 写入 ---------- */

export interface NewInventoryItem {
  name: string;
  space?: string;
  container?: string;
  quantity?: number;
  expiry?: string; // 'YYYY-MM-DD'
  note?: string;
}

export function addInventoryItem(input: NewInventoryItem): LifeNode {
  const attributes: Record<string, string | number | boolean | null> = {};
  if (input.space?.trim()) attributes.location = joinLocation(input.space, input.container);
  if (input.quantity != null && Number.isFinite(input.quantity)) attributes.quantity = input.quantity;
  if (input.expiry?.trim()) attributes.expiry = input.expiry.trim();
  if (input.note?.trim()) attributes.note = input.note.trim();
  return addLifeNode({
    type: 'object',
    name: input.name.trim(),
    attributes,
    source: 'manual',
    confidence: 1,
    relations: [],
    tags: ['收纳'],
  });
}

/** 更新物品属性(位置/数量/效期/备注)。 */
export function updateInventoryItem(
  id: string,
  patch: Partial<Pick<NewInventoryItem, 'space' | 'container' | 'quantity' | 'expiry' | 'note'>> & { name?: string },
): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const attributes = { ...node.attributes };
  if (patch.space !== undefined) {
    if (patch.space.trim()) attributes.location = joinLocation(patch.space, patch.container);
    else delete attributes.location;
  } else if (patch.container !== undefined) {
    const cur = splitLocation(str(attributes.location));
    if (cur.space) attributes.location = joinLocation(cur.space, patch.container);
  }
  if (patch.quantity !== undefined) {
    if (patch.quantity != null && Number.isFinite(patch.quantity)) attributes.quantity = patch.quantity;
    else delete attributes.quantity;
  }
  if (patch.expiry !== undefined) {
    if (patch.expiry?.trim()) attributes.expiry = patch.expiry.trim();
    else delete attributes.expiry;
  }
  if (patch.note !== undefined) {
    if (patch.note?.trim()) attributes.note = patch.note.trim();
    else delete attributes.note;
  }
  const nodePatch: Partial<LifeNode> = { attributes, lastConfirmedAt: new Date().toISOString() };
  if (patch.name?.trim()) nodePatch.name = patch.name.trim();
  return updateLifeNode(id, nodePatch);
}

export function removeInventoryItem(id: string): boolean {
  return deleteLifeNode(id);
}

/* ---------- 派生:临期 / 按空间分组 ---------- */

/** 效期在 days 天内(含已过期)的物品,最早到期在前。 */
export function expiringSoon(items: InventoryItem[], days = 30, now = new Date()): InventoryItem[] {
  const limit = now.getTime() + days * 86_400_000;
  return items
    .filter((i) => i.expiry && Date.parse(`${i.expiry}T00:00:00`) <= limit)
    .sort((a, b) => (a.expiry! < b.expiry! ? -1 : 1));
}

/** 效期状态:'expired' | 'soon'(30 天内)| null。 */
export function expiryStatus(item: InventoryItem, now = new Date()): 'expired' | 'soon' | null {
  if (!item.expiry) return null;
  const t = Date.parse(`${item.expiry}T00:00:00`);
  if (!Number.isFinite(t)) return null;
  if (t < now.getTime()) return 'expired';
  if (t <= now.getTime() + 30 * 86_400_000) return 'soon';
  return null;
}
