/**
 * 生命版图 · 领土条(v1 §2:洞察页唯一保留的「图」)。
 *
 * 五领域(关系/事业/成长/健康/自我)按**意义密度**(不是数量)切分领土宽度,
 * 并算出「最大迁移」——近 60 天相对前 60 天占比涨得最多的那一域。
 * 纯函数、无 DOM、无 d3、无 AI —— 与 LifeCivilizationMap 的域判定同源,可单测。
 * 门槛(≥21 天 / ≥6 条真实记录)由调用方(InsightsSheet)把守,这里只做数学。
 */

import type { LifeNode, LifeNodeType } from '@/lib/portal/life-graph';

export type TerritoryDomainId = 'relations' | 'work' | 'growth' | 'health' | 'self';

export interface TerritoryDomain {
  id: TerritoryDomainId;
  label: string;
  labelEn: string;
  cssVar: string; // 设计 token(禁止硬编码色值)
}

// 顺序 = 设计稿领土条从左到右的语义顺序(关系/事业/成长/健康/自我)。
export const TERRITORY_DOMAINS: TerritoryDomain[] = [
  { id: 'relations', label: '关系', labelEn: 'Ties',   cssVar: '--portal-accent' },
  { id: 'work',      label: '事业', labelEn: 'Work',   cssVar: '--status-gentle' },
  { id: 'growth',    label: '成长', labelEn: 'Growth', cssVar: '--status-calm' },
  { id: 'health',    label: '健康', labelEn: 'Health', cssVar: '--status-go' },
  { id: 'self',      label: '自我', labelEn: 'Self',   cssVar: '--portal-cool-accent' },
];

const TYPE_TO_DOMAIN: Record<LifeNodeType, TerritoryDomainId> = {
  person:       'relations',
  event:        'self',
  commitment:   'work',
  health_state: 'health',
  preference:   'self',
  place:        'growth',
  object:       'self',
  note:         'growth',
};

const TAG_KEYWORDS: Record<TerritoryDomainId, string[]> = {
  relations: ['朋友', 'friend', '家人', 'family', '爱', '关系', '社交', '恋爱'],
  work:      ['工作', 'work', '项目', 'project', '目标', 'goal', '事业', '职场', '创业'],
  growth:    ['学习', 'learn', '成长', 'grow', '书', 'book', '技能', '知识', '课程'],
  health:    ['健康', 'health', '睡眠', 'sleep', '运动', '身体', '情绪', '疲惫', '医'],
  self:      ['自我', '反思', 'reflect', '感受', '内心', '旅行', '探索', '创作', '梦想'],
};

/** 域判定:标签/正文关键词优先,再回落节点类型。与 LifeCivilizationMap 同源。 */
export function detectTerritoryDomain(node: LifeNode): TerritoryDomainId {
  const searchText = [node.name, node.rawInput ?? '', ...(node.tags ?? [])]
    .join(' ')
    .toLowerCase();
  for (const [id, kws] of Object.entries(TAG_KEYWORDS) as [TerritoryDomainId, string[]][]) {
    if (kws.some((kw) => searchText.includes(kw))) return id;
  }
  return TYPE_TO_DOMAIN[node.type] ?? 'self';
}

/** 意义密度(非数量):置信度 + 关联数 + 标签数 + 是否带附件,封顶 1。 */
export function territoryMeaningScore(node: LifeNode): number {
  const base = node.confidence ?? 0.5;
  const conn = Math.min((node.relations?.length ?? 0) * 0.12, 0.35);
  const tags = Math.min((node.tags?.length ?? 0) * 0.08, 0.25);
  const asset = (node.assets?.length ?? 0) > 0 ? 0.15 : 0;
  return Math.min(base + conn + tags + asset, 1.0);
}

export interface TerritorySlice {
  id: TerritoryDomainId;
  label: string;
  labelEn: string;
  cssVar: string;
  pct: number; // 0–100 整数,合计 100(最后一片吸收舍入误差)
}

export interface TerritoryResult {
  slices: TerritorySlice[]; // 按占比降序,pct=0 的域已剔除
  shift: { id: TerritoryDomainId; label: string; labelEn: string } | null; // 最大迁移(域占比涨最多)
}

const DAY_MS = 86_400_000;

/**
 * 从真实节点算出领土分布 + 最大迁移。
 * @param now 参照「现在」(默认 Date.now,便于测试注入)
 * @param windowDays 迁移对比窗口(默认近 60 天 vs 前 60 天)
 */
export function computeTerritory(
  nodes: LifeNode[],
  now: number = Date.now(),
  windowDays = 60,
): TerritoryResult {
  const totals: Record<TerritoryDomainId, number> = {
    relations: 0, work: 0, growth: 0, health: 0, self: 0,
  };
  const recent: Record<TerritoryDomainId, number> = { ...totals };
  const prior: Record<TerritoryDomainId, number> = { ...totals };
  const win = windowDays * DAY_MS;

  for (const node of nodes) {
    const domain = detectTerritoryDomain(node);
    const score = territoryMeaningScore(node);
    totals[domain] += score;
    const age = now - new Date(node.createdAt).getTime();
    if (age >= 0 && age < win) recent[domain] += score;
    else if (age >= win && age < win * 2) prior[domain] += score;
  }

  const grand = TERRITORY_DOMAINS.reduce((s, d) => s + totals[d.id], 0);

  // 占比(整数,合计 100)——降序,零占比剔除。
  let slices: TerritorySlice[] = [];
  if (grand > 0) {
    slices = TERRITORY_DOMAINS
      .map((d) => ({
        id: d.id, label: d.label, labelEn: d.labelEn, cssVar: d.cssVar,
        pct: Math.round((totals[d.id] / grand) * 100),
      }))
      .filter((s) => s.pct > 0)
      .sort((a, b) => b.pct - a.pct);
    // 舍入回填:让合计恰为 100(把差额记到占比最大的一片)。
    const sum = slices.reduce((s, x) => s + x.pct, 0);
    if (slices.length && sum !== 100) slices[0].pct += 100 - sum;
  }

  // 最大迁移:近窗占比 − 前窗占比,取涨幅最大且显著(≥6 个百分点)的域。
  const recentTotal = TERRITORY_DOMAINS.reduce((s, d) => s + recent[d.id], 0);
  const priorTotal = TERRITORY_DOMAINS.reduce((s, d) => s + prior[d.id], 0);
  let shift: TerritoryResult['shift'] = null;
  if (recentTotal > 0 && priorTotal > 0) {
    let best = 0.06; // 6 个百分点门槛,低于此不谈「迁移」
    for (const d of TERRITORY_DOMAINS) {
      const delta = recent[d.id] / recentTotal - prior[d.id] / priorTotal;
      if (delta > best) {
        best = delta;
        shift = { id: d.id, label: d.label, labelEn: d.labelEn };
      }
    }
  }

  return { slices, shift };
}
