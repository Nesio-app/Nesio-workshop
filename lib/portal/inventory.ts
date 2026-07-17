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
import { displayStoredLocation } from './named-places';

/* ---------- location 规范 ---------- */
// 位置词汇的唯一真相是 named-places(场所→房间→子位置,LocationPicker 输出
// 「emoji 场所 · 房间 · 子位置」或自由文本)。收纳不再自建第二套位置表 ——
// 相机识别归位与收纳手记用同一个 LocationPicker、写同一个 location 属性。

export const LOC_SEP = ' · '; // 物品②:CSV 导入拼 location 复用同一分隔词

// 分组键去 emoji:存放位置显示已去掉 🏠 等 emoji(带 placeId 的物品解析出「家」),但历史
// 自由文本物品的 location 原文可能仍存着「🏠 家」。若不归一,老物品会按「🏠 家」、新物品按
// 「家」分成两组(收纳页分组割裂)。这里把首段(space=分组键)的 emoji 清掉,新老归为一组。
const SPACE_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu;
function normalizeSpace(s: string): string {
  return s.replace(SPACE_EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** 解析 location 为 {space(首段,浏览分组用), container(其余)}。自由文本整段落到 space。 */
export function splitLocation(location: string): { space: string; container: string } {
  const idx = location.indexOf(LOC_SEP);
  if (idx === -1) return { space: normalizeSpace(location.trim()), container: '' };
  return { space: normalizeSpace(location.slice(0, idx).trim()), container: location.slice(idx + LOC_SEP.length).trim() };
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
  category: string;      // 物品①:分类('' = 未分类)
  tags: string[];        // 物品①:物品标签(node.tags 去掉域标「收纳」)
  forSale: boolean;      // 物品③:标记出售(进卖闲置堆)
  isContainer: boolean;  // 物品④:这件物品本身是容器(收纳箱等),其他物品位置可写它
  containedCount: number;// 物品④:装了几件(其他物品 location 的容器段命中该物品名;列表时计算)
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
  // 批次192:优先用稳定 placeId 解析成**当前**命名地点名(改名自动传导),没有再回退存的字符串。
  const location = displayStoredLocation(a).trim();
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
    category: str(a.category).trim(),
    tags: (node.tags || []).filter((t) => t && t !== '收纳'),
    forSale: a.forSale === true,
    isContainer: a.isContainer === true,
    containedCount: 0, // listInventoryItems 里跨物品计算
  };
}

/** 全部物品(object 节点),新→旧。容器物品的 containedCount 在此跨物品计算。 */
export function listInventoryItems(): InventoryItem[] {
  const items = getLifeGraph()
    .filter((n) => n.type === 'object')
    .map(toInventoryItem);
  // 物品④:location 任一非空间段命中容器物品名 → 算「装在里面」
  const counts = new Map<string, number>();
  for (const i of items) {
    for (const seg of i.location.split(LOC_SEP).slice(1)) {
      const key = seg.trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  for (const i of items) {
    if (i.isContainer) i.containedCount = counts.get(i.name) || 0;
  }
  return items;
}

/* ---------- 写入 ---------- */

export interface NewInventoryItem {
  name: string;
  location?: string; // LocationPicker 输出(「emoji 场所 · 房间 · 子位置」或自由文本)
  quantity?: number;
  expiry?: string; // 'YYYY-MM-DD'
  note?: string;
  category?: string; // 物品①:分类
  tags?: string[];   // 物品①:标签
  price?: number;    // 物品①:估值(单件)
  forSale?: boolean; // 物品③:标记出售
  isContainer?: boolean; // 物品④:变成容器
}

export function addInventoryItem(input: NewInventoryItem): LifeNode {
  const attributes: Record<string, string | number | boolean | null> = {};
  if (input.location?.trim()) attributes.location = input.location.trim();
  if (input.quantity != null && Number.isFinite(input.quantity)) attributes.quantity = input.quantity;
  if (input.expiry?.trim()) attributes.expiry = input.expiry.trim();
  if (input.note?.trim()) attributes.note = input.note.trim();
  if (input.category?.trim()) attributes.category = input.category.trim();
  if (input.price != null && Number.isFinite(input.price)) attributes.price = input.price;
  if (input.forSale) attributes.forSale = true; // 物品③
  const itemTags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  return addLifeNode({
    type: 'object',
    name: input.name.trim(),
    attributes,
    source: 'manual',
    confidence: 1,
    relations: [],
    tags: ['收纳', ...itemTags.filter((t) => t !== '收纳')],
  });
}

/** 更新物品属性(位置/数量/效期/备注)。 */
export function updateInventoryItem(
  id: string,
  patch: Partial<Pick<NewInventoryItem, 'location' | 'quantity' | 'expiry' | 'note' | 'category' | 'tags' | 'price' | 'forSale' | 'isContainer'>> & { name?: string },
): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const attributes = { ...node.attributes };
  if (patch.location !== undefined) {
    if (patch.location.trim()) attributes.location = patch.location.trim();
    else delete attributes.location;
    // 批次192:收纳表单改位置=重设字符串,清掉旧 placeId 免得解析器显示错名(去同步)。
    delete attributes.placeId; delete attributes.placeRoom; delete attributes.placeSubRoom;
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
  if (patch.category !== undefined) {
    if (patch.category?.trim()) attributes.category = patch.category.trim();
    else delete attributes.category;
  }
  if (patch.price !== undefined) {
    if (patch.price != null && Number.isFinite(patch.price)) attributes.price = patch.price;
    else delete attributes.price;
  }
  if (patch.forSale !== undefined) {
    if (patch.forSale) attributes.forSale = true;
    else delete attributes.forSale;
  }
  if (patch.isContainer !== undefined) {
    // 物品④:解除容器只摘 flag,不动已放进去的物品(它们的 location 原样保留)
    if (patch.isContainer) attributes.isContainer = true;
    else delete attributes.isContainer;
  }
  const nodePatch: Partial<LifeNode> = { attributes, lastConfirmedAt: new Date().toISOString() };
  if (patch.tags !== undefined) {
    const itemTags = (patch.tags || []).map((t) => t.trim()).filter((t) => t && t !== '收纳');
    nodePatch.tags = ['收纳', ...itemTags];
  }
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

/* ---------- 物品①:库存统计(对标 Inventory Stats 页) ---------- */

export interface InventoryStats {
  spaces: number;        // 有物品的空间数
  containers: number;    // 有物品的容器数(空间+容器组合去重)
  count: number;         // 物品数(数量合计,缺数量按 1)
  totalValue: number;    // 估值合计 = Σ 单价 ×(数量||1),缺价不计
  byCategory: Array<{ category: string; count: number }>; // 计数降序;未分类归「未分类」
  topTags: Array<{ tag: string; count: number }>;         // 前 12,计数降序
}

export function inventoryStats(items: InventoryItem[]): InventoryStats {
  const spaces = new Set<string>();
  const containers = new Set<string>();
  const byCat = new Map<string, number>();
  const byTag = new Map<string, number>();
  let count = 0;
  let totalValue = 0;
  for (const i of items) {
    const qty = i.quantity != null && i.quantity > 0 ? i.quantity : 1;
    count += qty;
    if (i.space) spaces.add(i.space);
    if (i.space && i.container) containers.add(`${i.space}|${i.container}`);
    if (i.price != null) totalValue += i.price * qty;
    const cat = i.category || '未分类';
    byCat.set(cat, (byCat.get(cat) || 0) + qty);
    for (const t of i.tags) byTag.set(t, (byTag.get(t) || 0) + 1);
  }
  return {
    spaces: spaces.size,
    containers: containers.size,
    count,
    totalValue: Math.round(totalValue * 100) / 100,
    byCategory: [...byCat.entries()].map(([category, c]) => ({ category, count: c })).sort((a, b) => b.count - a.count),
    topTags: [...byTag.entries()].map(([tag, c]) => ({ tag, count: c })).sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

/* ---------- 物品③:卖闲置堆(对标 Build a sell pile) ---------- */

export interface SellPile {
  items: InventoryItem[]; // 标记出售的物品,估值(价×量)降序,无价在后
  totalValue: number;     // 合计 = Σ 单价 ×(数量||1),缺价不计
}

export function sellPile(items: InventoryItem[]): SellPile {
  const picked = items.filter((i) => i.forSale);
  const worth = (i: InventoryItem) => (i.price != null ? i.price * (i.quantity != null && i.quantity > 0 ? i.quantity : 1) : -1);
  picked.sort((a, b) => worth(b) - worth(a));
  const totalValue = picked.reduce((s, i) => s + Math.max(0, worth(i)), 0);
  return { items: picked, totalValue: Math.round(totalValue * 100) / 100 };
}

/** 物品⑥:转卖文案(Marketplace/eBay 可直接粘贴的纯模板,不动 AI)。 */
export function buildListingText(item: InventoryItem, dict: string = 'zh'): string {
  const zh = dict !== 'en';
  const qty = item.quantity != null && item.quantity > 1 ? (zh ? ` ×${item.quantity}` : ` (x${item.quantity})`) : '';
  const price = item.price != null ? `$${item.price}` : (zh ? '价格私聊' : 'Price: DM me');
  const lines = [
    `${item.name}${qty} — ${price}`,
    zh ? '自用闲置,状态良好。' : 'Pre-owned, in good condition.',
  ];
  if (item.category) lines.push(zh ? `类别:${item.category}` : `Category: ${item.category}`);
  if (item.tags.length) lines.push(`#${item.tags.join(' #')}`);
  if (item.note) lines.push(item.note);
  lines.push(zh ? '自取优先,诚心可小刀。' : 'Pickup preferred. Reasonable offers welcome.');
  return lines.join('\n');
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
