/**
 * Living Model — AI's world model of the user, structured as 7 cognitive layers.
 *
 * Design principles (from AI Identity Framework 2025 + Oura Advisor research):
 * - Behavioral observation > self-declaration: model derives from what user DOES
 * - Evidence traceability: each insight links to concrete behavioral patterns
 * - Confidence degrades when new evidence contradicts existing insights
 * - User correction feeds back into next regeneration
 * - Blind Spots require confidence >= 90 before showing (high bar prevents noise)
 * - Model is cached locally; refreshed on significant data change, not every open
 */

import type { LifeNode } from '@/lib/portal/life-graph';
import type { MirrorProfile } from '@/lib/portal/mirror-profile';

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

/** Save user feedback on a single insight (affects next regeneration prompt). */
export function saveLivingModelFeedback(insightId: string, verified: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${FEEDBACK_KEY_PREFIX}${insightId}`, String(verified));
    // Also update the in-memory model
    const model = loadLivingModel();
    if (!model) return;
    for (const layer of model.layers) {
      for (const insight of layer.insights) {
        if (insight.id === insightId) {
          insight.userVerified = verified;
        }
      }
    }
    saveLivingModel(model);
  } catch {
    /* ignore */
  }
}

/** Load all saved feedbacks as a record for injecting into the next API call. */
export function loadLivingModelFeedbacks(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  const result: Record<string, boolean> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(FEEDBACK_KEY_PREFIX)) {
        const id = key.slice(FEEDBACK_KEY_PREFIX.length);
        result[id] = localStorage.getItem(key) === 'true';
      }
    }
  } catch {
    /* ignore */
  }
  return result;
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
} {
  const { nodes, mirrorProfile, previousInsights = [] } = input;

  const typeBreakdown: Record<string, number> = {};
  const domainMap: Record<string, number> = {};
  let completedCount = 0;
  let totalCommitments = 0;

  for (const n of nodes) {
    typeBreakdown[n.type] = (typeBreakdown[n.type] ?? 0) + 1;
    if (n.type === 'commitment' || n.type === 'event') {
      totalCommitments++;
      if (n.attributes.done === true) completedCount++;
    }
    // Extract domain from context attribute
    if (typeof n.attributes.context === 'string') {
      try {
        const ctx = JSON.parse(n.attributes.context) as { domain?: string };
        if (ctx.domain) domainMap[ctx.domain] = (domainMap[ctx.domain] ?? 0) + 1;
      } catch { /* ignore */ }
    }
    for (const tag of n.tags ?? []) {
      domainMap[tag] = (domainMap[tag] ?? 0) + 1;
    }
  }

  const topDomains = Object.entries(domainMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([domain, count]) => ({ domain, count }));

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
  };
}
