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
import { addToShopping } from '@/lib/cooking/shopping';

export type TripStatus = 'planned' | 'active' | 'completed';
export type TripNodeKind =
  | 'flight' | 'hotel' | 'transit' | 'packing' | 'shopping' | 'budget' | 'todo';

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

export type TripNodePayload =
  | { kind: 'flight'; flight: FlightPayload }
  | { kind: 'hotel'; hotel: HotelPayload }
  | { kind: 'transit'; transit: TransitPayload }
  | { kind: 'packing'; packing: PackingPayload }
  | { kind: 'shopping'; shopping: ShoppingPayload }
  | { kind: 'budget'; budget: BudgetPayload }
  | { kind: 'todo'; todo: TodoPayload };

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
  const invNames = new Set(listInventoryItems().map((i) => i.name.trim().toLowerCase()));
  const items = node.payload.packing.items.map((it) => ({
    ...it,
    status: (invNames.has(it.name.trim().toLowerCase()) ? 'have' : 'need') as 'have' | 'need',
  }));
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

export function tripBudgetSummary(trip: Trip): { actual: number; budget: number; currency: string } {
  const budgetNode = trip.nodes.find((n) => n.payload.kind === 'budget');
  if (budgetNode && budgetNode.payload.kind === 'budget') {
    return {
      actual: budgetNode.payload.budget.actualTotal,
      budget: budgetNode.payload.budget.budgetTotal,
      currency: budgetNode.payload.budget.currency || trip.currency || '¥',
    };
  }
  // 从酒店/购物节点汇总实际
  let actual = 0;
  for (const n of trip.nodes) {
    if (n.payload.kind === 'hotel') {
      const h = n.payload.hotel;
      actual += (h.pricePerNight || 0) * (h.nights || 1);
    }
    if (n.payload.kind === 'shopping') actual += n.payload.shopping.total || 0;
  }
  return { actual, budget: trip.budgetTotal || 0, currency: trip.currency || '¥' };
}

/** 按 dayKey 分组,保持节点顺序。 */
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
  return order.map((k) => ({ dayKey: k, dayLabel: map.get(k)!.dayLabel, nodes: map.get(k)!.nodes }));
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
    currency: '¥',
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
