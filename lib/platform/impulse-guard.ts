/**
 * Impulse Guard — 冷冻仓 (Freeze Vault)
 *
 * 冲动购物防护器。核心流程：
 * 1. 用户分享购物链接 → 解析商品信息
 * 2. 添加到冷冻仓，开始 N 小时冷冻期
 * 3. 冷冻期内每次想买时，Nesio 提醒你等一等
 * 4. 冷冻期结束后，用户决定：买 / 放弃 / 继续冷冻
 */

import { reportStorageDropped } from '@/lib/portal/storage-health';

export type FreezeDecision = 'pending' | 'bought' | 'skipped' | 'extended';

export interface FreezeItem {
  id: string;
  url: string;
  title: string;
  price?: string;
  image?: string;
  store?: string;
  frozenAt: string;
  freezeHours: number;
  thawAt: string;
  decision: FreezeDecision;
  note?: string;
  checkCount: number;
}

const STORE_KEY = 'nesio-freeze-vault-v1';
const DEFAULT_FREEZE_HOURS = 24;

export function getFreezeItems(): FreezeItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as FreezeItem[]) : [];
  } catch {
    return [];
  }
}

function saveFreezeItems(items: FreezeItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch { reportStorageDropped(); }
}

export function addToFreeze(item: Omit<FreezeItem, 'id' | 'frozenAt' | 'thawAt' | 'decision' | 'checkCount'> & { freezeHours?: number }): FreezeItem {
  const hours = item.freezeHours ?? DEFAULT_FREEZE_HOURS;
  const now = new Date().toISOString();
  const thaw = new Date(Date.now() + hours * 3_600_000).toISOString();
  const entry: FreezeItem = {
    id: `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url: item.url,
    title: item.title,
    price: item.price,
    image: item.image,
    store: item.store,
    frozenAt: now,
    freezeHours: hours,
    thawAt: thaw,
    decision: 'pending',
    note: item.note,
    checkCount: 0,
  };
  const items = getFreezeItems();
  items.unshift(entry);
  saveFreezeItems(items);
  return entry;
}

export function resolveItem(id: string, decision: FreezeDecision, extendHours?: number): void {
  const items = getFreezeItems();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  items[idx].decision = decision;
  if (decision === 'extended' && extendHours) {
    items[idx].thawAt = new Date(Date.now() + extendHours * 3_600_000).toISOString();
    items[idx].freezeHours = extendHours;
    items[idx].decision = 'pending';
  }
  items[idx].checkCount += 1;
  saveFreezeItems(items);
}

export function getActiveFreezeItems(): FreezeItem[] {
  const now = Date.now();
  return getFreezeItems().filter(
    (i) => i.decision === 'pending' && new Date(i.thawAt).getTime() > now,
  );
}

export function getThawedItems(): FreezeItem[] {
  const now = Date.now();
  return getFreezeItems().filter(
    (i) => i.decision === 'pending' && new Date(i.thawAt).getTime() <= now,
  );
}

/** Detect if a URL is a known shopping site */
export function isShoppingUrl(url: string): boolean {
  const SHOPPING_PATTERNS = [
    /taobao\.com/i, /tmall\.com/i, /jd\.com/i, /amazon\./i,
    /pinduoduo\.com/i, /suning\.com/i, /kaola\.com/i, /dangdang\.com/i,
    /shopify\.com/i, /item\./i,
  ];
  return SHOPPING_PATTERNS.some((p) => p.test(url));
}
