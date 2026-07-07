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

/* ---------- location 规范 ---------- */
// 位置词汇的唯一真相是 named-places(场所→房间→子位置,LocationPicker 输出
// 「emoji 场所 · 房间 · 子位置」或自由文本)。收纳不再自建第二套位置表 ——
// 相机识别归位与收纳手记用同一个 LocationPicker、写同一个 location 属性。

const LOC_SEP = ' · ';

/** 解析 location 为 {space(首段,浏览分组用), container(其余)}。自由文本整段落到 space。 */
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
  location?: string; // LocationPicker 输出(「emoji 场所 · 房间 · 子位置」或自由文本)
  quantity?: number;
  expiry?: string; // 'YYYY-MM-DD'
  note?: string;
}

export function addInventoryItem(input: NewInventoryItem): LifeNode {
  const attributes: Record<string, string | number | boolean | null> = {};
  if (input.location?.trim()) attributes.location = input.location.trim();
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
  patch: Partial<Pick<NewInventoryItem, 'location' | 'quantity' | 'expiry' | 'note'>> & { name?: string },
): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const attributes = { ...node.attributes };
  if (patch.location !== undefined) {
    if (patch.location.trim()) attributes.location = patch.location.trim();
    else delete attributes.location;
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

/* ---------- 域判定(接 Cross-Insight Reader / guidance)---------- */

/** 收纳域「值得提示」判定 —— 与健康/财务 finding 同形,经 domain-insights 汇聚。 */
export interface InventoryFinding {
  id: string;
  severity: 'flag' | 'attention';
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

/**
 * 效期判定:已过期 = flag,30 天内到期 = attention。已过期在前、其余按到期日近→远。
 * 纯函数(items/now 可注入,可单测);数量上限交给 guidance 通用脊柱(每域封顶 3)。
 */
export function inventoryFindings(items: InventoryItem[] = listInventoryItems(), now = new Date()): InventoryFinding[] {
  const out: InventoryFinding[] = [];
  for (const item of expiringSoon(items, 30, now)) {
    const status = expiryStatus(item, now);
    if (!status) continue;
    const where: [string, string] = item.location
      ? [`放在 ${item.location}`, `at ${item.location}`]
      : ['还没记位置', 'location not noted'];
    if (status === 'expired') {
      out.push({
        id: `expiry-${item.id}`,
        severity: 'flag',
        title: [`「${item.name}」已过期`, `"${item.name}" has expired`],
        detail: [`效期 ${item.expiry} · ${where[0]}`, `Expiry ${item.expiry} · ${where[1]}`],
      });
    } else {
      const daysLeft = Math.max(0, Math.ceil((Date.parse(`${item.expiry}T00:00:00`) - now.getTime()) / 86_400_000));
      out.push({
        id: `expiry-${item.id}`,
        severity: 'attention',
        title: [`「${item.name}」快到效期了`, `"${item.name}" expires soon`],
        detail: [`${item.expiry} 到期(还有 ${daysLeft} 天)· ${where[0]}`, `Expires ${item.expiry} (${daysLeft}d left) · ${where[1]}`],
      });
    }
  }
  // 红旗(已过期)在前;expiringSoon 已按到期日排好,稳定分区即可
  return [...out.filter((f) => f.severity === 'flag'), ...out.filter((f) => f.severity === 'attention')];
}
