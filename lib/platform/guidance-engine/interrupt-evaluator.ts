/**
 * Interrupt Evaluator — Layer 4
 *
 * Weighted priority scoring (based on Future Guidance Engine spec, 2026-07):
 *
 *   Risk Severity    30% — how bad is it if the user does nothing?   [dynamic: severity]
 *   Time Sensitivity 25% — how urgent is the action window right now? [dynamic: urgency]
 *   Preparation Value 20% — how much better is acting now vs later?   [static: type table]
 *   Confidence       15% — how reliable is the underlying data?       [per-event]
 *   Personal Relevance 10% — relevance to this user                   [static: source proxy]
 *
 * Honest scope: of the "5 dimensions", risk + time are situation-dynamic and
 * confidence is per-event (≈70% responds to the situation); preparation-value
 * and personal-relevance are constant type/source lookup tables (relevance is a
 * source proxy, pending learned per-user signals — Layer 7). So it's ~3 dynamic
 * inputs + 2 constant tables, not 5 independent situational axes.
 *
 * Precision (2026-07): rank by the RAW 0-100 score (interruptPriorityRaw); band to
 * 0-10 (interruptPriority) ONLY for the show-threshold and for display. Rounding to
 * 0-10 before ranking collapsed most cards into ties → order degraded to insertion
 * order, exactly where differentiation matters most.
 *
 * Research basis: design spec docs/design/future-guidance-engine.md §12
 */

import type { ConsequenceSeverity, WindowUrgency, GuidanceEventType, GuidanceSource } from './types';

// ── Dimension: Risk Severity (30%) ────────────────────────────────────────────

function riskSeverityScore(severity: ConsequenceSeverity): number {
  // 0→0, 1→33.3, 2→66.7, 3→100(用 /3 精确到 100,不再 severity*33.3 峰值只到 99.9)
  return (severity / 3) * 100;
}

// ── Dimension: Time Sensitivity (25%) ────────────────────────────────────────

const URGENCY_SCORE: Record<WindowUrgency, number> = {
  closed: 0, low: 25, medium: 50, high: 75, critical: 100,
};

function timeSensitivityScore(urgency: WindowUrgency): number {
  return URGENCY_SCORE[urgency];
}

// ── Dimension: Preparation Value (20%) ───────────────────────────────────────
// How much better is acting NOW vs acting later?
// High = time-gated opportunity (missing check-in window costs real money)
// Low = can do anytime today without significant quality difference

const PREPARATION_VALUE: Record<GuidanceEventType, number> = {
  flight:       90,  // check-in window is time-gated; missing it costs real money
  deadline:     85,  // starting earlier always improves outcome (non-linear returns)
  weather_cold: 80,  // can't add a layer after you've left home
  weather_rain: 80,
  travel:       75,  // earlier prep = less last-minute stress
  birthday:     65,  // ordering gift earlier is meaningfully better
  anniversary:  65,
  holiday:      45,  // 提前一天知道放假,安排活动更从容
  medical:      60,  // appointment is fixed; prep is helpful but not critical
  meeting:      55,  // 1h prep vs 30min prep is marginally better
  email_signal: 40,  // email can be handled anytime
  health_habit:   35,  // can do anytime today
  domain_insight: 52,  // 早点关注来自你数据的域信号(健康/财务)总比拖着好 —— 行动价值随时间衰减
  object_context: 30,  // context-triggered — nice to know but not urgent
  dec_insight:    55,  // evidence-backed recommendation — acting today beats later
};

function preparationValueScore(type: GuidanceEventType): number {
  return PREPARATION_VALUE[type] ?? 50;
}

// ── Dimension: Personal Relevance (10%) ──────────────────────────────────────
// Proxy: source type reliability as a signal of personal relevance.
// User-created (memory) or calendar = high; weather/habit = lower.
// Will be replaced by learned user-specific signals in Layer 7.

const SOURCE_RELEVANCE: Record<GuidanceSource, number> = {
  memory:  85,
  calendar: 80,
  email:   70,
  habit:   60,
  weather: 50,
};

function personalRelevanceScore(source: GuidanceSource): number {
  return SOURCE_RELEVANCE[source] ?? 60;
}

// ── Final score ───────────────────────────────────────────────────────────────

const SHOW_THRESHOLD = 4; // 0-10 band

/**
 * Raw weighted priority, 0-100, full precision. This is the ranking key —
 * sort candidates by this, never by the 0-10 band (see precision note above).
 */
export function interruptPriorityRaw(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence: number = 75, // 0-100, from GuidanceEvent.confidence
): number {
  if (urgency === 'closed') return 0;

  return (
    riskSeverityScore(severity)      * 0.30 +
    timeSensitivityScore(urgency)    * 0.25 +
    preparationValueScore(type)      * 0.20 +
    confidence                       * 0.15 +
    personalRelevanceScore(source)   * 0.10
  );
}

/**
 * Display/threshold band, 0-10 (raw rounded). Use for the show-threshold and for
 * showing a priority tier — do NOT rank by this (it collapses cards into ties).
 */
export function interruptPriority(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence: number = 75,
): number {
  return Math.round(interruptPriorityRaw(severity, urgency, type, source, confidence) / 10);
}

export function worthInterrupting(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence?: number,
): boolean {
  return interruptPriority(severity, urgency, type, source, confidence) >= SHOW_THRESHOLD;
}

/**
 * 批次 52:把 5 个维度归一到 [0,1],作为在线学习排序器(guidance-ranker)的特征。
 * 这样 dot([.30,.25,.20,.15,.10], dims) === interruptPriorityRaw/100(同序),
 * 学习器冷启动即复刻现公式。
 */
export function featureDims(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence: number = 75,
): { risk: number; time: number; prep: number; confidence: number; relevance: number } {
  return {
    risk: riskSeverityScore(severity) / 100,
    time: timeSensitivityScore(urgency) / 100,
    prep: preparationValueScore(type) / 100,
    confidence: confidence / 100,
    relevance: personalRelevanceScore(source) / 100,
  };
}
