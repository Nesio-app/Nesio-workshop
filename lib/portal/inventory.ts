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
  subtype: string;       // 后台子类(flight/passport… / 食材);不渲染成标签,只做分面判定
  tags: string[];        // 物品①:物品标签(node.tags 去掉域标「收纳」)
  forSale: boolean;      // 物品③:标记出售(进卖闲置堆)
  isContainer: boolean;  // 物品④:这件物品本身是容器(收纳箱等),其他物品位置可写它
  containedCount: number;// 物品④:装了几件(其他物品 location 的容器段命中该物品名;列表时计算)
  // ── 亚马逊转卖(flip)追踪 —— 买→留评→返现→转卖→算利润。对应用户 Notion 表 ──
  isAmazon: boolean;         // node.tags 含「亚马逊」
  orderNo: string;           // 订单号
  seller: string;            // 商家(Sold by …)
  keywords: string;          // 搜索关键词
  buyPrice: number | null;   // 买入价(美金价格)
  tax: number | null;        // 税(只记录,不进成本)
  orderedAt: string | null;  // 下单日 'YYYY-MM-DD'
  arrivedAt: string | null;  // 到货日 'YYYY-MM-DD'
  rebate: number | null;     // 卖方返现金额
  rebateReceived: boolean;   // 返现是否到账(Notion PayStatus)
  reviewDone: boolean;       // 是否已留评(Notion Review Status)
  reviewExempt: boolean;     // 免评
  resalePrice: number | null;// 转卖价
  sold: boolean;             // 已售出(否=在库)
  outOfPocket: number | null;// 自付额 = 买入价 − 返现(税不进成本,派生,不落库)
  profit: number | null;     // 盈利 = 转卖价 − 自付额(派生,不落库)
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
    subtype: str(a.subtype).trim(),
    tags: (node.tags || []).filter((t) => t && t !== '收纳'),
    forSale: a.forSale === true,
    isContainer: a.isContainer === true,
    containedCount: 0, // listInventoryItems 里跨物品计算
    ...amazonFields(node, a),
  };
}

/** 亚马逊转卖字段的读取 + 派生(自付额/盈利)。全部标量,派生值不落库。 */
function amazonFields(node: LifeNode, a: LifeNode['attributes']): {
  isAmazon: boolean; orderNo: string; seller: string; keywords: string;
  buyPrice: number | null; tax: number | null; orderedAt: string | null; arrivedAt: string | null; rebate: number | null;
  rebateReceived: boolean; reviewDone: boolean; reviewExempt: boolean;
  resalePrice: number | null; sold: boolean; outOfPocket: number | null; profit: number | null;
} {
  const buyPrice = num(a.buyPrice);
  const rebate = num(a.rebate);
  const resalePrice = num(a.resalePrice);
  // 自付额 = 买入价 − 返现(税只记录不进成本;要含税改成 + (num(a.tax)||0))。
  const outOfPocket = buyPrice != null ? Math.round((buyPrice - (rebate || 0)) * 100) / 100 : null;
  const profit = resalePrice != null && outOfPocket != null ? Math.round((resalePrice - outOfPocket) * 100) / 100 : null;
  return {
    isAmazon: (node.tags || []).includes('亚马逊'),
    orderNo: str(a.orderNo),
    seller: str(a.seller),
    keywords: str(a.keywords),
    buyPrice, tax: num(a.tax),
    orderedAt: str(a.orderedAt).slice(0, 10) || null,
    arrivedAt: str(a.arrivedAt).slice(0, 10) || null, rebate,
    rebateReceived: a.rebateReceived === true,
    reviewDone: a.reviewDone === true,
    reviewExempt: a.reviewExempt === true,
    resalePrice, sold: a.sold === true, outOfPocket, profit,
  };
}

/** 留评到期状态:到货约 N 天(默认 10)后该留评。免评/已评/未到货各有终态。 */
export type ReviewDueStatus = 'exempt' | 'done' | 'not_arrived' | 'waiting' | 'due';
export function reviewDueInfo(
  item: Pick<InventoryItem, 'reviewExempt' | 'reviewDone' | 'arrivedAt'>,
  windowDays = 10,
  nowMs: number = Date.now(),
): { status: ReviewDueStatus; daysLeft: number | null; dueDate: string | null } {
  if (item.reviewExempt) return { status: 'exempt', daysLeft: null, dueDate: null };
  if (item.reviewDone) return { status: 'done', daysLeft: null, dueDate: null };
  if (!item.arrivedAt) return { status: 'not_arrived', daysLeft: null, dueDate: null };
  const arrived = new Date(`${item.arrivedAt}T00:00:00`).getTime();
  if (!Number.isFinite(arrived)) return { status: 'not_arrived', daysLeft: null, dueDate: null };
  const dueMs = arrived + windowDays * 86_400_000;
  const daysLeft = Math.ceil((dueMs - nowMs) / 86_400_000);
  const dueDate = new Date(dueMs).toISOString().slice(0, 10);
  return { status: daysLeft <= 0 ? 'due' : 'waiting', daysLeft, dueDate };
}

/** 亚马逊转卖汇总:件数、总自付、总返现、已实现利润(已售)、在库/已售计数。 */
export function amazonSummary(items: InventoryItem[]): {
  count: number; grossSpent: number; outOfPocketTotal: number; rebateTotal: number;
  realizedProfit: number; inStock: number; sold: number; reviewDue: number;
} {
  const amz = items.filter((i) => i.isAmazon);
  let grossSpent = 0, outOfPocketTotal = 0, rebateTotal = 0, realizedProfit = 0, inStock = 0, sold = 0, reviewDue = 0;
  for (const i of amz) {
    grossSpent += (i.buyPrice || 0) + (i.tax || 0); // 实际刷卡花销(含税)
    outOfPocketTotal += i.outOfPocket || 0;          // 净自付(买入价 − 返现)
    rebateTotal += i.rebate || 0;
    if (i.sold) { sold += 1; realizedProfit += i.profit || 0; } else inStock += 1;
    if (reviewDueInfo(i).status === 'due') reviewDue += 1;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { count: amz.length, grossSpent: r2(grossSpent), outOfPocketTotal: r2(outOfPocketTotal), rebateTotal: r2(rebateTotal), realizedProfit: r2(realizedProfit), inStock, sold, reviewDue };
}

/** 亚马逊转卖列表排序:免评置顶(用户要求),再按到货日期升序(空到货垫底),同日按新→旧。 */
export function sortAmazonFlip(items: InventoryItem[]): InventoryItem[] {
  return items
    .filter((i) => i.isAmazon)
    .sort((a, b) => {
      if (a.reviewExempt !== b.reviewExempt) return a.reviewExempt ? -1 : 1;
      const ax = a.arrivedAt || '9999-12-31';
      const bx = b.arrivedAt || '9999-12-31';
      if (ax !== bx) return ax < bx ? -1 : 1;
      return new Date(b.node.createdAt).getTime() - new Date(a.node.createdAt).getTime();
    });
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
  subtype?: string;  // 后台子类(如 食材);不显示成标签
  tags?: string[];   // 物品①:标签
  price?: number;    // 物品①:估值(单件)
  forSale?: boolean; // 物品③:标记出售
  isContainer?: boolean; // 物品④:变成容器
  // 亚马逊转卖字段
  isAmazon?: boolean;      // 控制「亚马逊」标签的增删
  orderNo?: string;
  seller?: string;
  keywords?: string;
  buyPrice?: number;
  tax?: number;
  orderedAt?: string;      // 'YYYY-MM-DD' 下单日
  arrivedAt?: string;      // 'YYYY-MM-DD' 到货日
  rebate?: number;
  rebateReceived?: boolean;
  reviewDone?: boolean;
  reviewExempt?: boolean;
  resalePrice?: number;
  sold?: boolean;
}

export function addInventoryItem(input: NewInventoryItem): LifeNode {
  const attributes: Record<string, string | number | boolean | null> = {};
  if (input.location?.trim()) attributes.location = input.location.trim();
  if (input.quantity != null && Number.isFinite(input.quantity)) attributes.quantity = input.quantity;
  if (input.expiry?.trim()) attributes.expiry = input.expiry.trim();
  if (input.note?.trim()) attributes.note = input.note.trim();
  if (input.category?.trim()) attributes.category = input.category.trim();
  if (input.subtype?.trim()) attributes.subtype = input.subtype.trim();
  if (input.price != null && Number.isFinite(input.price)) attributes.price = input.price;
  if (input.forSale) attributes.forSale = true; // 物品③
  // 亚马逊转卖字段(创建时可由截图/文字抽取预填)
  if (input.orderNo?.trim()) attributes.orderNo = input.orderNo.trim();
  if (input.seller?.trim()) attributes.seller = input.seller.trim();
  if (input.keywords?.trim()) attributes.keywords = input.keywords.trim();
  if (input.buyPrice != null && Number.isFinite(input.buyPrice)) attributes.buyPrice = input.buyPrice;
  if (input.tax != null && Number.isFinite(input.tax)) attributes.tax = input.tax;
  if (input.orderedAt?.trim()) attributes.orderedAt = input.orderedAt.trim();
  if (input.arrivedAt?.trim()) attributes.arrivedAt = input.arrivedAt.trim();
  if (input.rebate != null && Number.isFinite(input.rebate)) attributes.rebate = input.rebate;
  if (input.rebateReceived) attributes.rebateReceived = true;
  if (input.reviewDone) attributes.reviewDone = true;
  if (input.reviewExempt) attributes.reviewExempt = true;
  if (input.resalePrice != null && Number.isFinite(input.resalePrice)) attributes.resalePrice = input.resalePrice;
  if (input.sold) attributes.sold = true;
  const itemTags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  const withAmazon = input.isAmazon ? ['亚马逊', ...itemTags.filter((t) => t !== '亚马逊')] : itemTags;
  return addLifeNode({
    type: 'object',
    name: input.name.trim(),
    attributes,
    source: 'manual',
    confidence: 1,
    relations: [],
    tags: ['收纳', ...withAmazon.filter((t) => t !== '收纳')],
  });
}

/** 更新物品属性(位置/数量/效期/备注)。 */
export function updateInventoryItem(
  id: string,
  patch: Partial<Omit<NewInventoryItem, 'name'>> & { name?: string },
): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const attributes = { ...node.attributes };
  // 亚马逊字段用的 set-or-delete 小工具(空/无效值即清键,不留脏数据)。
  const setStr = (k: string, v: string | undefined) => {
    if (v === undefined) return;
    if (v.trim()) attributes[k] = v.trim(); else delete attributes[k];
  };
  const setNum = (k: string, v: number | undefined) => {
    if (v === undefined) return;
    if (v != null && Number.isFinite(v)) attributes[k] = v; else delete attributes[k];
  };
  const setBool = (k: string, v: boolean | undefined) => {
    if (v === undefined) return;
    if (v) attributes[k] = true; else delete attributes[k];
  };
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
  // 亚马逊转卖字段
  setStr('orderNo', patch.orderNo);
  setStr('seller', patch.seller);
  setStr('keywords', patch.keywords);
  setNum('buyPrice', patch.buyPrice);
  setNum('tax', patch.tax);
  setStr('orderedAt', patch.orderedAt);
  setStr('arrivedAt', patch.arrivedAt);
  setNum('rebate', patch.rebate);
  setBool('rebateReceived', patch.rebateReceived);
  setBool('reviewDone', patch.reviewDone);
  setBool('reviewExempt', patch.reviewExempt);
  setNum('resalePrice', patch.resalePrice);
  setBool('sold', patch.sold);
  const nodePatch: Partial<LifeNode> = { attributes, lastConfirmedAt: new Date().toISOString() };
  // tags + 「亚马逊」域标:patch.tags 重设用户标签;patch.isAmazon 单独增删亚马逊标签。
  if (patch.tags !== undefined || patch.isAmazon !== undefined) {
    let userTags = patch.tags !== undefined
      ? (patch.tags || []).map((t) => t.trim()).filter((t) => t && t !== '收纳')
      : (node.tags || []).filter((t) => t && t !== '收纳');
    if (patch.isAmazon !== undefined) {
      userTags = userTags.filter((t) => t !== '亚马逊');
      if (patch.isAmazon) userTags.unshift('亚马逊');
    }
    nodePatch.tags = ['收纳', ...userTags];
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

/* ---------- 物品⑦:亚马逊转卖 CSV 导入(对接用户 Notion「Amazon Free Tracker」导出)---------- */

/** 一行 CSV → 字段数组(尊重双引号内的逗号,如 "November 28, 2025" / "CN¥2,115.50")。 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // 转义双引号
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 金额串 → 数字。剥 $/¥/CN/逗号/空白,保留负号与小数;负号可在货币符前(-$0.67)。空 → null。 */
export function parseMoneyLoose(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 「November 28, 2025」/「2025-11-28」→「YYYY-MM-DD」;解析不动返回 ''。 */
export function parseFlexibleDate(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 解析 Notion「Amazon Free Tracker」导出 CSV → 可直接喂 addInventoryItem 的条目。
 * 列:Name, In Stock, Order #, PayStatus, Review Status, 免评, 到货时间, 盈利, 美金价格, 自付额, 转卖价, 返现金额
 *
 * 关键:返现金额是人民币(CN¥),其它金额是美元。为让 app 派生的自付额/盈利与表里**一致**,
 * 用美元字段反推返现:rebate$ = 美金价格 − 自付额(自付额 = 买入价 − 返现)。缺美金价格时
 * 返现留空。表头按**名称**匹配(容忍 BOM 与列顺序变化),缺名的行跳过。
 */
export function parseAmazonFlipCsv(text: string): NewInventoryItem[] {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^﻿/, '').trim());
  const idx = (name: string) => header.findIndex((h) => h === name);
  const col = {
    name: idx('Name'),
    inStock: idx('In Stock'),
    orderNo: idx('Order #'),
    payStatus: idx('PayStatus'),
    reviewStatus: idx('Review Status'),
    exempt: idx('免评'),
    arrived: idx('到货时间'),
    buyPrice: idx('美金价格'),
    outOfPocket: idx('自付额'),
    resale: idx('转卖价'),
  };
  if (col.name === -1) return []; // 没有 Name 列 = 不是这张表
  const at = (cells: string[], i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
  const truthy = (v: string) => /^(done|yes|是|已|true|完成)/i.test(v.trim());

  const out: NewInventoryItem[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const name = at(cells, col.name);
    if (!name) continue;
    const buyPrice = parseMoneyLoose(at(cells, col.buyPrice));
    const oop = parseMoneyLoose(at(cells, col.outOfPocket));
    const resale = parseMoneyLoose(at(cells, col.resale));
    // rebate$ = 买入价 − 自付额(反推,保证 app 派生的自付额/盈利与表一致)
    const rebate = buyPrice != null && oop != null ? Math.round((buyPrice - oop) * 100) / 100 : null;
    const item: NewInventoryItem = { name, isAmazon: true };
    if (buyPrice != null) item.buyPrice = buyPrice;
    if (rebate != null) item.rebate = rebate;
    if (resale != null) item.resalePrice = resale;
    const arrived = parseFlexibleDate(at(cells, col.arrived));
    if (arrived) item.arrivedAt = arrived;
    const orderNo = at(cells, col.orderNo);
    if (orderNo) item.orderNo = orderNo;
    if (/sold|已售/i.test(at(cells, col.inStock))) item.sold = true;
    if (truthy(at(cells, col.payStatus))) item.rebateReceived = true;
    if (truthy(at(cells, col.reviewStatus))) item.reviewDone = true;
    if (truthy(at(cells, col.exempt))) item.reviewExempt = true;
    out.push(item);
  }
  return out;
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
