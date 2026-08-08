/**
 * wardrobe — 衣橱数据层 + 每日穿搭规则引擎(免费·端上·零云)。
 *
 * 架构:衣服**不建独立库**,和收纳物品一样是 life-graph 的 `object` 节点 —— 一份数据一个真相,
 * Memory 搜索 / 问一问 / 云同步全部免费获得。衣服 = 带 `attributes.garment===true` 的 object 节点,
 * category 固定「服饰」,结构化属性(类型/保暖/正式度/颜色/材质/季节)存在 attributes 里(标量;
 * 数组字段用逗号分隔字符串,因为 LifeNode.attributes 只收标量)。
 *
 * 分层(产品红线):
 *   - 免费/端上:拍照存图 + 手填/快选属性 + **规则版每日穿搭**(下方 suggestOutfit,纯确定性,离线可用)。
 *   - 付费/云:拍一下自动识别属性 + AI 搭配文案(在 WardrobePanel / analyze 路由,走 guardAiRoute)。
 * suggestOutfit 是纯函数(不碰 storage/DOM),既是免费兜底,也是云版的确定性底座。
 */

import { deleteLifeNode, getLifeGraph, updateLifeNode, type LifeNode } from './life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import type { CalendarEvent } from './types';

export const WARDROBE_CATEGORY = '服饰';

/** 衣物大类。稳定英文 key(存 attributes),显示名走 i18n。 */
export type GarmentType = 'top' | 'bottom' | 'outer' | 'dress' | 'shoes' | 'accessory';
export const GARMENT_TYPES: GarmentType[] = ['top', 'bottom', 'outer', 'dress', 'shoes', 'accessory'];

/** 保暖档:1 薄 · 2 适中 · 3 保暖。 */
export type Warmth = 1 | 2 | 3;
/** 正式度:休闲 · 通勤 · 正式。 */
export type Formality = 'casual' | 'smart' | 'formal';
export const FORMALITIES: Formality[] = ['casual', 'smart', 'formal'];

export interface Garment {
  node: LifeNode;
  id: string;
  name: string;
  garmentType: GarmentType;
  warmth: Warmth;
  formality: Formality;
  colors: string[];       // ['蓝','白']
  material: string;
  seasons: string[];      // ['春','秋'];空 = 全季
  hasPhoto: boolean;
  assetId: string | null; // 首张图 assetId(缩略图优先 getLocalImage)
  /** 云 Storage 路径(换端无本机图时用签名 URL 读)。来自 assets[].storagePath。 */
  storagePath: string | null;
  lastWornAt: string | null;
  wearCount: number;
  /** 买这件花了多少。null = 没记。见 NewGarment.price 那条注释:它不自动记账,是用来认领银行流水的。 */
  price: number | null;
  currency: string | null;
  purchasedAt: string | null;
}

/* ───────────────────────── 投影 / CRUD ───────────────────────── */

const splitList = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

function coerceType(v: unknown): GarmentType {
  return (GARMENT_TYPES as string[]).includes(String(v)) ? (v as GarmentType) : 'top';
}
function coerceWarmth(v: unknown): Warmth {
  const n = Number(v);
  return n === 1 || n === 3 ? (n as Warmth) : 2;
}
function coerceFormality(v: unknown): Formality {
  return (FORMALITIES as string[]).includes(String(v)) ? (v as Formality) : 'casual';
}

export function toGarment(node: LifeNode): Garment {
  const a = node.attributes || {};
  // 本机 asset 优先取 id;云孪生(有 storagePath)单独取出 —— 换端只靠后者。
  const localImg = node.assets?.find((as) => as.kind === 'image' && as.local);
  const cloudImg = node.assets?.find((as) => as.kind === 'image' && as.storagePath);
  const img = localImg || cloudImg || node.assets?.find((as) => as.kind === 'image');
  return {
    node,
    id: node.id,
    name: node.name,
    garmentType: coerceType(a.garmentType),
    warmth: coerceWarmth(a.warmth),
    formality: coerceFormality(a.formality),
    colors: splitList(a.colors),
    material: typeof a.material === 'string' ? a.material : '',
    seasons: splitList(a.seasons),
    hasPhoto: Boolean(img || cloudImg),
    assetId: localImg?.id ?? (img && !img.storagePath ? img.id : null) ?? null,
    storagePath: cloudImg?.storagePath ?? img?.storagePath ?? null,
    lastWornAt: typeof a.lastWornAt === 'string' ? a.lastWornAt : null,
    wearCount: Number(a.wearCount) || 0,
    // 写进去要读得回来 —— 只写不读的字段等于没写
    price: a.price != null && Number.isFinite(Number(a.price)) ? Number(a.price) : null,
    currency: typeof a.currency === 'string' ? a.currency : null,
    purchasedAt: typeof a.purchasedAt === 'string' ? a.purchasedAt : null,
  };
}

/** 衣橱 = 所有 garment 标记的 object 节点。零参,读 life-graph。 */
export function listWardrobe(): Garment[] {
  let nodes: LifeNode[];
  try { nodes = getLifeGraph(); } catch { return []; }
  return nodes
    .filter((n) => n.type === 'Thing' && n.attributes?.garment === true)
    .map(toGarment);
}

export interface NewGarment {
  name: string;
  garmentType: GarmentType;
  warmth: Warmth;
  formality: Formality;
  colors?: string[];
  material?: string;
  seasons?: string[];
  assetId?: string | null;   // 已存进本机图库(putLocalImage)的照片 id
  /** 云 Storage 路径(与记忆照片同构);有则挂云孪生 asset,换端可见。 */
  storagePath?: string | null;
  mimeType?: string;
  /**
   * 买这件花了多少(正数)。**不自动记一笔支出** —— 刷卡买的话 Plaid 已经有那条流水,
   * 再记一笔就是双计。这个字段的用途是让这件衣服能去**认领**银行里的那笔钱
   * (spendableAmount → receiptMatchCandidates),认领之后才有「这件衣服花了多少」。
   */
  price?: number;
  /** 币种。缺省跟随财务主币种,由调用方补。 */
  currency?: string;
  /** 买入日 YYYY-MM-DD。配对要靠它 —— 没有日期就只能靠金额,配错概率大得多。 */
  purchasedAt?: string;
}

/** 建一件衣服(object 节点)。照片由调用方先 putLocalImage,这里只挂 asset 引用。 */
export function addGarment(input: NewGarment): LifeNode {
  const attributes: Record<string, string | number | boolean | null> = {
    garment: true,
    category: WARDROBE_CATEGORY,
    garmentType: input.garmentType,
    warmth: input.warmth,
    formality: input.formality,
    wearCount: 0,
  };
  if (input.colors?.length) attributes.colors = input.colors.map((c) => c.trim()).filter(Boolean).join(',');
  if (input.material?.trim()) attributes.material = input.material.trim();
  if (input.seasons?.length) attributes.seasons = input.seasons.map((s) => s.trim()).filter(Boolean).join(',');
  if (typeof input.price === 'number' && Number.isFinite(input.price) && input.price > 0) {
    attributes.price = Math.round(input.price * 100) / 100;
    if (input.currency) attributes.currency = input.currency;
    if (input.purchasedAt) attributes.purchasedAt = input.purchasedAt;
  }
  const assets: NonNullable<LifeNode['assets']> = [];
  if (input.assetId) {
    assets.push({ id: input.assetId, kind: 'image', local: true, mimeType: input.mimeType || 'image/jpeg' });
  }
  if (input.storagePath) {
    assets.push({
      id: `cloud-${input.assetId || Date.now()}`,
      kind: 'image',
      storagePath: input.storagePath,
      mimeType: input.mimeType || 'image/jpeg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return ingestLifeNode({
    type: 'Thing',
    name: input.name.trim() || '未命名衣物',
    attributes: { ...attributes, epistemic: 'observation', generator: (input.assetId || input.storagePath) ? 'user:photo' : 'user' },
    source: (input.assetId || input.storagePath) ? 'photo' : 'manual',
    confidence: 1,
    relations: [],
    tags: ['收纳', WARDROBE_CATEGORY],
    ...(assets.length ? { assets } : {}),
  });
}

/** 改属性(合并,不整体替换 attributes)。 */
export function updateGarment(id: string, patch: Partial<NewGarment>): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const a: Record<string, string | number | boolean | null> = { ...(node.attributes || {}) };
  if (patch.name) node.name = patch.name.trim();
  if (patch.garmentType) a.garmentType = patch.garmentType;
  if (patch.warmth) a.warmth = patch.warmth;
  if (patch.formality) a.formality = patch.formality;
  if (patch.colors) a.colors = patch.colors.map((c) => c.trim()).filter(Boolean).join(',');
  if (patch.material != null) a.material = patch.material.trim();
  if (patch.seasons) a.seasons = patch.seasons.map((s) => s.trim()).filter(Boolean).join(',');
  return updateLifeNode(id, { attributes: a, ...(patch.name ? { name: patch.name.trim() } : {}) });
}

export function removeGarment(id: string): boolean {
  return deleteLifeNode(id);
}

/** 记一次「今天穿了」→ wearCount+1、lastWornAt=今天(鼓励穿遍全衣橱)。 */
export function markWorn(id: string, todayIso: string): boolean {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return false;
  const a: Record<string, string | number | boolean | null> = { ...(node.attributes || {}) };
  a.wearCount = (Number(a.wearCount) || 0) + 1;
  a.lastWornAt = todayIso.slice(0, 10);
  return updateLifeNode(id, { attributes: a });
}

/* ───────────────────────── 穿搭规则引擎(纯) ───────────────────────── */

export interface OutfitContext {
  repTempC: number | null;   // 代表温度(早晚偏冷用今日最低更稳);null = 未知
  tempMinC: number | null;
  tempMaxC: number | null;
  precipProb: number | null; // 今日降水概率 %
  formalNeed: Formality;     // 由日历推断(inferFormalNeed)
}

export interface OutfitSuggestion {
  pieces: Garment[];
  warmthTarget: Warmth;
  needOuter: boolean;
  formality: Formality;
  needUmbrella: boolean;
  reason: [string, string];
  gaps: GarmentType[];       // 该有却没挑到的类型(衣橱缺口)
  mismatch: [string, string] | null; // 被迫选了不协调的一套(如毛衣配短裤)→ 诚实提示,不装好看
}

/** 今日日历 → 正式度需求。纯正则,不依赖 attention-engine(可测)。 */
const FORMAL_RE = /面试|interview|正式|婚礼|wedding|典礼|ceremony|见客户|client\b|路演|pitch|答辩|defen[cs]e|开庭|court|颁奖|gala/i;
const SMART_RE = /会议|meeting|评审|review|汇报|present|路演|onsite|办公|office|工作|投标|开会|例会|standup|stand-up|1:1|谈判/i;

export function inferFormalNeed(todayEvents: readonly CalendarEvent[]): Formality {
  let best: Formality = 'casual';
  for (const e of todayEvents) {
    const hay = `${e.title || ''} ${e.description || ''} ${e.location || ''}`;
    if (FORMAL_RE.test(hay)) return 'formal';
    if (SMART_RE.test(hay)) best = 'smart';
  }
  return best;
}

/** 温度 → 目标保暖档 + 是否需要外套。 */
export function warmthForTemp(repTempC: number | null): { target: Warmth; needOuter: boolean } {
  if (repTempC == null) return { target: 2, needOuter: false };
  if (repTempC <= 5) return { target: 3, needOuter: true };
  if (repTempC <= 15) return { target: 2, needOuter: true };
  if (repTempC <= 25) return { target: 2, needOuter: false };
  return { target: 1, needOuter: false };
}

const FORMALITY_RANK: Record<Formality, number> = { casual: 0, smart: 1, formal: 2 };

/* ── B｜反馈学习:用户偏好(纯数据,由 lib/portal/wardrobe-prefs 从本地反馈算好后传入) ── */
export interface OutfitPrefs {
  colorLikes: Record<string, number>; // 颜色词 → 净好感(👍+1 / 👎-1,穿了+)
  dislikedItemIds: string[];          // 明确不想再推的单品 id
  dislikedPairs: string[];            // 用户拒绝过的上下装组合,key = pairKey(idA,idB)
}
export const EMPTY_PREFS: OutfitPrefs = { colorLikes: {}, dislikedItemIds: [], dislikedPairs: [] };
export function pairKey(a: string, b: string): string { return [a, b].sort().join('|'); }

/** 偏好对单件的加权(夹在 ±6,别压过协调/保暖)。 */
function prefBias(g: Garment, prefs: OutfitPrefs): number {
  let d = 0;
  for (const c of g.colors) d += (prefs.colorLikes[c] || 0);
  if (prefs.dislikedItemIds.includes(g.id)) d -= 5;
  return Math.max(-6, Math.min(6, d));
}

/** 单件对当日的契合分(越高越合适);含「久没穿」微加权 + 用户偏好。 */
function scoreGarment(g: Garment, target: Warmth, need: Formality, todayMs: number, prefs: OutfitPrefs = EMPTY_PREFS): number {
  const warmthFit = -Math.abs(g.warmth - target) * 3;
  const formalFit = -Math.abs(FORMALITY_RANK[g.formality] - FORMALITY_RANK[need]) * 3;
  // 新鲜度:从没穿过给满(2),否则按闲置天数封顶 2 分
  let freshness = 2;
  if (g.lastWornAt) {
    const days = Math.max(0, (todayMs - Date.parse(g.lastWornAt)) / 86_400_000);
    freshness = Math.min(2, days / 7); // 一周没穿 ≈ 满分
  }
  return warmthFit + formalFit + freshness + prefBias(g, prefs);
}

/**
 * 池里挑第 rotate 好的一件(rotate=0 即最佳)。
 *
 * bug3「推荐逻辑还需要优化」的一半根因:原来永远只取最高分那件,于是「换一套」在
 * 免费档点了没反应 —— 输入没变,确定性算法当然给同一个答案。给一个环形游标,
 * 「换一套」就真的往下换一件,转一圈回到最佳。
 */
function pickBest(pool: Garment[], target: Warmth, need: Formality, todayMs: number, prefs: OutfitPrefs = EMPTY_PREFS, rotate = 0): Garment | null {
  if (pool.length === 0) return null;
  const ranked = pool
    .map((g) => ({ g, s: scoreGarment(g, target, need, todayMs, prefs) }))
    .sort((a, b) => b.s - a.s);
  return ranked[((rotate % ranked.length) + ranked.length) % ranked.length].g;
}

/* ── 审美/协调:季节 · 色彩 · 上下装联合评分(避免「毛衣配短裤」这类乱搭) ── */

type Season = 'warm' | 'mid' | 'cool';
// 名字里的季节信号优先(比保暖档数字更可靠 —— 毛衣就是凉季、短裤就是热季)
const COOL_RE = /毛衣|针织|卫衣|大衣|风衣|羽绒|棉服|夹克|长袖|高领|turtleneck|sweater|knit|coat|hoodie|fleece|down|cardigan|wool/i;
const WARM_RE = /短裤|背心|吊带|短袖|t恤|tee|shorts|tank|sleeveless|凉鞋|sandal|linen|亚麻/i;
function garmentSeason(g: Garment): Season {
  if (WARM_RE.test(g.name)) return 'warm';
  if (COOL_RE.test(g.name)) return 'cool';
  return g.warmth === 1 ? 'warm' : g.warmth === 3 ? 'cool' : 'mid';
}
function seasonConflict(a: Garment, b: Garment): boolean {
  const x = garmentSeason(a), y = garmentSeason(b);
  return (x === 'warm' && y === 'cool') || (x === 'cool' && y === 'warm');
}
// 中性色百搭(含牛仔);两件都是彩色且不同 → 可能撞色
const NEUTRAL_RE = /黑|白|灰|米|卡其|藏青|驼|裸|棕|米白|牛仔|black|white|gray|grey|beige|navy|khaki|cream|tan|denim|brown/i;
function isNeutral(g: Garment): boolean { return g.colors.length === 0 || g.colors.every((c) => NEUTRAL_RE.test(c)); }
function colorHarmony(a: Garment, b: Garment): number {
  if (isNeutral(a) || isNeutral(b)) return 1;                     // 至少一件中性 → 百搭
  if (a.colors.some((c) => b.colors.includes(c))) return 0.5;    // 同色系呼应
  return -1;                                                      // 两件彩色且不同 → 扣分
}

/** 上装×下装是否明显不协调(季节冲突 or 保暖档差 ≥2)。 */
function incoherent(top: Garment, bottom: Garment): boolean {
  return seasonConflict(top, bottom) || Math.abs(top.warmth - bottom.warmth) >= 2;
}
function incoherenceNote(top: Garment, bottom: Garment): [string, string] {
  return [
    `手头「${top.name}」配「${bottom.name}」季节不太搭 —— 补一件更配的,整套会更协调。`,
    `“${top.name}” with “${bottom.name}” mixes seasons — add a better match for a more coherent look.`,
  ];
}

/** 上下装一对的联合分:各自契合 + 保暖协调 + 季节一致 + 正式度一致 + 色彩和谐 + 用户偏好。 */
function pairScore(top: Garment, bottom: Garment, target: Warmth, need: Formality, todayMs: number, prefs: OutfitPrefs = EMPTY_PREFS): number {
  let s = scoreGarment(top, target, need, todayMs, prefs) + scoreGarment(bottom, target, need, todayMs, prefs);
  if (Math.abs(top.warmth - bottom.warmth) >= 2) s -= 6;         // 保暖档差太多(厚配薄)
  if (seasonConflict(top, bottom)) s -= 8;                       // 季节冲突(毛衣配短裤)
  if (Math.abs(FORMALITY_RANK[top.formality] - FORMALITY_RANK[bottom.formality]) >= 2) s -= 4; // 正式度撕裂
  s += colorHarmony(top, bottom) * 2;                           // 色彩和谐
  if (prefs.dislikedPairs.includes(pairKey(top.id, bottom.id))) s -= 10; // 用户拒绝过这对
  return s;
}

/**
 * 每日穿搭(纯规则)。按天气定保暖档+是否外套、按日历定正式度,从衣橱各类挑最合适一件组一套。
 * 衣橱为空/太少 → pieces 为空(由 outfitFindings 决定是否出引导卡)。
 */
/** suggestOutfit 的可选项(bug3「推荐逻辑还需要优化」)。 */
export interface OutfitOptions {
  /** 「换一套」的环形游标:每点一次 +1,依次给次好的组合,转一圈回到最佳。 */
  rotate?: number;
  /**
   * 明确避开的组合 key(outfitKey 口径)—— 用户淘汰过的那几组。
   * 以前淘汰只在展示层「命中了才提示一句」,算法照样推;现在从候选里真的剔掉。
   */
  avoidKeys?: readonly string[];
}

export function suggestOutfit(
  wardrobe: readonly Garment[],
  ctx: OutfitContext,
  todayIso: string,
  prefs: OutfitPrefs = EMPTY_PREFS,
  opts: OutfitOptions = {},
): OutfitSuggestion {
  const rotate = Math.max(0, Math.trunc(opts.rotate ?? 0));
  const avoid = new Set(opts.avoidKeys ?? []);
  // 组合 key:与 wardrobe-outfits 的 outfitKey 同口径(id 排序后拼),避免跨文件依赖。
  const comboKey = (ids: readonly string[]) => [...ids].sort().join('|');
  const { target, needOuter } = warmthForTemp(ctx.repTempC);
  const need = ctx.formalNeed;
  const todayMs = Date.parse(todayIso) || 0;
  // 非穿戴物兜底过滤(QA:「摇椅盖毯」被视觉模型硬归成外套,AI 造型把毯子当衣服推荐)
  const NON_WEARABLE_RE = /毯|被子|抱枕|枕头|窗帘|地垫|地毯|坐垫|毛巾|blanket|throw|pillow|cushion|curtain|rug|towel/i;
  const byType = (t: GarmentType) => wardrobe.filter((g) => g.garmentType === t && !NON_WEARABLE_RE.test(g.name));

  const pieces: Garment[] = [];
  const gaps: GarmentType[] = [];
  const want = (present: boolean, type: GarmentType) => { if (!present) gaps.push(type); };
  let mismatch: [string, string] | null = null;

  // 主体:上装×下装挑**最协调的一对**(联合评分:保暖/季节/正式度/色彩 + 用户偏好),避免「毛衣配短裤」;
  // 两者不全但有连衣裙 → 连衣裙(本身自洽)。手头只有乱搭的一对时仍给出,但诚实标注 mismatch。
  const tops = byType('top');
  const bottoms = byType('bottom');
  const dress = pickBest(byType('dress'), target, need, todayMs, prefs, rotate);
  if (tops.length && bottoms.length) {
    // 所有上×下组合按联合分排序,剔掉淘汰过的,再按 rotate 取第几好的一对。
    // (原来只取最高分那一对 → 淘汰了也照推、点「换一套」也不动。)
    const pairs: Array<{ top: Garment; bottom: Garment; s: number }> = [];
    for (const tp of tops) for (const bt of bottoms) {
      if (avoid.has(comboKey([tp.id, bt.id]))) continue;
      pairs.push({ top: tp, bottom: bt, s: pairScore(tp, bt, target, need, todayMs, prefs) });
    }
    pairs.sort((a, b) => b.s - a.s);
    // 全被淘汰过 → 不硬留空(空搭配比重复搭配更没用),退回不过滤那一版
    const pool = pairs.length ? pairs : (() => {
      const all: Array<{ top: Garment; bottom: Garment; s: number }> = [];
      for (const tp of tops) for (const bt of bottoms) all.push({ top: tp, bottom: bt, s: pairScore(tp, bt, target, need, todayMs, prefs) });
      return all.sort((a, b) => b.s - a.s);
    })();
    const best = pool[rotate % pool.length];
    if (best) {
      pieces.push(best.top, best.bottom);
      if (incoherent(best.top, best.bottom)) mismatch = incoherenceNote(best.top, best.bottom);
    }
  } else if (dress) {
    pieces.push(dress);
  } else {
    const top = pickBest(tops, target, need, todayMs, prefs, rotate);
    const bottom = pickBest(bottoms, target, need, todayMs, prefs, rotate);
    if (top) pieces.push(top); else want(false, 'top');
    if (bottom) pieces.push(bottom); else want(false, 'bottom');
  }

  // 外套(冷时)
  if (needOuter) {
    const outer = pickBest(byType('outer'), target, need, todayMs, prefs, rotate);
    if (outer) pieces.push(outer); else want(false, 'outer');
  }
  // 鞋
  const shoes = pickBest(byType('shoes'), target, need, todayMs, EMPTY_PREFS, rotate);
  if (shoes) pieces.push(shoes); else want(false, 'shoes');
  // 配饰(有就加一件,可选,不计缺口)
  const accessory = pickBest(byType('accessory'), target, need, todayMs, EMPTY_PREFS, rotate);
  if (accessory) pieces.push(accessory);

  const needUmbrella = ctx.precipProb != null && ctx.precipProb >= 50;

  return {
    pieces,
    warmthTarget: target,
    needOuter,
    formality: need,
    needUmbrella,
    reason: buildReason(ctx, target, needOuter, need, needUmbrella),
    gaps,
    mismatch,
  };
}

function tempLabel(ctx: OutfitContext): string {
  if (ctx.tempMinC != null && ctx.tempMaxC != null) return `${Math.round(ctx.tempMinC)}–${Math.round(ctx.tempMaxC)}°C`;
  if (ctx.repTempC != null) return `${Math.round(ctx.repTempC)}°C`;
  return '';
}

function buildReason(ctx: OutfitContext, target: Warmth, needOuter: boolean, need: Formality, umbrella: boolean): [string, string] {
  const tl = tempLabel(ctx);
  const zhTemp = tl ? `今天 ${tl}` : '今天';
  const enTemp = tl ? `${tl} today` : 'Today';
  let zhWarm: string, enWarm: string;
  if (target === 3) { zhWarm = '天冷,加了保暖外套'; enWarm = 'chilly — bundled up with a warm layer'; }
  else if (needOuter) { zhWarm = '偏凉,配了外套'; enWarm = 'cool — added a jacket'; }
  else if (target === 1) { zhWarm = '偏热,穿得清爽'; enWarm = 'warm — kept it light'; }
  else { zhWarm = '温度舒适'; enWarm = 'comfortable'; }
  const zhFormal = need === 'formal' ? ',有正式场合,选了正式款' : need === 'smart' ? ',配了通勤款' : '';
  const enFormal = need === 'formal' ? ', formal occasion — dressed up' : need === 'smart' ? ', work-ready look' : '';
  const zhUmb = umbrella ? ' 降水概率高,记得带伞。' : '';
  const enUmb = umbrella ? ' High chance of rain — take an umbrella.' : '';
  return [`${zhTemp},${zhWarm}${zhFormal}。${zhUmb}`.trim(), `${enTemp}: ${enWarm}${enFormal}.${enUmb}`.trim()];
}

/* ───────────────────────── Today 域接入(domain_insight) ───────────────────────── */

import type { DomainInsightItem } from '@/lib/platform/guidance-engine/types';

const GARMENT_LABEL: Record<GarmentType, [string, string]> = {
  top: ['上装', 'top'], bottom: ['下装', 'bottoms'], outer: ['外套', 'jacket'],
  dress: ['连衣裙', 'dress'], shoes: ['鞋', 'shoes'], accessory: ['配饰', 'accessory'],
};

/**
 * 衣橱 → 今天页穿搭建议(最多一条 domain_insight)。
 * 衣橱太少(<2 件)→ 引导「拍几件衣服」;能搭 → 「今天穿这套」。
 * id 带日期,每天一条新实例(过期由管线处理)。
 */
export function outfitFindings(
  wardrobe: readonly Garment[],
  ctx: OutfitContext,
  todayIso: string,
): DomainInsightItem[] {
  const day = todayIso.slice(0, 10);
  if (wardrobe.length < 2) {
    // 有一件也不足以搭 —— 轻引导,不制造压力
    if (wardrobe.length === 0) return [];
    return [{
      id: `seed-${day}`,
      severity: 'attention',
      title: ['把衣橱拍全,我来帮你搭', 'Photograph your wardrobe, I’ll style it'],
      body: ['多拍几件衣服进衣橱,之后每天按天气和日程帮你配一套。', 'Add a few more clothes; then I’ll suggest a daily outfit by weather and schedule.'],
      cta: ['打开衣橱加衣服', 'Open wardrobe'],
    }];
  }
  const s = suggestOutfit(wardrobe, ctx, todayIso);
  if (s.pieces.length === 0) {
    const miss = s.gaps.map((g) => GARMENT_LABEL[g][0]).join('、');
    return [{
      id: `gap-${day}`,
      severity: 'attention',
      title: ['衣橱还差点,先补几件', 'A few pieces missing'],
      body: [`按今天的天气,衣橱里还缺${miss || '合适的搭配'}。补齐后就能自动搭一套。`, 'Your wardrobe is missing a few basics for today’s weather. Add them to get full outfits.'],
      cta: ['打开衣橱', 'Open wardrobe'],
    }];
  }
  const names = s.pieces.map((p) => p.name).slice(0, 4).join(' · ');
  const zhTail = s.mismatch ? `\n⚠ ${s.mismatch[0]}` : '';
  const enTail = s.mismatch ? `\n⚠ ${s.mismatch[1]}` : '';
  return [{
    id: `outfit-${day}`,
    severity: 'attention',
    title: [`今天穿这套 · ${s.pieces.length} 件`, `Today’s outfit · ${s.pieces.length} pieces`],
    body: [`${s.reason[0]}\n${names}${zhTail}`, `${s.reason[1]}\n${names}${enTail}`],
    cta: ['打开衣橱看搭配', 'See the outfit'],
  }];
}
