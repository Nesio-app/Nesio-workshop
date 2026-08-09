/**
 * travel-trips — 足迹「计划/行程」数据层。
 *
 * 设计:一趟 Trip = 一条竖轴时间线;节点(航班/酒店/中转/打包/购物/预算/待办)
 * 实心=已订、描边=待办。完成后 status→completed 沉进「足迹(去过)」。
 * 存 IndexedDB blob(与 place-trail 同款),进云模块同步。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import { listInventoryItems } from './inventory';
import { loadTxAnnotations } from './tx-annotations';
import { loadBankTx } from './bank-tx';
import { addToShopping } from '@/lib/cooking/shopping';
import { addReceiptExpense } from './finance-sources';
import { ledgerProgressPct, ledgerRemaining } from './period-ledger';

export type TripStatus = 'planned' | 'active' | 'completed';
export type TripNodeKind =
  | 'flight' | 'hotel' | 'transit' | 'packing' | 'shopping' | 'budget' | 'todo' | 'poi';

/** booked=实心已订 · todo=描边待办 */
export type TripNodeState = 'booked' | 'todo';

export interface FlightPayload {
  from: string; to: string;
  fromCode?: string; toCode?: string;
  flightNo?: string; airline?: string;
  seat?: string; cabin?: string; terminal?: string;
  confirmation?: string;
  statusText?: string; // 准点 / 延误…
  gate?: string;
  /** 票价(计入预算 actual) */
  price?: number;
  currency?: string;
  departureAt?: string;
  arrivalAt?: string;
}

export interface HotelPayload {
  name: string; address?: string;
  pricePerNight?: number; nights?: number; currency?: string;
  checkIn?: string; checkOut?: string; // ISO or display
  confirmation?: string;
  phone?: string; lat?: number; lon?: number;
}

export interface TransitPayload {
  label: string; durationMin?: number; place?: string;
}

export interface PackingItem {
  name: string; reason?: string;
  status: 'have' | 'need'; // need−have
  /**
   * 物品库里这件东西放在哪(bug3:「每一项根据物品库,显示需买或者位置」)。
   * 只在 status==='have' 时有值;对照是自动做的,不再需要用户点「对照物品库」。
   */
  place?: string;
}

export interface PackingPayload {
  summary?: string; // "5 天 · 有雨 · …"
  items: PackingItem[];
}

export interface ShoppingLine {
  name: string; qty?: number; price?: number; note?: string; intoInventory?: boolean;
}

export interface ShoppingPayload {
  title?: string; // 购物·药妆店
  date?: string; total?: number; currency?: string;
  lines: ShoppingLine[];
}

export interface BudgetCategory {
  id: string; label: string;
  actual: number; budget: number;
}

export interface BudgetPayload {
  currency?: string;
  actualTotal: number; budgetTotal: number;
  categories: BudgetCategory[];
}

export interface TodoPayload {
  title: string; detail?: string;
}

/** 离线景点库节点(随包 POI,可导航)。 */
export interface PoiPayload {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  type?: string;
  wikidata?: string;
  summary?: string;
  summaryEn?: string;
  ticketPrice?: string;
  hours?: string;
  tips?: string;
  imageUrl?: string;
}

export type TripNodePayload =
  | { kind: 'flight'; flight: FlightPayload }
  | { kind: 'hotel'; hotel: HotelPayload }
  | { kind: 'transit'; transit: TransitPayload }
  | { kind: 'packing'; packing: PackingPayload }
  | { kind: 'shopping'; shopping: ShoppingPayload }
  | { kind: 'budget'; budget: BudgetPayload }
  | { kind: 'todo'; todo: TodoPayload }
  | { kind: 'poi'; poi: PoiPayload };

export interface TripNode {
  id: string;
  kind: TripNodeKind;
  state: TripNodeState;
  /** 左侧时间文案,如 08:20 AM / 今晚 */
  timeLabel: string;
  /** 排序用 ISO;可空(出发前节点) */
  at?: string;
  /** 分组:出发前 / 周五 · DAY 1 */
  dayKey?: string;
  dayLabel?: string;
  title: string;
  subtitle?: string;
  payload: TripNodePayload;
}

export interface Trip {
  id: string;
  title: string; // 东京 · 5 天
  destination: string;
  status: TripStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
  weatherHint?: string;
  budgetTotal?: number;
  /**
   * 用户手改过的分类预算(bug3:预算页分类行「无法点无法编辑」)。
   * recomputeBudgetNode 必须尊重它 —— 否则一按「按节点重算」就把用户改的数抹掉。
   */
  budgetByCategory?: Record<string, number>;
  /** 用户自定义预算分类(id → 显示名);默认 flight/stay/shop 之外的可增删。 */
  customBudgetCategories?: Array<{ id: string; label: string }>;
  currency?: string;
  nodes: TripNode[];
  createdAt: string;
  updatedAt: string;
}

const KEY = 'nesio-travel-trips-v1';
export const TRAVEL_TRIPS_UPDATED_EVENT = 'nesio-travel-trips-updated';

const store = createBlobStore<Trip[]>({
  key: KEY,
  updateEvent: TRAVEL_TRIPS_UPDATED_EVENT,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function loadTrips(): Trip[] {
  return store.load() ?? [];
}

function saveTrips(trips: Trip[]): void {
  store.save(trips);
}

export function listPlannedTrips(): Trip[] {
  return loadTrips()
    .filter((t) => t.status === 'planned' || t.status === 'active')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * 把「还没完成」的行程按**日期**分成三组(2026-07-30 真机实锤:
 * 一趟 `2026-07-28 → 2026-08-01` 的行程被列在「即将出发」下面 —— 起始日期
 * 已经是过去的了,它明明已经在路上)。
 *
 * 根因是拿**状态**当日期用:listPlannedTrips 把 planned 和 active 一起返回,
 * 而标题只写了「即将出发」。状态是用户/导入流程标的,不一定跟得上日历。
 * **日期是硬事实,状态是软标记** —— 分组按日期。
 *
 * 第三组「已经过去了」尤其重要:它把「这趟其实结束了,只是没人标完成」这件事
 * 说出来,而不是继续假装它要出发。
 */
export function groupTripsByTime(trips: readonly Trip[], now: Date = new Date()): {
  upcoming: Trip[];   // 还没开始
  ongoing: Trip[];    // 已经在路上
  overdue: Trip[];    // 结束日期都过了,却还没标完成
} {
  const p = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const upcoming: Trip[] = []; const ongoing: Trip[] = []; const overdue: Trip[] = [];
  for (const t of trips) {
    const start = (t.startDate || '').slice(0, 10);
    const end = (t.endDate || '').slice(0, 10) || start;
    if (start && start > today) upcoming.push(t);
    else if (end && end < today) overdue.push(t);
    else ongoing.push(t);   // 含日期缺失/看不懂的 —— 归到「在路上」比归到「即将出发」诚实
  }
  return { upcoming, ongoing, overdue };
}

export function listCompletedTrips(): Trip[] {
  return loadTrips()
    .filter((t) => t.status === 'completed')
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
}

export function getTrip(id: string): Trip | null {
  return loadTrips().find((t) => t.id === id) ?? null;
}

export function upsertTrip(trip: Trip): Trip {
  const all = loadTrips();
  const i = all.findIndex((t) => t.id === trip.id);
  const next = { ...trip, updatedAt: nowIso() };
  if (i >= 0) all[i] = next;
  else all.unshift(next);
  saveTrips(all);
  return next;
}

export function deleteTrip(id: string): void {
  saveTrips(loadTrips().filter((t) => t.id !== id));
}

/** 完成后沉进「足迹(去过)」。 */
export function completeTrip(id: string): Trip | null {
  const t = getTrip(id);
  if (!t) return null;
  return upsertTrip({ ...t, status: 'completed' });
}

export function updateNode(tripId: string, nodeId: string, patch: Partial<TripNode>): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const nodes = t.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, id: n.id } : n));
  return upsertTrip({ ...t, nodes });
}

/** need−have:对照物品库,刷新打包清单状态。 */
export function refreshPackingAgainstInventory(tripId: string, nodeId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const node = t.nodes.find((n) => n.id === nodeId);
  if (!node || node.payload.kind !== 'packing') return t;
  // 名字 → 位置。有位置就把它带到打包项上,让每一行直接显示「在哪」而不是只显示「已有」。
  const invPlace = new Map<string, string>();
  for (const i of listInventoryItems()) {
    const k = i.name.trim().toLowerCase();
    if (!k) continue;
    if (!invPlace.has(k)) invPlace.set(k, (i.location || '').trim());
  }
  const items = node.payload.packing.items.map((it) => {
    const k = it.name.trim().toLowerCase();
    const has = invPlace.has(k);
    const place = has ? (invPlace.get(k) || '') : '';
    return { ...it, status: (has ? 'have' : 'need') as 'have' | 'need', ...(place ? { place } : {}) };
  });
  const needCount = items.filter((i) => i.status === 'need').length;
  return updateNode(tripId, nodeId, {
    subtitle: needCount > 0
      ? `${items.length} 样 · ${needCount} 样需买`
      : `${items.length} 样 · 齐了`,
    payload: { kind: 'packing', packing: { ...node.payload.packing, items } },
    state: needCount > 0 ? 'todo' : 'booked',
  });
}

/** 把打包「需买」并入全局购物清单(复用做饭 shopping)。 */
export function pushPackingNeedsToShopping(tripId: string, nodeId: string): number {
  const t = getTrip(tripId);
  const node = t?.nodes.find((n) => n.id === nodeId);
  if (!node || node.payload.kind !== 'packing') return 0;
  const needs = node.payload.packing.items.filter((i) => i.status === 'need').map((i) => i.name);
  if (!needs.length) return 0;
  addToShopping(needs);
  return needs.length;
}

export function tripBudgetSummary(trip: Trip): {
  actual: number;
  budget: number;
  currency: string;
  progressPct: number;
  remaining: number;
} {
  const budgetNode = trip.nodes.find((n) => n.payload.kind === 'budget');
  let actual = 0;
  let budget = 0;
  let currency = trip.currency || '$';
  if (budgetNode && budgetNode.payload.kind === 'budget') {
    actual = budgetNode.payload.budget.actualTotal;
    budget = budgetNode.payload.budget.budgetTotal;
    currency = budgetNode.payload.budget.currency || currency;
  } else {
    for (const n of trip.nodes) {
      if (n.payload.kind === 'hotel') {
        const h = n.payload.hotel;
        actual += (h.pricePerNight || 0) * (h.nights || 1);
      }
      if (n.payload.kind === 'shopping') actual += n.payload.shopping.total || 0;
    }
  }
  return {
    actual,
    budget,
    currency,
    progressPct: ledgerProgressPct(actual, budget),
    remaining: ledgerRemaining(actual, budget),
  };
}

/** 按 dayKey 分组,保持节点顺序;组内按 at 时间排序。 */
export function groupNodesByDay(nodes: TripNode[]): Array<{ dayKey: string; dayLabel: string; nodes: TripNode[] }> {
  const order: string[] = [];
  const map = new Map<string, { dayLabel: string; nodes: TripNode[] }>();
  for (const n of nodes) {
    const key = n.dayKey || '_pre';
    const label = n.dayLabel || (key === '_pre' ? '出发前' : key);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { dayLabel: label, nodes: [] });
    }
    map.get(key)!.nodes.push(n);
  }
  return order.map((k) => {
    const g = map.get(k)!;
    g.nodes.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.at ? new Date(b.at).getTime() : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return 0;
    });
    return { dayKey: k, dayLabel: g.dayLabel, nodes: g.nodes };
  });
}

/** 时间线左侧文案:优先 ISO at → 本地化具体时间,否则 timeLabel。 */
export function formatTripNodeTime(n: TripNode, dict: string): string {
  if (n.at) {
    const d = new Date(n.at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(dict === 'en' ? 'en-US' : 'zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        hour12: dict === 'en',
      });
    }
  }
  const t = (n.timeLabel || '').trim();
  return t || '·';
}

/** 从订票确认文本片段解析日期/时间 → at + timeLabel。 */
function parseBookingDateTime(chunk: string): { at?: string; timeLabel: string } {
  const dateIso = chunk.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const dateUs = chunk.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  const time12 = chunk.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\b/);
  const time24 = chunk.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

  let y = 0; let mo = 0; let d = 0;
  if (dateIso) {
    y = Number(dateIso[1]); mo = Number(dateIso[2]); d = Number(dateIso[3]);
  } else if (dateUs) {
    mo = Number(dateUs[1]); d = Number(dateUs[2]); y = Number(dateUs[3]);
  }
  let hh = 12; let mm = 0;
  if (time12) {
    hh = Number(time12[1]) % 12;
    if (/pm/i.test(time12[3])) hh += 12;
    mm = Number(time12[2]);
  } else if (time24) {
    hh = Number(time24[1]); mm = Number(time24[2]);
  }

  if (y && mo && d) {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
    const label = time12 || time24
      ? `${mo}/${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      : `${mo}/${d}`;
    return { at: iso, timeLabel: label };
  }
  if (time12 || time24) {
    const label = time12
      ? `${time12[1]}:${time12[2]} ${time12[3].toUpperCase()}`
      : `${time24![1]}:${time24![2]}`;
    return { timeLabel: label };
  }
  return { timeLabel: '' };
}

/** 新建空行程壳。 */
export function createBlankTrip(input: {
  title: string; destination: string; startDate: string; endDate: string; days?: number;
}): Trip {
  const start = new Date(`${input.startDate}T12:00:00`);
  const end = new Date(`${input.endDate}T12:00:00`);
  const days = input.days ?? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const trip: Trip = {
    id: uid('trip'),
    title: input.title.trim() || `${input.destination} · ${days} 天`,
    destination: input.destination.trim(),
    status: 'planned',
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    currency: '$',
    budgetTotal: 0,
    nodes: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return upsertTrip(trip);
}

const DEMO_FLAG = 'nesio-travel-demo-seeded-v1';

/** 首次打开计划 tab 时种一趟设计稿同款东京 demo(可删)。 */
export function ensureDemoTokyoTrip(): Trip | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(DEMO_FLAG)) return null;
  } catch { return null; }
  if (loadTrips().length > 0) {
    try { localStorage.setItem(DEMO_FLAG, '1'); } catch { /* */ }
    return null;
  }
  const trip = buildDemoTokyoTrip();
  upsertTrip(trip);
  try { localStorage.setItem(DEMO_FLAG, '1'); } catch { /* */ }
  return trip;
}

export function buildDemoTokyoTrip(): Trip {
  const packingItems: PackingItem[] = [
    { name: '冲锋衣', reason: '有雨', status: 'have' },
    { name: '转换插头 A型', reason: '物品里没有', status: 'need' },
    { name: '正装皮鞋', status: 'have' },
    { name: '徒步鞋', status: 'need' },
  ];
  // 对照本机物品库刷新 have/need
  const inv = new Set(listInventoryItems().map((i) => i.name.trim().toLowerCase()));
  for (const it of packingItems) {
    it.status = inv.has(it.name.toLowerCase()) ? 'have' : it.status;
  }
  const needN = packingItems.filter((i) => i.status === 'need').length;

  const nodes: TripNode[] = [
    {
      id: uid('n'), kind: 'packing', state: needN ? 'todo' : 'booked',
      timeLabel: '今晚', dayKey: '_pre', dayLabel: '出发前',
      title: '打包清单',
      subtitle: `5 天 · 有雨 · ${needN} 样需买,点开看`,
      payload: {
        kind: 'packing',
        packing: {
          summary: '按东京 5 天 · 12–16° · 有雨 · 徒步/正餐生成 — 对照物品库,标出缺的',
          items: packingItems,
        },
      },
    },
    {
      id: uid('n'), kind: 'flight', state: 'booked',
      timeLabel: '08:20 AM', at: '2026-02-20T08:20:00+08:00',
      dayKey: 'd1', dayLabel: '周五 · DAY 1',
      title: '浦东 PVG → 关西 KIX',
      subtitle: 'NH976 · ANA · 座位 32A · 准点',
      payload: {
        kind: 'flight',
        flight: {
          from: '浦东', to: '关西', fromCode: 'PVG', toCode: 'KIX',
          flightNo: 'NH976', airline: 'ANA', seat: '32A', cabin: '经济舱',
          confirmation: 'ABC123', statusText: '准点', terminal: 'T2',
        },
      },
    },
    {
      id: uid('n'), kind: 'transit', state: 'booked',
      timeLabel: '', dayKey: 'd1', dayLabel: '周五 · DAY 1',
      title: '中转 1 小时 · 关西',
      payload: { kind: 'transit', transit: { label: '中转 1 小时 · 关西', durationMin: 60, place: 'KIX' } },
    },
    {
      id: uid('n'), kind: 'flight', state: 'booked',
      timeLabel: '12:30 PM', at: '2026-02-20T12:30:00+09:00',
      dayKey: 'd1', dayLabel: '周五 · DAY 1',
      title: '关西 KIX → 羽田 HND',
      subtitle: 'NH018 · ANA · 座位 14C',
      payload: {
        kind: 'flight',
        flight: {
          from: '关西', to: '羽田', fromCode: 'KIX', toCode: 'HND',
          flightNo: 'NH018', airline: 'ANA', seat: '14C', statusText: '准点',
        },
      },
    },
    {
      id: uid('n'), kind: 'hotel', state: 'booked',
      timeLabel: '15:00 PM', at: '2026-02-20T15:00:00+09:00',
      dayKey: 'd1', dayLabel: '周五 · DAY 1',
      title: '入住 · 新宿格拉斯丽',
      subtitle: '¥1,200/晚 · 点开看地址/价格',
      payload: {
        kind: 'hotel',
        hotel: {
          name: '新宿格拉斯丽', address: '东京都新宿区歌舞伎町 1-19-1',
          pricePerNight: 1200, nights: 2, currency: '¥',
          checkIn: '2/21 15:00', checkOut: '2/23 11:00',
          confirmation: '8842', phone: '+81-3-3200-0000',
          lat: 35.695, lon: 139.702,
        },
      },
    },
    {
      id: uid('n'), kind: 'shopping', state: 'booked',
      timeLabel: '傍晚', dayKey: 'd2', dayLabel: '周六 · DAY 2',
      title: '购物 · 药妆店',
      subtitle: '2/21 · ¥3,400',
      payload: {
        kind: 'shopping',
        shopping: {
          title: '购物 · 药妆店', date: '2/21', total: 3400, currency: '¥',
          lines: [
            { name: '面膜 x5', price: 180, note: '已入物品库', intoInventory: true },
            { name: '眼药水 x2', price: 120 },
            { name: '相机 · 二手', price: 2650, note: '给自己的', intoInventory: true },
            { name: '手办 · 给小孩', price: 450 },
          ],
        },
      },
    },
    {
      id: uid('n'), kind: 'budget', state: 'booked',
      timeLabel: '', dayKey: '_budget', dayLabel: '行程预算',
      title: '行程预算',
      subtitle: '实际 ¥6,800 / 预算 12,000',
      payload: {
        kind: 'budget',
        budget: {
          currency: '¥', actualTotal: 6800, budgetTotal: 12000,
          categories: [
            { id: 'flight', label: '机票', actual: 3200, budget: 3000 },
            { id: 'stay', label: '住宿', actual: 2400, budget: 2500 },
            { id: 'shop', label: '购物', actual: 1200, budget: 3000 },
          ],
        },
      },
    },
  ];

  return {
    id: uid('trip'),
    title: '东京 · 5 天',
    destination: '东京',
    status: 'planned',
    startDate: '2026-02-20',
    endDate: '2026-02-24',
    days: 5,
    weatherHint: '12–16° · 有雨',
    budgetTotal: 12000,
    currency: '¥',
    nodes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function addTripNode(tripId: string, node: Omit<TripNode, 'id'> & { id?: string }): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const next: TripNode = { ...node, id: node.id || uid('n') };
  return upsertTrip({ ...t, nodes: [...t.nodes, next] });
}

export function removeTripNode(tripId: string, nodeId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const removed = t.nodes.find((n) => n.id === nodeId);
  upsertTrip({ ...t, nodes: t.nodes.filter((n) => n.id !== nodeId) });
  // 删酒店/购物等会影响预算;预算节点本身不重算成空环
  if (removed && removed.kind !== 'budget') recomputeBudgetNode(tripId);
  return getTrip(tripId);
}

/** 按天数/目的地生成打包清单,并对照物品库标 have/need。 */
export function generatePackingList(tripId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const base: PackingItem[] = [
    { name: '证件/护照', status: 'need' },
    { name: '充电器', status: 'need' },
    { name: '转换插头', status: 'need' },
    { name: '换洗衣物', reason: `${t.days} 天`, status: 'need' },
    { name: '洗漱用品', status: 'need' },
  ];
  if (t.weatherHint?.includes('雨') || /雨|rain/i.test(t.destination)) {
    base.push({ name: '雨具/冲锋衣', reason: '有雨', status: 'need' });
  }
  if (t.days >= 4) base.push({ name: '舒适步行鞋', status: 'need' });
  // 自动对照物品库(bug3:「对照物品库按钮不需要,自动对照」),并把位置带上 ——
  // 每一行于是能直接显示「需买」或者「在哪」。
  const invPlace = new Map<string, string>();
  for (const i of listInventoryItems()) {
    const k = i.name.trim().toLowerCase();
    if (k && !invPlace.has(k)) invPlace.set(k, (i.location || '').trim());
  }
  const items: PackingItem[] = base.map((it) => {
    const k = it.name.trim().toLowerCase();
    const has = invPlace.has(k);
    const place = has ? (invPlace.get(k) || '') : '';
    return { ...it, status: has ? 'have' : 'need', ...(place ? { place } : {}) };
  });
  const needN = items.filter((i) => i.status === 'need').length;
  const packingNode: TripNode = {
    id: uid('n'),
    kind: 'packing',
    state: needN ? 'todo' : 'booked',
    timeLabel: '出发前',
    dayKey: '_pre',
    dayLabel: '出发前',
    title: '打包清单',
    subtitle: `${t.days} 天 · ${needN} 样需买`,
    payload: {
      kind: 'packing',
      packing: {
        summary: `按 ${t.destination} · ${t.days} 天${t.weatherHint ? ` · ${t.weatherHint}` : ''} 生成 — 已对照物品库`,
        items,
      },
    },
  };
  const withoutOld = t.nodes.filter((n) => n.kind !== 'packing');
  return upsertTrip({ ...t, nodes: [packingNode, ...withoutOld] });
}

/** 订票正文里偶发超大数字串(订单号/金额粘连)——拒绝进预算。 */
const MAX_REASONABLE_PRICE = 1_000_000;

const DEFAULT_BUDGET_CATS = [
  { id: 'flight', label: '机票' },
  { id: 'stay', label: '住宿' },
  { id: 'shop', label: '购物' },
] as const;

function sumTripAnnotatedBankTx(tripId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const anns = loadTxAnnotations();
    let sum = 0;
    for (const tx of loadBankTx()) {
      const ann = anns[tx.id];
      if (ann?.tripId !== tripId) continue;
      const amt = Math.abs(Number(tx.amount) || 0);
      if (amt > 0 && amt <= MAX_REASONABLE_PRICE) sum += amt;
    }
    return Math.round(sum * 100) / 100;
  } catch {
    return 0;
  }
}

/** 从上传文件提取订票确认文本(PDF 文字层 / 纯文本);扫描件 PDF 与图片需用户粘贴 OCR 结果。 */
export async function extractTextFromBookingFile(
  file: File,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'empty' | 'binary' | 'pdf_scanned' | 'pdf_failed' | 'image' | 'read_failed' }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name);

  if (isImage) return { ok: false, reason: 'image' };

  if (isPdf) {
    try {
      const { readLabPdf, looksLikeTextLayer } = await import('@/lib/health/lab-pdf');
      const r = await readLabPdf(file);
      if (r.kind === 'text' && looksLikeTextLayer(r.lines, r.pages)) {
        const text = r.lines.join('\n').trim();
        if (!text) return { ok: false, reason: 'empty' };
        return { ok: true, text: text.slice(0, 20000) };
      }
      return { ok: false, reason: 'pdf_scanned' };
    } catch {
      return { ok: false, reason: 'pdf_failed' };
    }
  }

  try {
    const text = await file.text();
    if (!text.trim()) return { ok: false, reason: 'empty' };
    if (/[\u0000]/.test(text.slice(0, 200)) || (text.match(/[^\x09\x0a\x0d\x20-\x7E\u0080-\uFFFF]/g) || []).length > text.length * 0.3) {
      return { ok: false, reason: 'binary' };
    }
    return { ok: true, text: text.slice(0, 20000) };
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
}

function parseMoneyNear(text: string): number | undefined {
  const m = text.match(/(?:¥|￥|CNY|RMB|USD|\$)\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_REASONABLE_PRICE) return undefined;
  return n;
}

/** 从订票确认文本解析航班/酒店节点(本地规则,不耗云)。 */
export function parseBookingConfirmation(text: string): TripNode[] {
  const raw = text.replace(/\r/g, '\n');
  const nodes: TripNode[] = [];
  const flightRe = /\b([A-Z]{2})\s?(\d{2,4})\b/g;
  const routeRe = /([A-Z]{3})\s*[→\-~到至]\s*([A-Z]{3})/;
  const seatRe = /(?:座位|seat)\s*[:：]?\s*([0-9]{1,2}[A-F])/i;
  const confRe = /(?:确认号|confirmation|PNR|订座编码)\s*[:：]?\s*([A-Z0-9]{5,8})/i;
  const hotelRe = /(?:酒店|hotel|入住)\s*[:：]?\s*([^\n]{2,40})/i;

  let m: RegExpExecArray | null;
  const seenFlights = new Set<string>();
  while ((m = flightRe.exec(raw)) !== null) {
    const flightNo = `${m[1]}${m[2]}`;
    if (seenFlights.has(flightNo)) continue;
    seenFlights.add(flightNo);
    const window = raw.slice(Math.max(0, m.index - 120), m.index + 160);
    const route = window.match(routeRe);
    const seat = window.match(seatRe)?.[1] || raw.match(seatRe)?.[1];
    const confirmation = window.match(confRe)?.[1] || raw.match(confRe)?.[1];
    const fromCode = route?.[1];
    const toCode = route?.[2];
    const when = parseBookingDateTime(window);
    const price = parseMoneyNear(window);
    nodes.push({
      id: uid('n'),
      kind: 'flight',
      state: 'booked',
      timeLabel: when.timeLabel,
      ...(when.at ? { at: when.at } : {}),
      dayKey: 'd1',
      dayLabel: '行程日',
      title: fromCode && toCode ? `${fromCode} → ${toCode}` : `航班 ${flightNo}`,
      subtitle: [flightNo, seat ? `座位 ${seat}` : '', confirmation ? `确认 ${confirmation}` : '', price != null ? `$${price}` : ''].filter(Boolean).join(' · '),
      payload: {
        kind: 'flight',
        flight: {
          from: fromCode || '',
          to: toCode || '',
          fromCode,
          toCode,
          flightNo,
          seat,
          confirmation,
          statusText: '已订',
          ...(price != null ? { price, currency: '$' } : {}),
          ...(when.at ? { departureAt: when.at } : {}),
        },
      },
    });
  }

  const hotelMatch = raw.match(hotelRe);
  const hotelName = hotelMatch?.[1]?.trim();
  if (hotelName) {
    const hIdx = hotelMatch?.index ?? 0;
    // 价格只在酒店名附近扫,别扫全文把订单号/卡号粘成 ¥305 亿
    const priceWindow = raw.slice(Math.max(0, hIdx - 80), hIdx + 160);
    const price = parseMoneyNear(priceWindow);
    const when = parseBookingDateTime(raw.slice(Math.max(0, hIdx - 80), hIdx + 120));
    nodes.push({
      id: uid('n'),
      kind: 'hotel',
      state: 'booked',
      timeLabel: when.timeLabel,
      ...(when.at ? { at: when.at } : {}),
      dayKey: 'd1',
      dayLabel: '行程日',
      title: `入住 · ${hotelName}`,
      subtitle: price != null ? `¥${price}` : undefined,
      payload: {
        kind: 'hotel',
        hotel: { name: hotelName, pricePerNight: price, nights: 1, currency: '¥' },
      },
    });
  }
  return nodes;
}

export function importBookingIntoTrip(tripId: string, text: string): number {
  const t = getTrip(tripId);
  if (!t) return 0;
  const parsed = parseBookingConfirmation(text);
  if (!parsed.length) return 0;
  upsertTrip({ ...t, nodes: [...t.nodes, ...parsed] });
  recomputeBudgetNode(tripId);
  return parsed.length;
}

/** 把小票条目并入行程购物节点,并刷新预算。 */
export function appendShoppingReceipt(
  tripId: string,
  lines: ShoppingLine[],
  meta?: { title?: string; date?: string; currency?: string },
): Trip | null {
  const t = getTrip(tripId);
  if (!t || !lines.length) return null;
  const total = lines.reduce((s, l) => s + (l.price || 0), 0);
  const node: TripNode = {
    id: uid('n'),
    kind: 'shopping',
    state: 'booked',
    timeLabel: meta?.date || '',
    dayKey: 'shop',
    dayLabel: '购物',
    title: meta?.title || '购物 · 小票',
    subtitle: total > 0 ? `${meta?.currency || '¥'}${total}` : `${lines.length} 样`,
    payload: {
      kind: 'shopping',
      shopping: {
        title: meta?.title || '购物 · 小票',
        date: meta?.date,
        total: total || undefined,
        currency: meta?.currency || '¥',
        lines,
      },
    },
  };
  const next = upsertTrip({ ...t, nodes: [...t.nodes, node] });
  recomputeBudgetNode(tripId);
  // 默认记入财务聚合口(不写 bank-tx);用户可日后在财务里看到「小票/旅行」旁条
  addReceiptExpense({
    lines,
    date: meta?.date,
    currency: meta?.currency || '¥',
    source: 'travel',
    sourceRef: `${tripId}:${node.id}`,
    merchant: meta?.title,
    includeInFinance: true,
  });
  return getTrip(tripId) || next;
}

/** 按航班/酒店/购物/刷卡批注重算预算节点。 */
export function recomputeBudgetNode(tripId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  let flight = 0;
  let stay = 0;
  let shop = 0;
  const customActual: Record<string, number> = {};
  for (const n of t.nodes) {
    if (n.payload.kind === 'hotel') {
      const h = n.payload.hotel;
      const line = (h.pricePerNight || 0) * (h.nights || 1);
      if (line > 0 && line <= MAX_REASONABLE_PRICE) stay += line;
    }
    if (n.payload.kind === 'shopping') {
      const tot = n.payload.shopping.total || 0;
      if (tot > 0 && tot <= MAX_REASONABLE_PRICE) shop += tot;
    }
    if (n.payload.kind === 'flight') {
      const p = n.payload.flight.price || 0;
      if (p > 0 && p <= MAX_REASONABLE_PRICE) flight += p;
    }
  }
  const bank = sumTripAnnotatedBankTx(tripId);
  const actualTotal = flight + stay + shop + bank;
  const over = t.budgetByCategory || {};
  const hasOverride = Object.keys(over).length > 0;
  let sticky = Number(t.budgetTotal) || 0;
  if (sticky > MAX_REASONABLE_PRICE) sticky = 0;
  if (sticky > 0 && actualTotal === 0 && !hasOverride) sticky = 0;
  if (sticky > 0 && actualTotal > 0 && sticky > Math.max(actualTotal * 20, 1_000_000) && !hasOverride) sticky = 0;
  const autoTotal = sticky > 0 ? sticky : Math.max(actualTotal, 0);
  const share: Record<string, number> = {
    flight: Math.round(autoTotal * 0.35), stay: Math.round(autoTotal * 0.3), shop: Math.round(autoTotal * 0.35),
  };
  const catBudget = (id: string) => {
    if (Number.isFinite(over[id])) {
      const v = Math.max(0, Math.round(Number(over[id])));
      return v > MAX_REASONABLE_PRICE ? 0 : v;
    }
    return share[id] || 0;
  };
  const categories: BudgetCategory[] = [
    { id: 'flight', label: '机票', actual: flight, budget: catBudget('flight') },
    { id: 'stay', label: '住宿', actual: stay, budget: catBudget('stay') },
    { id: 'shop', label: '购物', actual: shop, budget: catBudget('shop') },
  ];
  if (bank > 0) {
    categories.push({ id: 'bank', label: '刷卡', actual: bank, budget: catBudget('bank') });
  }
  for (const c of t.customBudgetCategories || []) {
    if (categories.some((x) => x.id === c.id)) continue;
    categories.push({
      id: c.id,
      label: c.label,
      actual: customActual[c.id] || 0,
      budget: catBudget(c.id),
    });
  }
  const budgetTotal = hasOverride
    ? categories.reduce((a, c) => a + c.budget, 0)
    : (autoTotal || actualTotal || 0);
  const budgetPayload: BudgetPayload = {
    currency: t.currency || '$',
    actualTotal,
    budgetTotal,
    categories,
  };
  const existing = t.nodes.find((n) => n.kind === 'budget');
  const cur = budgetPayload.currency || '$';
  const budgetNode: TripNode = {
    id: existing?.id || uid('n'),
    kind: 'budget',
    state: 'booked',
    timeLabel: '',
    dayKey: '_budget',
    dayLabel: '行程预算',
    title: '行程预算',
    subtitle: `实际 ${cur}${actualTotal.toLocaleString()} / 预算 ${budgetPayload.budgetTotal.toLocaleString()}`,
    payload: { kind: 'budget', budget: budgetPayload },
  };
  const others = t.nodes.filter((n) => n.kind !== 'budget');
  return upsertTrip({ ...t, nodes: [...others, budgetNode], budgetTotal: budgetPayload.budgetTotal });
}

/**
 * 改某一类的预算(bug3:预算页每一行要能点、能改)。
 * 写进 Trip.budgetByCategory 后重算预算节点 —— 覆盖是持久的,「按节点重算」不会抹掉。
 */
export function setCategoryBudget(tripId: string, categoryId: string, budget: number): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const amt = Math.max(0, Math.min(MAX_REASONABLE_PRICE, Math.round(Number(budget) || 0)));
  upsertTrip({ ...t, budgetByCategory: { ...(t.budgetByCategory || {}), [categoryId]: amt } });
  return recomputeBudgetNode(tripId);
}

/** 手改行程总预算(预算页顶栏可点)。清掉分类覆盖后按 35/30/35 重摊。 */
export function setTripBudgetTotal(tripId: string, total: number): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const amt = Math.max(0, Math.min(MAX_REASONABLE_PRICE, Math.round(Number(total) || 0)));
  upsertTrip({ ...t, budgetTotal: amt, budgetByCategory: {} });
  return recomputeBudgetNode(tripId);
}

/** 清零手填/误解析预算,回到「按节点实际」。 */
export function clearTripBudget(tripId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  upsertTrip({ ...t, budgetTotal: 0, budgetByCategory: {} });
  return recomputeBudgetNode(tripId);
}

/** 新增自定义预算分类(可删;预算额走 budgetByCategory)。 */
export function addCustomBudgetCategory(tripId: string, label: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  const id = uid('bcat');
  const existing = t.customBudgetCategories || [];
  if (existing.some((c) => c.label === trimmed)) return recomputeBudgetNode(tripId);
  upsertTrip({ ...t, customBudgetCategories: [...existing, { id, label: trimmed }] });
  return recomputeBudgetNode(tripId);
}

/** 删除自定义预算分类(连同 budgetByCategory 里的覆盖)。 */
export function removeCustomBudgetCategory(tripId: string, categoryId: string): Trip | null {
  const t = getTrip(tripId);
  if (!t) return null;
  if (DEFAULT_BUDGET_CATS.some((c) => c.id === categoryId) || categoryId === 'bank') return t;
  const nextCustom = (t.customBudgetCategories || []).filter((c) => c.id !== categoryId);
  const nextOver = { ...(t.budgetByCategory || {}) };
  delete nextOver[categoryId];
  upsertTrip({ ...t, customBudgetCategories: nextCustom, budgetByCategory: nextOver });
  return recomputeBudgetNode(tripId);
}

const CHECKIN_KEY = 'nesio-travel-checkin-reminders-v1';

/** 本地记下值机提醒(起飞前 24h);UI 可读列表。 */
export function setFlightCheckInReminder(tripId: string, nodeId: string, atIso?: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(CHECKIN_KEY);
    const list: Array<{ tripId: string; nodeId: string; at: string }> = raw ? JSON.parse(raw) : [];
    const at = atIso || new Date(Date.now() + 86400000).toISOString();
    const next = list.filter((x) => !(x.tripId === tripId && x.nodeId === nodeId));
    next.push({ tripId, nodeId, at });
    localStorage.setItem(CHECKIN_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function hasFlightCheckInReminder(tripId: string, nodeId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(CHECKIN_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw) as Array<{ tripId: string; nodeId: string }>;
    return list.some((x) => x.tripId === tripId && x.nodeId === nodeId);
  } catch {
    return false;
  }
}

/** 小票识别结果挂到哪趟行程(CameraSheet 保存成功后才消费)。 */
export const TRAVEL_RECEIPT_TRIP_KEY = 'nesio-travel-receipt-trip-v1';

export function armTravelReceiptCapture(tripId: string): void {
  try { sessionStorage.setItem(TRAVEL_RECEIPT_TRIP_KEY, tripId); } catch { /* */ }
}

/** 读行程挂钩,不消费 —— 保存失败 / OCR 无可用行时要留着让用户重试。 */
export function peekTravelReceiptTripId(): string | null {
  try { return sessionStorage.getItem(TRAVEL_RECEIPT_TRIP_KEY); } catch { return null; }
}

export function consumeTravelReceiptTripId(): string | null {
  try {
    const id = sessionStorage.getItem(TRAVEL_RECEIPT_TRIP_KEY);
    if (id) sessionStorage.removeItem(TRAVEL_RECEIPT_TRIP_KEY);
    return id;
  } catch {
    return null;
  }
}

export function clearTravelReceiptTripId(): void {
  try { sessionStorage.removeItem(TRAVEL_RECEIPT_TRIP_KEY); } catch { /* */ }
}

/** 相机/OCR 条目 → 行程购物行;滤掉空名且无价的噪声行。 */
export function buildUsableReceiptLines(
  things: Array<{ name: string; price?: string; attributes?: Record<string, string | number | boolean | null> }>,
  untitledLabel = '未命名',
): ShoppingLine[] {
  return things
    .map((n) => {
      const name = (n.name || '').trim();
      const priceRaw = n.price?.trim() ? Number(String(n.price).replace(/[^\d.]/g, '')) : undefined;
      const price = priceRaw != null && Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : undefined;
      const note = n.attributes?.store ? String(n.attributes.store) : undefined;
      return { name, price, note, intoInventory: true as const };
    })
    .filter((l) => {
      const hasName = l.name.length > 0 && l.name !== untitledLabel && l.name !== 'Untitled';
      return hasName || (l.price || 0) > 0;
    });
}

/** 把离线景点加入行程时间线(描边待办=还没去)。 */
export function addPoisToTrip(
  tripId: string,
  pois: Array<{
    name: string; lat: number; lon: number;
    country?: string; type?: string; wikidata?: string;
    summary?: string; summaryEn?: string;
    ticketPrice?: string; hours?: string; tips?: string; imageUrl?: string;
  }>,
): number {
  const t = getTrip(tripId);
  if (!t || !pois.length) return 0;
  const existing = new Set(
    t.nodes.filter((n) => n.payload.kind === 'poi').map((n) => n.payload.kind === 'poi' ? n.payload.poi.name.toLowerCase() : ''),
  );
  const nodes: TripNode[] = [];
  for (const p of pois) {
    const key = p.name.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    nodes.push({
      id: uid('n'),
      kind: 'poi',
      state: 'todo',
      timeLabel: '',
      dayKey: 'poi',
      dayLabel: '想去的景点',
      title: p.name,
      subtitle: [p.type, p.country].filter(Boolean).join(' · ') || undefined,
      payload: {
        kind: 'poi',
        poi: {
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          country: p.country,
          type: p.type,
          wikidata: p.wikidata,
          summary: p.summary,
          summaryEn: p.summaryEn,
          ticketPrice: p.ticketPrice,
          hours: p.hours,
          tips: p.tips,
          imageUrl: p.imageUrl,
        },
      },
    });
  }
  if (!nodes.length) return 0;
  upsertTrip({ ...t, nodes: [...t.nodes, ...nodes] });
  return nodes.length;
}
