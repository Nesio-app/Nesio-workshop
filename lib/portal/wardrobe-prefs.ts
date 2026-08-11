/**
 * wardrobe-prefs — B｜穿搭反馈学习(端上规则引擎;偏好数据走 module-sync 换端)。
 * 把用户对每套搭配的反馈(👍 喜欢 / 👎 不喜欢 / 穿了)沉淀成偏好:
 *   - 颜色净好感(colorLikes):喜欢/穿了 +1、不喜欢 -1;
 *   - 拒绝过的上下装组合(dislikedPairs):以后规则版和云造型师都避开。
 * 2026-08-10:迁出 localStorage → IDB blob(「零云」只指规则计算端上跑,数据会同步)。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import { pairKey, type OutfitPrefs, type Garment } from './wardrobe';

const KEY = 'nesio-wardrobe-prefs-v1';
const COLOR_CLAMP = 4;
const MAX_PAIRS = 60;
export const WARDROBE_PREFS_UPDATED = 'nesio-wardrobe-prefs-updated';

const empty = (): OutfitPrefs => ({ colorLikes: {}, dislikedItemIds: [], dislikedPairs: [] });

const store = createBlobStore<OutfitPrefs>({
  key: KEY,
  updateEvent: WARDROBE_PREFS_UPDATED,
  validate: (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
  onWriteError: reportStorageDropped,
});

export function loadWardrobePrefs(): OutfitPrefs {
  const p = store.load();
  if (!p) return empty();
  return {
    colorLikes: (p.colorLikes && typeof p.colorLikes === 'object') ? p.colorLikes as Record<string, number> : {},
    dislikedItemIds: Array.isArray(p.dislikedItemIds) ? p.dislikedItemIds.filter((x) => typeof x === 'string') : [],
    dislikedPairs: Array.isArray(p.dislikedPairs) ? p.dislikedPairs.filter((x) => typeof x === 'string') : [],
  };
}

function save(p: OutfitPrefs): boolean {
  try {
    store.save(p);
    return true;
  } catch {
    reportStorageDropped();
    return false;
  }
}

export type FeedbackKind = 'like' | 'dislike' | 'worn';
type PieceLite = Pick<Garment, 'id' | 'colors' | 'garmentType'>;

/**
 * 记一条搭配反馈,返回更新后的偏好(纯计算 + 落盘)。
 * like/worn:该套各单品颜色 +1;dislike:颜色 -1 且记住这对上下装(以后避开)。
 */
export function recordOutfitFeedback(kind: FeedbackKind, pieces: readonly PieceLite[]): OutfitPrefs {
  const p = loadWardrobePrefs();
  const delta = kind === 'dislike' ? -1 : 1;
  for (const g of pieces) {
    for (const c of g.colors) {
      const v = (p.colorLikes[c] || 0) + delta;
      p.colorLikes[c] = Math.max(-COLOR_CLAMP, Math.min(COLOR_CLAMP, v));
    }
  }
  if (kind === 'dislike') {
    const top = pieces.find((g) => g.garmentType === 'top');
    const bottom = pieces.find((g) => g.garmentType === 'bottom');
    if (top && bottom) {
      const k = pairKey(top.id, bottom.id);
      if (!p.dislikedPairs.includes(k)) p.dislikedPairs.push(k);
      if (p.dislikedPairs.length > MAX_PAIRS) p.dislikedPairs = p.dislikedPairs.slice(-MAX_PAIRS);
    }
    // 单品级否决也落盘(QA:👎 曾几乎什么都不记 —— colors 常为空、非上下装组合没 pair 可记)
    for (const g of pieces) {
      if (!p.dislikedItemIds.includes(g.id)) p.dislikedItemIds.push(g.id);
    }
    if (p.dislikedItemIds.length > MAX_PAIRS * 2) p.dislikedItemIds = p.dislikedItemIds.slice(-MAX_PAIRS * 2);
  }
  save(p);
  return p;
}

/** 偏好 → 云造型师 prompt 的「避免」提示(拒绝过的组合 + 明显少用的颜色)。 */
export function buildStylistDislikes(prefs: OutfitPrefs, byId: Map<string, { name: string }>): string[] {
  const out: string[] = [];
  for (const key of prefs.dislikedPairs.slice(-8)) {
    const [a, b] = key.split('|');
    const na = byId.get(a)?.name, nb = byId.get(b)?.name;
    if (na && nb) out.push(`别再把「${na}」和「${nb}」搭在一起`);
  }
  const coldColors = Object.entries(prefs.colorLikes).filter(([, v]) => v <= -2).map(([c]) => c);
  if (coldColors.length) out.push(`少用这些颜色:${coldColors.join('、')}`);
  return out.slice(0, 10);
}
