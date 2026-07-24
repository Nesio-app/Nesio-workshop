/**
 * wardrobe-prefs — B｜穿搭反馈学习(本地、隐私友好、零云)。
 * 把用户对每套搭配的反馈(👍 喜欢 / 👎 不喜欢 / 穿了)沉淀成偏好:
 *   - 颜色净好感(colorLikes):喜欢/穿了 +1、不喜欢 -1;
 *   - 拒绝过的上下装组合(dislikedPairs):以后规则版和云造型师都避开。
 * 偏好回喂:①规则版 suggestOutfit(传 prefs 调分);②云造型师(buildStylistDislikes → prompt)。
 * 全程 localStorage,写失败走 storage-health 可见事件(红线:不吞存储失败)。
 */

import { reportStorageDropped } from './storage-health';
import { pairKey, type OutfitPrefs, type Garment } from './wardrobe';

const KEY = 'nesio-wardrobe-prefs-v1';
const COLOR_CLAMP = 4;   // 每种颜色净好感封顶 ±4,避免一色霸榜
const MAX_PAIRS = 60;    // 拒绝组合上限,超出丢最早的

const empty = (): OutfitPrefs => ({ colorLikes: {}, dislikedItemIds: [], dislikedPairs: [] });

export function loadWardrobePrefs(): OutfitPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<OutfitPrefs>;
    return {
      colorLikes: (p.colorLikes && typeof p.colorLikes === 'object') ? p.colorLikes as Record<string, number> : {},
      dislikedItemIds: Array.isArray(p.dislikedItemIds) ? p.dislikedItemIds.filter((x) => typeof x === 'string') : [],
      dislikedPairs: Array.isArray(p.dislikedPairs) ? p.dislikedPairs.filter((x) => typeof x === 'string') : [],
    };
  } catch { return empty(); }
}

function save(p: OutfitPrefs): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(p)); return true; }
  catch { reportStorageDropped(); return false; } // 存储满/被拒 → 可见事件,不静默丢
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
