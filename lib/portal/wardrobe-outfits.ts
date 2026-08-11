/**
 * wardrobe-outfits — 存下来的搭配(2026-07-28,用户标注 PDF2 图15:
 *「增加一个 tab 用来展示存下来的搭配。还可以按日历展示,还可以点星表示喜欢,
 *  可以点不喜欢,表示淘汰」)。
 *
 * 之前搭配是**每次现算**的:关掉页面就没了,昨天穿的那套再也找不回来。这里把它落下来:
 *   一条 SavedOutfit = 单品 id 列表 + 哪天穿的 + 星标(喜欢) + 淘汰(不再推)。
 *
 * 「淘汰」不是删除 —— 记录留着(你确实那天穿过),只是打个 retired 标,
 * 以后搭配不再推这一组。要真删有 removeOutfit。
 *
 * 上半段是纯函数(排序 / 按月分组 / 去重 / 淘汰组合集),可直接单测;
 * 只有下半段碰 localStorage。契约测试见 scripts/wardrobe-outfits.test.mjs。
 */

export interface SavedOutfit {
  id: string;
  /** 单品 id(按存的时候的顺序) */
  pieceIds: string[];
  /** 穿这套的日期 'YYYY-MM-DD' —— 日历视图按它排 */
  date: string;
  /** 点星 = 喜欢 */
  starred?: boolean;
  /** 点不喜欢 = 淘汰(不再推这一组,但记录留着) */
  retired?: boolean;
  /**
   * 这条是「计划」而不是「穿过」(bug3:列表长按可以选那天穿 → 日历上占一格)。
   * 计划到了那天点「穿了」就把这个标去掉,记录转成真穿过 —— 所以「穿过几次」只数没这个标的。
   */
  planned?: boolean;
  /** 这一组的上身试穿图(local-image-store 的 assetId)—— 日历格子优先显示它。 */
  tryonAssetId?: string;
  /** 存的时刻(同一天存了几套时用来定先后) */
  at: string;
}

/** 一组搭配的归一 key —— 单品 id 排序后拼,用来判「是不是同一套」。 */
export function outfitKey(pieceIds: readonly string[]): string {
  return [...pieceIds].sort().join('|');
}

/** 新 → 旧;同一天按存入时刻倒序。 */
export function sortOutfits(list: readonly SavedOutfit[]): SavedOutfit[] {
  return [...list].sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : (a.date < b.date ? 1 : -1)));
}

/** 按月分组(key = 'YYYY-MM'),月内按日期新 → 旧。给日历视图用。 */
export function groupByMonth(list: readonly SavedOutfit[]): Array<{ month: string; items: SavedOutfit[] }> {
  const map = new Map<string, SavedOutfit[]>();
  for (const o of sortOutfits(list)) {
    const m = o.date.slice(0, 7);
    const arr = map.get(m);
    if (arr) arr.push(o); else map.set(m, [o]);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, items]) => ({ month, items }));
}

/** 某一天穿的(可能不止一套)。 */
export function outfitsOn(list: readonly SavedOutfit[], date: string): SavedOutfit[] {
  return sortOutfits(list.filter((o) => o.date === date));
}

/**
 * 这一组真穿过几次(bug3:列表栏显示已经穿过几次)。
 * 只数「不是计划」的记录 —— 排在日历上还没到那天的不算穿过。
 */
export function wornCount(list: readonly SavedOutfit[], pieceIds: readonly string[]): number {
  const k = outfitKey(pieceIds);
  return list.filter((o) => !o.planned && outfitKey(o.pieceIds) === k).length;
}

/** 这一组最近一次的上身试穿图 —— 同一套排到别的日子时不用重新生成。 */
export function tryonOf(list: readonly SavedOutfit[], pieceIds: readonly string[]): string | null {
  const k = outfitKey(pieceIds);
  for (const o of sortOutfits(list)) {
    if (o.tryonAssetId && outfitKey(o.pieceIds) === k) return o.tryonAssetId;
  }
  return null;
}

/** 被淘汰过的组合 key 集合 —— 搭配算法据此避开。 */
export function retiredKeys(list: readonly SavedOutfit[]): Set<string> {
  const s = new Set<string>();
  for (const o of list) if (o.retired) s.add(outfitKey(o.pieceIds));
  return s;
}

/**
 * 同一天存同一套 → 更新那条,不新增(免得点两下「今天穿了」就出两条一样的)。
 * 返回新数组,不改入参。
 */
export function upsertOutfit(list: readonly SavedOutfit[], next: SavedOutfit): SavedOutfit[] {
  const k = outfitKey(next.pieceIds);
  const at = list.findIndex((o) => o.date === next.date && outfitKey(o.pieceIds) === k);
  if (at < 0) return [next, ...list];
  const merged = { ...list[at], ...next, id: list[at].id };
  return list.map((o, i) => (i === at ? merged : o));
}

// ── 存储(IDB blob;旧 LS 水合时自动迁出)────────────────────────────────────

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

const KEY = 'nesio-wardrobe-outfits-v1';
export const WARDROBE_OUTFITS_UPDATED = 'nesio-wardrobe-outfits-updated';

const store = createBlobStore<SavedOutfit[]>({
  key: KEY,
  updateEvent: WARDROBE_OUTFITS_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadOutfits(): SavedOutfit[] {
  return store.load() ?? [];
}

/** 写不进去返回 false —— 调用方必须显式告诉用户,不许静默吞(CLAUDE.md 红线)。 */
function persist(list: SavedOutfit[]): boolean {
  try {
    store.save(list.slice(0, 400));
    return true;
  } catch {
    reportStorageDropped();
    return false;
  }
}

export function saveOutfit(pieceIds: string[], date: string, patch?: Partial<SavedOutfit>): boolean {
  const now = new Date().toISOString();
  return persist(upsertOutfit(loadOutfits(), {
    id: `of-${now}-${Math.abs(outfitKey(pieceIds).length)}`,
    pieceIds, date, at: now, ...patch,
  }));
}

export function patchOutfit(id: string, patch: Partial<SavedOutfit>): boolean {
  return persist(loadOutfits().map((o) => (o.id === id ? { ...o, ...patch } : o)));
}

export function removeOutfit(id: string): boolean {
  return persist(loadOutfits().filter((o) => o.id !== id));
}
