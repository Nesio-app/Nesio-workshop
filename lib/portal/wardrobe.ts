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

import { addLifeNode, deleteLifeNode, getLifeGraph, updateLifeNode, type LifeNode } from './life-graph';
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
  assetId: string | null; // 首张图 assetId(缩略图用 getLocalImage 读)
  lastWornAt: string | null;
  wearCount: number;
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
  const img = node.assets?.find((as) => as.kind === 'image');
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
    hasPhoto: Boolean(img),
    assetId: img?.id ?? null,
    lastWornAt: typeof a.lastWornAt === 'string' ? a.lastWornAt : null,
    wearCount: Number(a.wearCount) || 0,
  };
}

/** 衣橱 = 所有 garment 标记的 object 节点。零参,读 life-graph。 */
export function listWardrobe(): Garment[] {
  let nodes: LifeNode[];
  try { nodes = getLifeGraph(); } catch { return []; }
  return nodes
    .filter((n) => n.type === 'object' && n.attributes?.garment === true)
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
  mimeType?: string;
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
  const assets = input.assetId
    ? [{ id: input.assetId, kind: 'image' as const, local: true, mimeType: input.mimeType || 'image/jpeg' }]
    : undefined;
  return addLifeNode({
    type: 'object',
    name: input.name.trim() || '未命名衣物',
    attributes,
    source: input.assetId ? 'photo' : 'manual',
    confidence: 1,
    relations: [],
    tags: ['收纳', WARDROBE_CATEGORY],
    ...(assets ? { assets } : {}),
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

/** 单件对当日的契合分(越高越合适);含「久没穿」微加权,鼓励穿遍全衣橱。 */
function scoreGarment(g: Garment, target: Warmth, need: Formality, todayMs: number): number {
  const warmthFit = -Math.abs(g.warmth - target) * 3;
  const formalFit = -Math.abs(FORMALITY_RANK[g.formality] - FORMALITY_RANK[need]) * 3;
  // 新鲜度:从没穿过给满(2),否则按闲置天数封顶 2 分
  let freshness = 2;
  if (g.lastWornAt) {
    const days = Math.max(0, (todayMs - Date.parse(g.lastWornAt)) / 86_400_000);
    freshness = Math.min(2, days / 7); // 一周没穿 ≈ 满分
  }
  return warmthFit + formalFit + freshness;
}

function pickBest(pool: Garment[], target: Warmth, need: Formality, todayMs: number): Garment | null {
  if (pool.length === 0) return null;
  return pool
    .map((g) => ({ g, s: scoreGarment(g, target, need, todayMs) }))
    .sort((a, b) => b.s - a.s)[0].g;
}

/**
 * 每日穿搭(纯规则)。按天气定保暖档+是否外套、按日历定正式度,从衣橱各类挑最合适一件组一套。
 * 衣橱为空/太少 → pieces 为空(由 outfitFindings 决定是否出引导卡)。
 */
export function suggestOutfit(
  wardrobe: readonly Garment[],
  ctx: OutfitContext,
  todayIso: string,
): OutfitSuggestion {
  const { target, needOuter } = warmthForTemp(ctx.repTempC);
  const need = ctx.formalNeed;
  const todayMs = Date.parse(todayIso) || 0;
  const byType = (t: GarmentType) => wardrobe.filter((g) => g.garmentType === t);

  const pieces: Garment[] = [];
  const gaps: GarmentType[] = [];
  const want = (present: boolean, type: GarmentType) => { if (!present) gaps.push(type); };

  // 主体:优先上装+下装;两者不全但有连衣裙 → 连衣裙
  const top = pickBest(byType('top'), target, need, todayMs);
  const bottom = pickBest(byType('bottom'), target, need, todayMs);
  const dress = pickBest(byType('dress'), target, need, todayMs);
  if (top && bottom) {
    pieces.push(top, bottom);
  } else if (dress) {
    pieces.push(dress);
  } else {
    if (top) pieces.push(top); else want(false, 'top');
    if (bottom) pieces.push(bottom); else want(false, 'bottom');
  }

  // 外套(冷时)
  if (needOuter) {
    const outer = pickBest(byType('outer'), target, need, todayMs);
    if (outer) pieces.push(outer); else want(false, 'outer');
  }
  // 鞋
  const shoes = pickBest(byType('shoes'), target, need, todayMs);
  if (shoes) pieces.push(shoes); else want(false, 'shoes');
  // 配饰(有就加一件,可选,不计缺口)
  const accessory = pickBest(byType('accessory'), target, need, todayMs);
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

import type { DomainInsightItem } from '@/lib/platform/guidance-engine/source-adapters';

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
  return [{
    id: `outfit-${day}`,
    severity: 'attention',
    title: [`今天穿这套 · ${s.pieces.length} 件`, `Today’s outfit · ${s.pieces.length} pieces`],
    body: [`${s.reason[0]}\n${names}`, `${s.reason[1]}\n${names}`],
    cta: ['打开衣橱看搭配', 'See the outfit'],
  }];
}
