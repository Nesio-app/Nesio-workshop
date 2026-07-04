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

export type FrontDomain = 'life' | 'growth' | 'assets' | 'health' | 'energy';

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
    salvages: [],
    scope: '亲友、家庭、旅行、日常事件、关系照护、礼物、生日',
  },
  growth: {
    id: 'growth', label: '成长', labelEn: 'Growth', icon: '📈', gated: false,
    salvages: ['plan', 'reading', 'quiz'],
    scope: '工作、学习、任务、项目、阅读、知识、会议、产出节奏',
  },
  assets: {
    id: 'assets', label: '财物', labelEn: 'Assets', icon: '📦', gated: false,
    salvages: ['inventory', 'finance'],
    scope: '物品、收纳、购买记忆、账单、资产、预算、订阅',
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
