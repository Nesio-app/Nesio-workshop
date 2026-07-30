/**
 * 跨区主动投递编排(cross-region-reasoning.md P2)——把检出的跨区/先后洞察经门控
 * (同意 + 新鲜度去重 + 可打断性 + 预算)变成 Today 的 domain_insight 候选。
 * 软频控/预算细排/时段门复用既有 guidance 七层管线(经 crossRegionToGuidanceEvents)。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { ensureFactJournal, readFactJournal } from '@/lib/platform/fact-journal';
import { detectCrossRegion, detectLeadLag, DETECT_DEFAULTS } from './detect-core.mjs';
import { gateDeliverables } from './deliver-core.mjs';
import { CROSS_REGION_COLUMNS, columnLabel } from './detect';
import { getConsentedDomains } from './consent';
import { rankCrossRegionByBandit } from './bandit';
import { currentAcceptProbability } from '@/lib/platform/interruptibility';
import type { DomainInsightItem } from '@/lib/platform/guidance-engine/types';

const COOLDOWN_KEY = 'nesio-cross-region-delivery-cooldown-v1';
type CooldownLog = Record<string, { at: string; bucket: string }>;

const cooldownBlob = createBlobStore<CooldownLog>({
  key: COOLDOWN_KEY,
  updateEvent: `${COOLDOWN_KEY}-updated`,
  validate: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function loadCooldown(): CooldownLog {
  const v = cooldownBlob.load();
  return v && typeof v === 'object' ? v : {};
}

interface RawRel {
  kind: 'corr' | 'cooccur' | 'leadlag';
  a: string; b: string; domainA: string; domainB: string;
  strength: number; lag?: number; leader?: string; follower?: string;
}

function relId(r: RawRel): string {
  const [k1, k2] = [r.a, r.b].sort();
  return `${k1}~${k2}~${r.kind}`;
}

function phrase(r: RawRel, zh: boolean): { title: [string, string]; body: [string, string]; cta: [string, string] } {
  const la = columnLabel(r.a, true);
  const lb = columnLabel(r.b, true);
  const laE = columnLabel(r.a, false);
  const lbE = columnLabel(r.b, false);
  const pos = r.strength >= 0;
  if (r.kind === 'leadlag') {
    const lead = columnLabel(r.leader || r.a, true);
    const foll = columnLabel(r.follower || r.b, true);
    const leadE = columnLabel(r.leader || r.a, false);
    const follE = columnLabel(r.follower || r.b, false);
    return {
      title: [`${lead} 变化后约 ${r.lag} 天,${foll} 常跟着变`, `${follE} tends to follow ${leadE} by ~${r.lag}d`],
      body: [`数据里 ${lead} 领先 ${foll} 约 ${r.lag} 天(${pos ? '同向' : '反向'})。先后线索,不是因果。`,
        `${leadE} leads ${follE} by ~${r.lag}d (${pos ? 'same' : 'opposite'} direction). A lead-lag hint, not causation.`],
      cta: ['去洞察页看这条先后线索', 'See this lead-lag hint in Insights'],
    };
  }
  return {
    title: [`${la} 与 ${lb} ${pos ? '正' : '负'}相关`, `${laE} and ${lbE} are ${pos ? 'positively' : 'negatively'} correlated`],
    body: [`最近这段时间 ${la} 与 ${lb} ${pos ? '同向' : '反向'}变动。相关不代表因果,只是值得留意。`,
      `${laE} and ${lbE} have moved ${pos ? 'together' : 'oppositely'} lately. Correlation is not causation — just worth noting.`],
    cta: ['去洞察页看这条关联', 'See this link in Insights'],
  };
}

/**
 * 产出可主动投递的跨区洞察(DomainInsightItem[])。已过同意 + 新鲜度 + 可打断性 + 预算门;
 * 并把存活项记入冷却日志(14 天去重)。交 crossRegionToGuidanceEvents 进 Today 七层管线。
 */
export function buildCrossRegionDeliverables(now: Date = new Date()): DomainInsightItem[] {
  if (typeof window === 'undefined') return [];
  ensureFactJournal(90);
  const rows = readFactJournal(400);
  if (rows.length < DETECT_DEFAULTS.minN) return [];

  const corr = detectCrossRegion(rows, CROSS_REGION_COLUMNS) as RawRel[];
  const leadlag = detectLeadLag(rows, CROSS_REGION_COLUMNS) as RawRel[];
  const rels = [...corr, ...leadlag].map((r) => ({ ...r, id: relId(r) }));
  if (rels.length === 0) return [];

  const survivors = gateDeliverables(rels, {
    consentedDomains: getConsentedDomains(),
    cooldownLog: loadCooldown(),
    now,
    acceptProb: currentAcceptProbability(now),
    // P3:LinUCB bandit 排序(学「你在乎哪类跨区」);冷启动=按强度(不更差)
    rankFn: (filtered: RawRel[]) => rankCrossRegionByBandit(filtered as never, now) as never,
  }) as Array<RawRel & { id: string; cooldownBucket: string }>;

  if (survivors.length === 0) return [];

  // 记冷却(存活即视为将展示,记账 14 天去重;强度桶变化可提前重出)
  const log = loadCooldown();
  const iso = now.toISOString();
  for (const s of survivors) log[s.id] = { at: iso, bucket: s.cooldownBucket };
  cooldownBlob.save(log);

  return survivors.map((r) => {
    const p = phrase(r, true);
    return { id: r.id, severity: 'attention' as const, title: p.title, body: p.body, cta: p.cta };
  });
}
