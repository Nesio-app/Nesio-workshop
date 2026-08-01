/**
 * Living Model — 2026-07-27 退役(认知双轨 Kill)。
 * 保留 summarizeForLivingModel 供 MirrorLetterTab 作证据摘要辅助;
 * LS / nesio-lm-feedback:* / Lab UI / API 生成路径已停用。
 * 主认知面 = 多面镜月度信(MirrorLetterTab)。
 *
 * (历史) AI's world model of the user, structured as 7 cognitive layers.
 */

import type { LifeNode } from '@/lib/portal/life-graph';
import type { MirrorProfile } from '@/lib/portal/mirror-profile';
import { countByDomain } from '@/lib/portal/domain-stats';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { buildEvidenceLenses, type EvidenceLens } from '@/lib/portal/mirror-evidence';

export type LivingModelLayerId =
  | 'identity'     // 身份认同 — 价值观、方向感、决策风格（慢变，6-12个月）
  | 'motivation'   // 驱动力   — 行为背后的动机（行为推断，非MBTI）
  | 'principles'   // 原则     — 长期行为模式推导出的价值倾向
  | 'patterns'     // 模式     — 情绪/状态与行为的触发关系
  | 'blind_spots'  // 盲区     — 只在 confidence >= 90 时展示
  | 'evolution'    // 演化     — 3个月前→现在的变化 delta
  | 'prediction';  // 预测     — 未来聚焦方向、风险、机会（附 confidence + reason）

export interface LivingModelInsight {
  id: string;
  content: string;
  confidence: number;       // 0–100
  evidenceRefs: string[];   // 具体行为证据描述（供用户理解和校验）
  evidenceCount: number;
  lastUpdatedAt: string;
  userVerified: boolean | null;  // null=未审阅, true=确认, false=否定
}

export interface LivingModelLayer {
  id: LivingModelLayerId;
  label: string;
  icon: string;
  insights: LivingModelInsight[];
  minConfidenceToShow: number;
}

export interface LivingModel {
  layers: LivingModelLayer[];
  generatedAt: string;
  nodeCountAtGen: number;
}

// ── Layer definitions ─────────────────────────────────────────────────────────

export const LAYER_META: Record<LivingModelLayerId, { label: string; labelEn: string; icon: string; minConfidence: number }> = {
  identity:    { label: '身份认同', labelEn: 'Identity',    icon: '🪞', minConfidence: 65 },
  motivation:  { label: '驱动力',   labelEn: 'Drive',       icon: '⚡', minConfidence: 65 },
  principles:  { label: '原则',     labelEn: 'Principles',  icon: '⚖️', minConfidence: 70 },
  patterns:    { label: '模式',     labelEn: 'Patterns',    icon: '🔄', minConfidence: 70 },
  blind_spots: { label: '盲区',     labelEn: 'Blind spots', icon: '🫧', minConfidence: 90 },
  evolution:   { label: '演化',     labelEn: 'Evolution',   icon: '📈', minConfidence: 60 },
  prediction:  { label: '预测',     labelEn: 'Prediction',  icon: '🔮', minConfidence: 60 },
};

// ── Storage ───────────────────────────────────────────────────────────────────

const STORE_KEY = 'nesio-living-model-v1';
const FEEDBACK_KEY_PREFIX = 'nesio-lm-feedback:';

// Number of new nodes needed to trigger a background refresh
const REFRESH_NODE_DELTA = 8;
// Days until a refresh is considered due
const REFRESH_DAYS = 7;

export function loadLivingModel(): LivingModel | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as LivingModel) : null;
  } catch {
    return null;
  }
}

export function saveLivingModel(model: LivingModel): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(model));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function clearLivingModel(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

/** Returns true if the model should be regenerated. */
export function shouldRefreshLivingModel(model: LivingModel | null, currentNodeCount: number): boolean {
  if (!model) return true;
  const daysSince = (Date.now() - Date.parse(model.generatedAt)) / 86_400_000;
  if (daysSince >= REFRESH_DAYS) return true;
  if (currentNodeCount - model.nodeCountAtGen >= REFRESH_NODE_DELTA) return true;
  return false;
}

/** 退役:不再写 nesio-lm-feedback:*(避免只进 prompt 的第二真相)。 */
export function saveLivingModelFeedback(insightId: string, verified: boolean): void {
  void insightId; void verified;
}

/** 退役:恒返回空,段落反馈改走总线或砍掉。 */
export function loadLivingModelFeedbacks(): Record<string, boolean> {
  return {};
}

// ── Data summarization for API ────────────────────────────────────────────────

export interface LivingModelApiInput {
  nodes: LifeNode[];
  mirrorProfile: MirrorProfile;
  previousInsights?: Array<{ layerId: string; content: string; userVerified: boolean | null }>;
}

/** Produce a compact structured summary to send to the AI. */
export function summarizeForLivingModel(input: LivingModelApiInput): {
  nodeCount: number;
  typeBreakdown: Record<string, number>;
  topDomains: Array<{ domain: string; count: number }>;
  recentSample: string[];
  completionRate: number;
  topHour: number;
  feedbackCount: number;
  dominantDomains: string[];
  previousInsights: Array<{ layerId: string; content: string; verified: boolean | null }>;
  /** 三重验证过关的线索(写信优先采用) */
  verifiedLenses: EvidenceLens[];
  /** 弱线索(可写但勿当铁证) */
  weakClues: EvidenceLens[];
} {
  const { nodes, mirrorProfile, previousInsights = [] } = input;

  const typeBreakdown: Record<string, number> = {};
  let completedCount = 0;
  let totalCommitments = 0;

  for (const n of nodes) {
    typeBreakdown[n.type] = (typeBreakdown[n.type] ?? 0) + 1;
    // 只把承诺、以及真正带 done 语义的 event 计入完成率分母 —— 健康/日历等无 done 的 event
    // 一律算"未完成"会系统性拉低完成率(10 条锻炼 event + 2 条已完成承诺 → 显示 17%)。
    if (n.type === 'task' || (n.type === 'event' && n.attributes.done !== undefined)) {
      totalCommitments++;
      if (n.attributes.done === true) completedCount++;
    }
  }

  // 最活跃领域用 canonical countByDomain(按节点计数)—— 此前把 domain 与每个 tag 塞进
  // 同一张表各 +1,一个带 3 tag 的节点被计 4 次,N 不是节点数、领域与标签同池竞争。
  const topDomains = countByDomain(nodes)
    .slice(0, 8)
    .map((d) => ({ domain: d.label, count: d.count }));

  const recentSample = nodes
    .slice(-30)
    .map((n) => n.name)
    .filter(Boolean);

  const topHour = mirrorProfile.hourEngagement.indexOf(
    Math.max(...mirrorProfile.hourEngagement),
  );

  const dominantDomains = Object.entries(mirrorProfile.domainWeights)
    .filter(([, w]) => w >= 0.6)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([d]) => d);

  const lenses = buildEvidenceLenses({ recentSample, topDomains, typeBreakdown });

  return {
    nodeCount: nodes.length,
    typeBreakdown,
    topDomains,
    recentSample,
    completionRate: totalCommitments > 0 ? Math.round((completedCount / totalCommitments) * 100) : 0,
    topHour,
    feedbackCount: mirrorProfile.feedbackCount,
    dominantDomains,
    previousInsights: previousInsights.map((p) => ({
      layerId: p.layerId,
      content: p.content,
      verified: p.userVerified,
    })),
    verifiedLenses: lenses.verifiedLenses,
    weakClues: lenses.weakClues,
  };
}
