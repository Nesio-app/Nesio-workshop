/**
 * Front-stage Domain taxonomy (Domain-Capability PRD v1 §4.1 / §5).
 *
 * The 5 domains the USER understands ("which part of my life is this?"). These
 * are NOT the engineering capability ids in lib/intelligence/* (weather/work/
 * health…) — those are Capabilities. A Domain is the front-stage life scene; a
 * Capability is a reusable system ability; a Module is an engineering boundary.
 *
 * Old modules salvage into these 5 domains (§8.2). moduleId is kept as the
 * engineering governance boundary, but never shown as a front-stage structure.
 */

// 2026-08-01 用户点名:「growth/assets 命名不准确」——旧的 5 桶把「工作」和「学习」硬塞进
// growth 一个桶、把「钱」和「物品收纳」硬塞进 assets 一个桶,分类结果自然模糊。拆成 7 桶:
// work(工作,新拆出)、finance(财务,原 assets 收窄到只管钱)、life(生活,收纳/物品并入这里)、
// learn(成长,原 growth 收窄到只管学习/阅读/反思)、relationship(关系,从 life 拆出人物向内容)、
// health/energy 不变。旧值(growth/assets)已从这个类型里移除——这是 breaking rename,不是新增。
export type FrontDomain = 'life' | 'work' | 'finance' | 'health' | 'energy' | 'learn' | 'relationship';

export interface DomainMeta {
  id: FrontDomain;
  label: string;        // user-facing zh label
  labelEn: string;      // user-facing en label(zh label 仍是 domainFromLabel 的映射键,不动)
  icon: string;
  /** Real data / sensitive explanations gated until consent + governance. */
  gated: boolean;
  /** Old moduleIds that salvage into this domain (§8.2). */
  salvages: string[];
  /** Short scope hint for routing/extraction. */
  scope: string;
}

export const DOMAINS: Record<FrontDomain, DomainMeta> = {
  life: {
    id: 'life', label: '生活', labelEn: 'Life', icon: '🏡', gated: false,
    salvages: ['inventory'],
    scope: '物品、收纳、旅行、日常事件、美食、穿搭、家务、愿望、足迹、饭店、剧场',
  },
  work: {
    id: 'work', label: '工作', labelEn: 'Work', icon: '💼', gated: false,
    salvages: ['plan'],
    scope: '会议、任务、项目、deadline、日程安排、产出节奏',
  },
  finance: {
    id: 'finance', label: '财务', labelEn: 'Finance', icon: '💰', gated: false,
    salvages: ['finance'],
    scope: '收入、支出、账单、订阅、投资、发票、资产、税金',
  },
  health: {
    id: 'health', label: '健康', labelEn: 'Health', icon: '🩷', gated: true,
    salvages: ['fitness', 'health'],
    scope: '身体、健身、睡眠、饮食、医疗/健康记录、身体状态',
  },
  energy: {
    id: 'energy', label: '能量', labelEn: 'Energy', icon: '🧘', gated: true,
    salvages: ['sanctuary', 'psychoanalysis', 'lifesim'],
    scope: '情绪、心理、冥想、内在家园、灵性、恢复、心智状态',
  },
  learn: {
    id: 'learn', label: '成长', labelEn: 'Learn', icon: '📈', gated: false,
    salvages: ['reading', 'quiz'],
    scope: '学习、阅读、知识、学业、复盘反思、镜子内容',
  },
  relationship: {
    id: 'relationship', label: '关系', labelEn: 'Relationship', icon: '👪', gated: false,
    salvages: [],
    scope: '亲友、家人、生日、礼物、聚餐、约会、社交往来',
  },
};

export const ALL_DOMAINS: DomainMeta[] = Object.values(DOMAINS);

export function domainLabel(id: FrontDomain): string {
  return DOMAINS[id]?.label ?? id;
}

export function isFrontDomain(value: string): value is FrontDomain {
  return value in DOMAINS;
}

/** Map a zh label back to a domain id (extractor / AI output may emit labels). */
export function domainFromLabel(label: string): FrontDomain | null {
  const hit = ALL_DOMAINS.find((d) => d.label === label.trim());
  return hit ? hit.id : null;
}
